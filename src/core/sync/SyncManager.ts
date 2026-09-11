import { SyncEngine } from './SyncEngine';
import { SupabaseSyncTransport, TransportError } from './SupabaseSyncTransport';
import { isNetworkFetchError } from './networkError';
import type { SyncTransport } from './transport';
import type { DatabaseDriver } from '../db/driver';
// The in-process reference server (src/core/sync/__tests__/mockServer.ts) —
// normally test-only, reused here as a deliberate, explicitly-opt-in escape
// hatch: `sync:connect({ mock: true })` wires a device transport bound to
// one in-worker MockSyncServer instance instead of a real Supabase project.
// Nothing reaches it unless a caller passes `mock: true` verbatim — the
// real (Settings UI) connect form never does. It exists so this app's own
// e2e suite (apps/web/e2e/sync.spec.ts) can prove the entire BYOK connect
// wizard + background sync loop + UI plumbing end-to-end in a sandbox with
// no real Supabase project reachable, without that suite silently skipping
// itself into providing zero coverage. See that spec's doc comment for the
// full reachability story this is the fallback for.
import { MockSyncServer } from './__tests__/mockServer';
// The pure connect-time duplicate-seed-risk decision — see that module's
// doc comment for why the actual go/no-go logic lives there (jest-testable
// under src/core) rather than here (apps/web has no jest runner of its
// own). `SyncManager.connect` below is a thin caller: gather the three
// inputs, ask, render the result.
import {
  evaluateDuplicateSeedRisk,
  type DuplicateSeedRiskWarning,
} from './connectGuard';
import { PLACEHOLDER_USERNAME } from './placeholderUser';

export type SyncNotifyMessage = { type: 'sync-applied' };

/** Narrow slice of db.worker.ts's `WebKv` this module actually needs — get() for the synchronous read every KeyValueStore consumer gets, plus the awaited variants so a connect/disconnect call can be sure the config actually landed in OPFS before resolving (mirrors how the session username is persisted — see db.worker.ts's WebKv doc comment). */
export interface SyncKv {
  get(key: string): unknown;
  setAwaited(key: string, value: unknown): Promise<void>;
  deleteAwaited(key: string): Promise<void>;
}

/**
 * `'duplicate_seed_risk'` is not a transport/probe failure like the other
 * four kinds — it is `connect`'s own guard (see its doc comment and
 * `@core/sync/connectGuard`) stopping *before* ever touching the network
 * again once the initial probe already succeeded. The Settings UI
 * distinguishes it from a real error and renders an amber "needs an
 * explicit choice" card (Cancel / Connect anyway) instead of the plain red
 * "could not connect" one — see SyncSettings.tsx.
 */
export type SyncErrorKind =
  | 'unreachable'
  | 'bad_key'
  | 'setup_missing'
  | 'unknown'
  | 'duplicate_seed_risk';

export interface SyncErrorInfo {
  kind: SyncErrorKind;
  message: string;
  /** Human-readable, always-actionable next step — this is what the Settings UI renders verbatim next to the error. */
  guidance: string;
}

export interface SyncStatusPayload {
  connected: boolean;
  /** e.g. "xxxx.supabase.co", or "mock (local, no network)" in mock mode. Undefined when never connected. */
  projectHost?: string;
  /** ISO 8601, undefined until the first successful syncOnce completes. */
  lastSyncAt?: string;
  pendingOutboxCount: number;
  lastError?: SyncErrorInfo | null;
  /** True while a syncOnce is actually in flight right now. */
  syncing: boolean;
  /**
   * Live `COUNT(*)` of `sync_apply_conflicts` (migration 030) — rows a pull
   * fetched but could not apply (almost always a natural-key `UNIQUE`
   * conflict from two independently-seeded devices — see
   * `SyncEngine.pullAndApply`'s doc comment) and recorded for review rather
   * than crashing the sync loop over. Always a fresh read, never cached, so
   * it can never drift from what actually needs attention. `SyncSettings.tsx`
   * renders a small amber note when this is `> 0`; a proper conflict-review
   * inbox UI is future work — this is only the "something needs a look"
   * signal for now.
   */
  conflictCount: number;
  /**
   * The connected Project URL (not the anon key). So Settings can show
   * which project this device talks to after a join, without putting the
   * key into the 5s status poll.
   */
  projectUrl?: string;
}

export interface SyncConnectResult {
  ok: boolean;
  status?: SyncStatusPayload;
  error?: SyncErrorInfo;
}

/**
 * Result of {@link SyncManager.join} — the "join existing sync" (second
 * device) flow. `pulled`/`applied` describe the initial full pull that
 * completed before this resolves (see that method's doc comment), so the
 * Login screen's success step can say something concrete ("pulled N rows")
 * rather than a bare "done".
 */
export interface SyncJoinResult {
  ok: boolean;
  pulled?: number;
  applied?: number;
  status?: SyncStatusPayload;
  error?: SyncErrorInfo;
}

/**
 * Result of {@link SyncManager.rebuild} — "Re-download everything from
 * sync" (see that method's doc comment). Same shape as {@link
 * SyncJoinResult}: a device repair is, mechanically, another full pull —
 * the Settings UI's success toast reports `applied` the same way the Join
 * screen's success note reports `pulled`.
 */
export interface SyncRebuildResult {
  ok: boolean;
  pulled?: number;
  applied?: number;
  status?: SyncStatusPayload;
  error?: SyncErrorInfo;
}

interface StoredSyncConfig {
  url: string;
  anonKey: string;
  mock?: boolean;
}

const CONFIG_KEY = 'sync.config';
const DEVICE_ID_KEY = 'sync.deviceId';

/** Steady-state pull/push cadence once connected and healthy. */
const FIXED_INTERVAL_MS = 30_000;
/** First retry delay after a syncOnce failure; doubles from here, see scheduleNext. */
const BASE_BACKOFF_MS = 30_000;
/** Ceiling a doubling backoff is clamped to — matches the task spec's "30s -> 60s -> 120s, cap 300s". */
const MAX_BACKOFF_MS = 300_000;
/** How long a burst of local writes is allowed to settle before syncing — see scheduleDebouncedSync. */
const DEBOUNCE_MS = 3_000;

const SETUP_SQL_HINT =
  'supabase/setup.sql (repo root) — paste its full contents into this project’s SQL Editor and run it. It is safe to re-run.';

/**
 * Classifies a thrown probe/sync error into one of the four kinds the
 * Settings UI knows how to give exact, actionable guidance for. Shared by
 * `connect` (a failed probe = a failed connect attempt, surfaced as a typed
 * `SyncConnectResult.error`) and the background loop (a failed `syncOnce` =
 * `SyncStatusPayload.lastError`) — the same underlying causes (bad key,
 * missing schema, unreachable project) apply either way, only the calling
 * context differs.
 */
function classifySyncError(error: unknown, url: string): SyncErrorInfo {
  if (error instanceof TransportError) {
    if (error.status === 401 || error.status === 403) {
      return {
        kind: 'bad_key',
        message: `The project rejected the anon key (HTTP ${error.status}).`,
        guidance:
          'Double-check you copied the "anon" / "public" API key — not the service_role key — from Project Settings → API, alongside the matching Project URL.',
      };
    }
    if (error.status === 404) {
      return {
        kind: 'setup_missing',
        message:
          'This project does not have the sync tables/function yet (sync_log / sync_push returned 404).',
        guidance: `Apply ${SETUP_SQL_HINT}`,
      };
    }
    return {
      kind: 'unknown',
      message: `Unexpected response from the project (HTTP ${
        error.status
      }): ${error.body.slice(0, 300)}`,
      guidance:
        'Check the Project URL and anon key are correct and the project is not paused, then try again.',
    };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return {
    kind: 'unreachable',
    message: `Could not reach ${url || 'the project'}: ${detail}`,
    guidance: isNetworkFetchError(error)
      ? 'The download was interrupted. Tap Try again to resume — rows already on this device are kept. Then sign in with your existing account.'
      : 'Check the Project URL and this device’s network connection, then try again.',
  };
}

function sameStoredProject(
  a: StoredSyncConfig | null,
  b: StoredSyncConfig,
): boolean {
  if (!a) return false;
  if (Boolean(a.mock) !== Boolean(b.mock)) return false;
  if (a.mock) return true;
  const norm = (url: string) => url.replace(/\/+$/, '');
  return norm(a.url) === norm(b.url) && a.anonKey === b.anonKey;
}

function projectHostOf(config: StoredSyncConfig): string {
  if (config.mock) return 'mock (local, no network)';
  try {
    return new URL(config.url).host;
  } catch {
    return config.url;
  }
}

/**
 * BYOK connect wizard backend + background sync loop, hosted in the db
 * worker (see db.worker.ts's `sync:*` handlers, the only callers). Owns:
 *
 *  - **Device-scoped bootstrap config** (`{ url, anonKey }`, or `{ mock:
 *    true }`): persisted to `web_kv` (via the injected `SyncKv`) rather than
 *    anywhere business-data-scoped, because this config has to exist and be
 *    readable *before* — and independent of — whatever business data this
 *    device happens to hold; it identifies which Supabase project this
 *    physical device talks to, not which business/session is active in it.
 *  - **This device's stable id** (`sync.deviceId`, `web_kv`, generated once
 *    via `crypto.randomUUID()`), the value every pushed mutation is
 *    stamped with (see SupabaseSyncTransport's doc comment) — generated
 *    once and reused across connect/disconnect/reconnect cycles so a
 *    device's own echoes keep suppressing correctly even after a
 *    reconnect.
 *  - **Connect-time validation**: `connect()` never persists a config it
 *    hasn't first proven works, by constructing a throwaway
 *    `SupabaseSyncTransport` and probing `pull(0, 1)` + an empty `push([])`
 *    — the same two read-only/no-op-write probes
 *    `supabaseTransport.integration.test.ts`'s `probeSetup` shells out to
 *    `node -e` for synchronously (this runs directly in an async worker
 *    method instead, no child process available or needed here). Any
 *    thrown error is classified (`classifySyncError`) into one of four
 *    kinds so the Settings UI can render exact guidance instead of a raw
 *    error string.
 *  - **The background loop**: `syncOnce()` immediately on a successful
 *    connect (and on worker boot when a config already exists), then every
 *    `FIXED_INTERVAL_MS` while healthy; a failure switches to exponential
 *    backoff (`BASE_BACKOFF_MS` doubling, capped at `MAX_BACKOFF_MS`) that
 *    resets to the fixed interval on the next success. `ensureCycle`
 *    guarantees at most one `syncOnce` in flight at a time — a request that
 *    arrives while one is already running (the steady timer, a debounced
 *    write, or a manual "Sync now") sets a `rerunRequested` flag rather
 *    than starting a second overlapping run, and that rerun happens
 *    immediately once the in-flight one settles.
 *  - **Write-triggered syncing**: `scheduleDebouncedSync()` — called by
 *    db.worker.ts's RPC dispatch after any call it judges to be a write —
 *    coalesces a burst of local writes into one sync `DEBOUNCE_MS` after
 *    the last of them, rather than one sync per individual write.
 *  - **Status for the UI**: `getStatus()` — connected/host, last sync time,
 *    live outbox depth (a fresh `COUNT(*)` against `sync_outbox`, not a
 *    cached counter, so it can never drift from what's actually pending),
 *    the last error (if any), and whether a sync is in flight right now.
 *  - **"Join existing sync"**: `join()` — the second-device counterpart to
 *    `connect()` (see its own doc comment for the full story): same
 *    validation, but performs a pull-only initial full sync before
 *    resolving, and first clears this device's own boot-created
 *    placeholder user/charts so they never leak onto the shared project.
 *  - **"Re-download everything from sync"**: `rebuild()` — a device REPAIR
 *    action (requires an already-connected transport, unlike `connect`/
 *    `join`): wipes this device's local replicated state and re-applies the
 *    server's entire log from scratch via
 *    {@link import('@core/sync/SyncEngine').SyncEngine.rebuildFromServer},
 *    for a device whose apply cascade already quarantined rows in a way no
 *    ordinary future `syncOnce` can heal on its own — see that method's own
 *    doc comment for the full incident.
 *  - **The pull-applied notification**: whenever a `syncOnce` actually
 *    applied one or more pulled rows (this device's local data changed
 *    underneath whatever the renderer is currently displaying), a
 *    `{ type: 'sync-applied' }` `WorkerMessage` is posted to the main
 *    thread via the injected `notify` callback — see rpc.ts's doc comment
 *    on that message variant for the full chain down to the DOM event
 *    shared renderer code can listen for.
 *
 * Never throws out of the background loop itself: every `runOnce` failure
 * is caught, classified, and recorded as `lastError` — nothing here can
 * crash the worker just because a sync attempt failed.
 */
export class SyncManager {
  private readonly db: DatabaseDriver;

  private readonly kv: SyncKv;

  private readonly notify: (message: SyncNotifyMessage) => void;

  private readonly fetchImpl?: typeof fetch;

  private readonly mockServer = new MockSyncServer();

  private transport: SyncTransport | null = null;

  private currentConfig: StoredSyncConfig | null = null;

  private lastSyncAt: string | undefined;

  private lastError: SyncErrorInfo | null = null;

  private backoffMs = BASE_BACKOFF_MS;

  private inFlight: Promise<void> | null = null;

  private rerunRequested = false;

  private nextTimer: ReturnType<typeof setTimeout> | null = null;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: {
    db: DatabaseDriver;
    kv: SyncKv;
    notify: (message: SyncNotifyMessage) => void;
    /** Injectable fetch — mirrors SupabaseSyncTransport's own escape hatch; unused in a real browser worker, present for symmetry/testability. */
    fetchImpl?: typeof fetch;
  }) {
    this.db = deps.db;
    this.kv = deps.kv;
    this.notify = deps.notify;
    this.fetchImpl = deps.fetchImpl;
  }

  // -----------------------------------------------------------------------
  // Public RPC surface — see db.worker.ts's sync:* handlers.
  // -----------------------------------------------------------------------

  /** Starts the background loop on worker boot if a config was already persisted from a prior session — the "reload -> still connected" story. No-op if nothing was ever connected.
   *  `startLoop: false` still restores the transport (Settings can show
   *  Connected) but does not kick a syncOnce. Used on a logged-out boot so
   *  Safari Login is not competing with a 288k-row pull; {@link startLoop}
   *  runs after a successful `auth:login`. */
  async bootIfConfigured(opts?: { startLoop?: boolean }): Promise<void> {
    const stored = this.kv.get(CONFIG_KEY) as StoredSyncConfig | undefined;
    if (!stored) return;
    if (!stored.mock && (!stored.url || !stored.anonKey)) return;

    const deviceId = await this.ensureDeviceId();
    this.transport = stored.mock
      ? this.mockServer.createDeviceTransport(deviceId)
      : new SupabaseSyncTransport({
          url: stored.url,
          anonKey: stored.anonKey,
          deviceId,
          fetchImpl: this.fetchImpl,
        });
    this.currentConfig = stored;
    if (opts?.startLoop !== false) this.startLoop();
  }

  /**
   * Kick the 30s loop after a logged-out boot that restored the transport
   * without starting it (see {@link bootIfConfigured}'s `startLoop: false`).
   * No-op when disconnected. Safe to call when the loop is already running.
   */
  resumeBackgroundLoop(): void {
    if (!this.transport) return;
    this.startLoop();
  }

  /**
   * `force` — required to proceed past the connect-time duplicate-seed
   * guard below once it has fired once; the Settings UI passes it only
   * after the user explicitly clicks "Connect anyway" on the warning card
   * it renders for a `duplicate_seed_risk` result (see `SyncSettings.tsx`).
   * Never set by the probe/validation path itself.
   */
  async connect(config: {
    url: string;
    anonKey: string;
    mock?: boolean;
    force?: boolean;
  }): Promise<SyncConnectResult> {
    const deviceId = await this.ensureDeviceId();
    const probed = await this.probeAndBuildTransport(deviceId, config);
    if (!probed.ok) return { ok: false, error: probed.error };

    if (!config.force) {
      const risk = await this.checkDuplicateSeedRisk(probed.transport);
      if (risk) return { ok: false, error: risk };
    }

    this.transport = probed.transport;
    this.currentConfig = probed.stored;
    await this.kv.setAwaited(CONFIG_KEY, probed.stored);
    this.lastError = null;
    this.backoffMs = BASE_BACKOFF_MS;
    this.startLoop();
    return { ok: true, status: await this.getStatus() };
  }

  /**
   * Connect-time duplicate-seed guard — the up-front counterpart to
   * `SyncEngine`'s per-row apply-conflict containment (see that class's
   * `pullAndApply` doc comment for the incident both halves of this task
   * exist for). Gathers this device's own state (has it ever synced? does
   * it hold local business data already?) plus the target project's log
   * watermark, and asks the pure decision function
   * (`@core/sync/connectGuard`) whether connecting right now would risk
   * silently duplicating a whole business onto a project that already has
   * one. Deliberately `connect`-only, never `join` — a device reaching
   * `join` has already had its local placeholder cleared and is pull-only
   * by construction (see `join`'s own doc comment), so it can never be the
   * *seeding* side of this incident.
   */
  private async checkDuplicateSeedRisk(
    transport: SyncTransport,
  ): Promise<DuplicateSeedRiskWarning | null> {
    const storedCursor = await this.getStoredCursor();
    const hasLocalBusinessData = await this.hasLocalBusinessData();
    const serverSeq = await transport.currentSeq();
    return evaluateDuplicateSeedRisk({
      storedCursor,
      hasLocalBusinessData,
      serverSeq,
    });
  }

  /** This device's own `sync_state.cursor` (0 if never synced) — the same value `SyncEngine` itself tracks, read directly since a fresh `SyncEngine` isn't constructed until after this guard runs. */
  private async getStoredCursor(): Promise<number> {
    const row = await this.db.get<{ value: string }>(
      `SELECT value FROM sync_state WHERE key = 'cursor'`,
    );
    return row ? Number(row.value) : 0;
  }

  /**
   * Whether this device's local database already holds business data worth
   * protecting — the identical "nothing worth losing" emptiness probe the
   * "join existing sync" gating uses on the renderer side
   * (`getAccounts().length === 0 && getJournals().length === 0`, see
   * src/renderer/views/Login/index.tsx's `canJoinSync`), reimplemented here
   * as a direct row-count against this worker's own database rather than a
   * round trip through the RPC surface this method already runs inside of.
   */
  private async hasLocalBusinessData(): Promise<boolean> {
    const accounts = await this.db.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account`,
    );
    const journals = await this.db.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM journal`,
    );
    return (accounts?.c ?? 0) > 0 || (journals?.c ?? 0) > 0;
  }

  /**
   * "Join existing sync" — the second-device flow (Login screen, gated on
   * `getAccounts()`/`getJournals()` both being empty — see
   * src/renderer/views/JoinSync). Validates the project exactly like
   * {@link connect} (same probes, same {@link classifySyncError}
   * classification), then — unlike `connect`, which starts the normal
   * background loop immediately and lets the *first* `syncOnce` do an
   * ordinary push-then-pull — performs one **pull-only** initial full sync
   * ({@link SyncEngine.initialPull}) and waits for it to finish *before*
   * this call resolves, so the renderer can send the user straight to
   * Login with their real account (from the just-pulled `users` table)
   * already sitting in this device's database. Deliberately never pushes:
   * a device reaching this flow has no legitimate business data of its own
   * yet (that's the whole precondition for offering it), so there is
   * nothing worth sending to the server — see `clearBootPlaceholder`'s doc
   * comment for the one thing this device *does* have locally by this
   * point that must NOT be sent.
   *
   * ## Join always rebuilds from zero — never trusts this device's cursor
   *
   * REAL INCIDENT: the "empty device" gate above counts only `account` and
   * `journal` rows — and a device WEDGED by a historical apply cascade (the
   * placeholder-collision incident, see `SyncEngine.rebuildFromServer`'s
   * doc comment) passes it, because the cascade quarantined exactly those
   * tables while leaving hundreds of MB of other partially-applied rows AND
   * a sync cursor already advanced to the end of the server's log. Offered
   * Join on such a device, a user "joins" successfully, `initialPull` from
   * that stale cursor finds nothing, and the result is a connected device
   * that reports "Pulled 0 rows" with an EMPTY `users` table (the
   * placeholder was just cleared, the real user is stuck behind the cursor
   * in quarantine) — no way to log in, looks synced. Seen in the field on a
   * dev-server device the day the rebuild action shipped.
   *
   * So join runs {@link SyncEngine.rebuildFromServer}, not
   * {@link SyncEngine.initialPull}: same wipe-everything, cursor-to-0,
   * clear-outbox/conflicts, full from-zero re-apply the Settings screen's
   * repair button uses. On a genuinely fresh device that's byte-for-byte
   * equivalent to the old `initialPull` (the wipe deletes nothing, the
   * cursor is already 0, `includeSelf` matches nothing under a brand-new
   * device id); on a wedged one it is the difference between healing in
   * place and silently bricking the login. This is also why join now
   * REFUSES a project whose log is empty (`rebuildFromServer`'s
   * empty-server guard, translated below into actionable guidance): there
   * is nothing to join yet — the first device imports and connects, it
   * doesn't join — and the old behavior ("Joined. Pulled 0 rows") was
   * exactly the confusing dead end a user hits after typo-ing their way to
   * a fresh project or joining before the first device ever synced.
   *
   * ## Why the boot placeholder has to be cleared first
   *
   * `db.worker.ts`'s `ensurePlaceholderDefaultUser` runs unconditionally on
   * every fresh worker boot, inserting a `'default'`-username user (NULL
   * password hash) plus `INITIAL_CHARTS` — *before* the renderer even
   * mounts, let alone before the user chooses "Join existing sync". Both
   * `users` and `chart` are replicated tables (migration 029), so that
   * boot insert is captured into this device's `sync_outbox` regardless of
   * whether it ever connects to anything. Left alone, the very next
   * background `syncOnce` after this join (which does drain the outbox —
   * see `runOnce`) would push this device's own throwaway placeholder onto
   * the shared project as a spurious extra "default" user plus a duplicate
   * starter chart of accounts, colliding with (not matching by uuid) the
   * real charts the initial pull below just brought down. `clearBootPlaceholder`
   * removes that local placeholder and drains whatever it (and its own
   * removal) captured into `sync_outbox`, so nothing this device created on
   * its own ever reaches the shared log — the pulled data (its own real
   * users/charts, each with their own uuid from the origin device) ends up
   * being the *only* thing this device has once join completes.
   *
   * ## Single-flight guard against a stale prior loop
   *
   * REAL INCIDENT this section fixes: this method used to run
   * `SyncEngine.rebuildFromServer()` with none of the single-flight
   * precautions {@link rebuild} (the Settings screen's own "re-download
   * everything" action, below) already takes for the exact same call. That
   * was safe only under the assumption that `join` runs on a device with no
   * background loop already running — true for a never-connected device,
   * but NOT true for one that stored a config from a prior, failed or
   * aborted join attempt: {@link bootIfConfigured} unconditionally starts
   * the background loop (`startLoop`) for ANY persisted config on worker
   * boot, whether or not that config's join ever actually completed. A
   * re-attempted `join` on such a device then raced its own
   * `rebuildFromServer` (wiping and re-applying every replicated table) against
   * that stale loop's ordinary `syncOnce` cycles reading and
   * writing the SAME tables — and a row surviving both the rebuild's apply
   * AND a concurrent `syncOnce`'s apply is applied twice, the second pass
   * going through `SyncEngine.applyRow`'s `ON CONFLICT("uuid") DO UPDATE`
   * branch exactly like any other re-delivery. That is precisely the shape
   * migration 034
   * (src/core/db/migrations/034_suppress_timestamp_triggers_during_apply.ts)
   * exists for — but even with 034 making a *single* re-delivery a safe
   * no-op, two DIFFERENT in-flight transactions concurrently reading,
   * wiping, and rewriting the same tables is a race this method must not
   * create in the first place, not merely one whose symptom 034 happens to
   * blunt.
   *
   * The fix mirrors {@link rebuild}'s existing guard structure exactly —
   * clear the pending timer, await any cycle already in flight, occupy
   * `this.inFlight` for the entire duration of the probe-through-rebuild
   * work below, then release it and hand off to `scheduleNext`/
   * `rerunRequested` in a `finally` — via {@link performJoin}, this
   * method's actual body. One addition specific to `join` that `rebuild`
   * doesn't need: {@link stopLoop} runs FIRST, before even the `inFlight`
   * wait, because `join` is establishing a brand-new connection (a fresh
   * probed transport, a fresh `currentConfig`) — the OLD loop, if the stale
   * config left one running, must not survive into the new connection's
   * lifetime. `stopLoop` only cancels timers (`nextTimer`/`debounceTimer`)
   * and the stale `rerunRequested` flag; it deliberately does not touch
   * `this.transport`/`this.currentConfig` here (unlike `disconnect`, which
   * nulls them) — the awaited `this.inFlight` below may still be a cycle
   * using the OLD transport that needs to finish normally, and this method
   * doesn't overwrite `this.transport` until `performJoin` actually
   * succeeds.
   */
  async join(config: {
    url: string;
    anonKey: string;
    mock?: boolean;
  }): Promise<SyncJoinResult> {
    this.stopLoop();
    if (this.inFlight) {
      await this.inFlight;
    }

    const runPromise = this.performJoin(config);
    this.inFlight = runPromise.then(
      () => undefined,
      () => undefined,
    );

    try {
      return await runPromise;
    } finally {
      this.inFlight = null;
      this.rerunRequested = false;
      // Steady 30s loop only — never kick a second syncOnce immediately
      // after a join pull. Safari can leave that follow-up fetch pending
      // forever, which kept the UI on "syncing…".
      this.scheduleNext();
    }
  }

  /**
   * Mock-mode only: makes sure the in-worker {@link MockSyncServer} holds a
   * minimal but realistic joinable business (one credentialed user + one
   * chart head, hand-built in the exact rowJson shape migration 029's
   * capture triggers emit, `_uuid` FK sibling and `__hex` blob twin
   * included) before a mock `join` pulls from it. Exists because join now
   * REFUSES an empty server log by design (see `join`'s doc comment) — a
   * fresh MockSyncServer's log is empty, which would turn the e2e suite's
   * mock join (apps/web/e2e/sync.spec.ts, its only caller path) into a
   * refusal test with no success-path coverage at all. Seeding instead
   * makes the mock join exercise what every REAL join does: pull actual
   * rows, resolve an FK sibling, land a credentialed user a person could
   * sign in as. Idempotent two ways: skipped when the mock log already has
   * rows, and the push itself dedupes by idempotencyKey.
   */
  private async seedMockJoinFixture(): Promise<void> {
    const seedTransport = this.mockServer.createDeviceTransport(
      'mock-join-origin-device',
    );
    if ((await seedTransport.currentSeq()) > 0) return;

    const userUuid = 'a0000000-0000-4000-8000-00000000000a';
    const chartUuid = 'a0000000-0000-4000-8000-00000000000b';
    await seedTransport.push([
      {
        idempotencyKey: 'mock-join-seed:users',
        tableName: 'users',
        rowUuid: userUuid,
        op: 'put',
        rowJson: JSON.stringify({
          id: 1,
          uuid: userUuid,
          status: 1,
          username: 'mock-origin',
          createdAt: null,
          updatedAt: '2026-01-01 00:00:00',
          password_hash: 'mockSalt:mockHash',
          password_hash__hex: null,
        }),
      },
      {
        idempotencyKey: 'mock-join-seed:chart',
        tableName: 'chart',
        rowUuid: chartUuid,
        op: 'put',
        rowJson: JSON.stringify({
          id: 1,
          uuid: chartUuid,
          code: null,
          date: '2026-01-01 00:00:00',
          name: 'Mock Assets',
          type: 'Asset',
          createdAt: null,
          updatedAt: '2026-01-01 00:00:00',
          userId: 1,
          userId_uuid: userUuid,
        }),
      },
    ]);
  }

  /**
   * `join`'s actual work, occupying `this.inFlight` for its whole duration
   * (see `join`'s "Single-flight guard against a stale prior loop" doc
   * comment) — everything from here down is unchanged from before that
   * guard existed: same probe, same mock seeding, same empty-log refusal,
   * same `clearBootPlaceholder`/`rebuildFromServer` sequence, same result
   * shape. `join` itself calls `this.startLoop()` here on success exactly
   * as it always has; because `this.inFlight` is already occupied by the
   * caller at that point, `startLoop`'s own `ensureCycle()` call finds it
   * busy and simply sets `rerunRequested` instead of racing a second cycle
   * — `join`'s `finally` block then honors that flag the instant this
   * promise settles, which is what actually fires the first ordinary
   * post-join cycle. No special-casing needed here for that; it falls out
   * of the same single-flight machinery `rebuild`/`ensureCycle` already
   * share.
   */
  private async performJoin(config: {
    url: string;
    anonKey: string;
    mock?: boolean;
  }): Promise<SyncJoinResult> {
    const deviceId = await this.ensureDeviceId();
    const probed = await this.probeAndBuildTransport(deviceId, config);
    if (!probed.ok) return { ok: false, error: probed.error };

    if (config.mock) {
      await this.seedMockJoinFixture();
    }

    const storedCursor = await this.getStoredCursor();
    const resume =
      sameStoredProject(this.currentConfig, probed.stored) ||
      (!this.currentConfig && storedCursor > 0);
    if (!resume) {
      await this.clearBootPlaceholder();
    }

    // Probed here, before the rebuild below, purely to give the empty-log
    // case a join-specific answer instead of surfacing rebuildFromServer's
    // own (repair-flavored) refusal message — the engine still re-checks
    // for itself, so this is UX, not the safety guard.
    let serverMaxSeq: number;
    try {
      serverMaxSeq = await probed.transport.currentSeq();
    } catch (error) {
      return { ok: false, error: classifySyncError(error, probed.stored.url) };
    }
    if (serverMaxSeq === 0) {
      return {
        ok: false,
        error: {
          kind: 'unknown',
          message: 'This sync project has no data to join yet.',
          guidance:
            'Joining downloads an existing business — but this project’s ' +
            'sync log is empty. On the FIRST device, use "Import from ' +
            'desktop app" (or start fresh) and connect it to sync under ' +
            'Settings; once its data has synced up, "Join existing sync" ' +
            'will work here. If data was expected, double-check the ' +
            'project URL for a typo.',
        },
      };
    }

    // Persist BEFORE the long pull so a dropped fetch (Safari "Load
    // failed") cannot leave this device with pulled rows but no
    // credentials — Settings would show the empty connect form and Join
    // is gated off once accounts exist. Retrying join against the same
    // project resumes from the stored cursor instead of wiping.
    this.transport = probed.transport;
    this.currentConfig = probed.stored;
    await this.kv.setAwaited(CONFIG_KEY, probed.stored);

    const engine = new SyncEngine({ db: this.db, transport: probed.transport });
    let pullResult: { pulled: number; applied: number };
    try {
      pullResult = resume
        ? await engine.continuePull()
        : await engine.rebuildFromServer();
    } catch (error) {
      // Same TransportError-vs-plain-Error split as `rebuild()` below: only
      // a real transport failure belongs to classifySyncError's buckets; a
      // plain Error (e.g. the engine's own empty-server guard winning a
      // race against the pre-check above) surfaces with its message
      // verbatim. Network TypeError ("Load failed") is classified too —
      // it is not a TransportError.
      const info: SyncErrorInfo =
        error instanceof TransportError || isNetworkFetchError(error)
          ? classifySyncError(error, probed.stored.url)
          : {
              kind: 'unknown',
              message: error instanceof Error ? error.message : String(error),
              guidance: '',
            };
      this.lastError = info;
      return { ok: false, error: info, status: await this.getStatus() };
    }

    this.lastError = null;
    this.backoffMs = BASE_BACKOFF_MS;
    this.lastSyncAt = new Date().toISOString();
    // Do not startLoop() here. join() already occupies inFlight; startLoop
    // would only set rerunRequested, and join's finally would then kick a
    // second full syncOnce immediately after a 288k-row pull. On Safari
    // that follow-up fetch often hangs and the UI stays on "syncing…".
    // scheduleNext in join()'s finally starts the steady 30s loop instead.

    return {
      ok: true,
      pulled: pullResult.pulled,
      applied: pullResult.applied,
      status: await this.getStatus(),
    };
  }

  /**
   * "Re-download everything from sync" — the worker-side wiring for
   * {@link SyncEngine.rebuildFromServer} (see that method's doc comment for
   * the full incident and mechanism this repairs: a device whose apply
   * cascade already quarantined rows with its cursor advanced past them,
   * which no ordinary future `syncOnce` can ever heal on its own). Mirrors
   * how {@link join}/{@link connect} are wired — probe/build a transport,
   * run the core `SyncEngine` operation, classify a thrown error — except
   * this is a REPAIR action for an ALREADY-connected device, not a way to
   * connect for the first time: it requires `this.transport` to already
   * exist (same precondition {@link syncNow} enforces) and reuses it
   * directly rather than probing a freshly-submitted URL/key.
   *
   * Any pending timer is cleared first (same as `syncNow`), and this waits
   * out — then occupies, for its own duration — the same single-flight
   * `this.inFlight` slot `ensureCycle`/`runOnce` use for ordinary
   * background cycles: a `SyncEngine.rebuildFromServer` call wholesale
   * wipes and re-applies this device's entire local replicated state, which
   * must never interleave with an ordinary `syncOnce` (the steady timer, a
   * debounced write, a concurrent manual "Sync now") touching the same
   * tables mid-wipe. Occupying `this.inFlight` means any such concurrent
   * request simply observes it as already busy (`ensureCycle`'s existing
   * `rerunRequested` behavior) and runs its own ordinary cycle right after
   * this rebuild finishes, rather than racing it.
   *
   * `db.worker.ts`'s `sync:rebuild` handler — the only caller — is what
   * actually clears this worker's session (`currentUsername`/`web_kv`)
   * once this resolves `ok`; this method only reports whether a rebuild
   * happened via its return value, the same `SyncEngine.rebuildFromServer`
   * shape `join` already reports `initialPull`'s result in.
   */
  async rebuild(): Promise<SyncRebuildResult> {
    if (!this.transport) {
      throw new Error('Not connected to a sync project yet.');
    }
    this.clearTimer();
    if (this.inFlight) {
      await this.inFlight;
    }

    const engine = new SyncEngine({ db: this.db, transport: this.transport });
    const runPromise = engine.rebuildFromServer();
    this.inFlight = runPromise.then(
      () => undefined,
      () => undefined,
    );

    try {
      const result = await runPromise;
      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      this.backoffMs = BASE_BACKOFF_MS;
      return {
        ok: true,
        pulled: result.pulled,
        applied: result.applied,
        status: await this.getStatus(),
      };
    } catch (error) {
      // `rebuildFromServer`'s own "refusing — the server log is empty"
      // guard throws a plain `Error`, not a `TransportError` —
      // `classifySyncError` would mislabel it as "Could not reach the
      // project" (its network-failure fallback bucket). Only hand a real
      // `TransportError` (a probe/push/pull that actually failed against
      // the server) to that classifier; anything else surfaces as `unknown`
      // with the thrown message verbatim, which for the empty-server guard
      // IS the actionable guidance.
      const info: SyncErrorInfo =
        error instanceof TransportError
          ? classifySyncError(error, this.currentConfig?.url ?? '')
          : {
              kind: 'unknown',
              message: error instanceof Error ? error.message : String(error),
              guidance: '',
            };
      return { ok: false, error: info };
    } finally {
      this.inFlight = null;
      this.scheduleNext();
      if (this.rerunRequested) {
        this.rerunRequested = false;
        this.ensureCycle().catch(() => {});
      }
    }
  }

  async disconnect(): Promise<SyncStatusPayload> {
    this.stopLoop();
    this.transport = null;
    this.currentConfig = null;
    this.lastError = null;
    this.lastSyncAt = undefined;
    this.backoffMs = BASE_BACKOFF_MS;
    await this.kv.deleteAwaited(CONFIG_KEY);
    return this.getStatus();
  }

  async getStatus(): Promise<SyncStatusPayload> {
    return {
      connected: this.transport !== null,
      projectHost: this.currentConfig
        ? projectHostOf(this.currentConfig)
        : undefined,
      lastSyncAt: this.lastSyncAt,
      pendingOutboxCount: await this.pendingOutboxCount(),
      lastError: this.lastError,
      syncing: this.inFlight !== null,
      conflictCount: await this.conflictCount(),
      projectUrl:
        this.currentConfig && !this.currentConfig.mock
          ? this.currentConfig.url
          : undefined,
    };
  }

  /**
   * The Project URL + anon key this device is connected with, for the
   * Settings "Add a device" QR / copy-link (see
   * src/renderer/lib/joinLink.ts). Returns null when not connected, or
   * when connected via the e2e-only mock transport — a `mock://` URL is
   * not a joinable project and must not be encoded into a link a phone
   * could scan. Fetched on demand (the connected-card button) rather than
   * stuffed into the 5s status poll so the anon key is not copied into
   * renderer state on every tick.
   */
  getJoinInvite(): { url: string; anonKey: string } | null {
    if (!this.transport || !this.currentConfig) return null;
    if (this.currentConfig.mock) return null;
    const { url, anonKey } = this.currentConfig;
    if (!url || !anonKey) return null;
    return { url, anonKey };
  }

  /** Manual "Sync now": runs (or joins) a cycle immediately, ignoring any pending backoff/interval wait, and resolves once it settles. */
  async syncNow(): Promise<SyncStatusPayload> {
    if (!this.transport) {
      throw new Error('Not connected to a sync project yet.');
    }
    this.clearTimer();
    await this.ensureCycle();
    return this.getStatus();
  }

  /** Called by db.worker.ts's RPC dispatch after any call it judges to be a local write. No-op while disconnected. */
  scheduleDebouncedSync(): void {
    if (!this.transport) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.clearTimer();
      this.ensureCycle().catch(() => {});
    }, DEBOUNCE_MS);
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async ensureDeviceId(): Promise<string> {
    const existing = this.kv.get(DEVICE_ID_KEY) as string | undefined;
    if (existing) return existing;
    const id = crypto.randomUUID();
    await this.kv.setAwaited(DEVICE_ID_KEY, id);
    return id;
  }

  /**
   * Shared validate-and-build-a-transport step behind both {@link connect}
   * and {@link join}: mock short-circuits to `MockSyncServer`; otherwise
   * trims+requires `url`/`anonKey`, builds a throwaway
   * `SupabaseSyncTransport`, and proves it actually works with the same two
   * read-only/no-op probes `supabaseTransport.integration.test.ts`'s
   * `probeSetup` uses (`pull(0, 1)` + an empty `push([])`) before ever
   * returning it as usable. Never persists anything — callers decide what
   * to do with a successful result (`connect` and `join` diverge from here:
   * `connect` starts the normal loop immediately, `join` does an
   * initial-pull first — see `join`'s doc comment).
   */
  private async probeAndBuildTransport(
    deviceId: string,
    config: { url: string; anonKey: string; mock?: boolean },
  ): Promise<
    | { ok: true; transport: SyncTransport; stored: StoredSyncConfig }
    | { ok: false; error: SyncErrorInfo }
  > {
    if (config.mock) {
      const stored: StoredSyncConfig = {
        url: 'mock://local',
        anonKey: '',
        mock: true,
      };
      return {
        ok: true,
        transport: this.mockServer.createDeviceTransport(deviceId),
        stored,
      };
    }

    const url = config.url.trim();
    const anonKey = config.anonKey.trim();
    if (!url || !anonKey) {
      return {
        ok: false,
        error: {
          kind: 'unknown',
          message: 'Project URL and anon key are both required.',
          guidance:
            'Paste the Project URL and the "anon" / "public" API key from your Supabase project’s Settings → API page.',
        },
      };
    }

    const probeTransport = new SupabaseSyncTransport({
      url,
      anonKey,
      deviceId,
      fetchImpl: this.fetchImpl,
    });
    try {
      await probeTransport.pull(0, 1);
      await probeTransport.push([]);
    } catch (error) {
      return { ok: false, error: classifySyncError(error, url) };
    }

    return { ok: true, transport: probeTransport, stored: { url, anonKey } };
  }

  /**
   * Removes THIS device's boot-created placeholder (`PLACEHOLDER_USERNAME`
   * user + its `INITIAL_CHARTS`, see db.worker.ts's
   * `ensurePlaceholderDefaultUser`, which runs unconditionally on every
   * fresh worker boot) and drains whatever that boot seeding — and these
   * very deletes, which are themselves captured by migration 029's DELETE
   * triggers the same way any local delete is — put into `sync_outbox`.
   * Called by {@link join} before its initial pull; see that method's doc
   * comment for the full "why" (in short: so this device's own throwaway
   * placeholder is never pushed onto a shared project as a spurious extra
   * user + duplicate starter chart of accounts once the normal background
   * loop starts draining the outbox after join completes).
   *
   * Safe to run even when the placeholder was never created (e.g. this
   * device already registered a real account before joining — the
   * emptiness probe that gates the Join UI, `getAccounts().length === 0`,
   * doesn't itself guarantee the placeholder is still present): every
   * `DELETE` here is a plain conditional no-op when its target row doesn't
   * exist. The `password_hash IS NULL` guard on the `users` delete is
   * load-bearing, not decorative — it ensures this only ever removes THIS
   * device's own zero-credential bootstrap row, never a real,
   * password-protected account that happens to be named
   * `PLACEHOLDER_USERNAME` (e.g. one already pulled from the project this
   * device is joining, in the unlikely event the remote business already
   * has a real user literally named "default").
   */
  private async clearBootPlaceholder(): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(
        `DELETE FROM chart WHERE userId = (SELECT id FROM users WHERE username = @username)`,
        { username: PLACEHOLDER_USERNAME },
      );
      await this.db.run(
        `DELETE FROM users WHERE username = @username AND password_hash IS NULL`,
        { username: PLACEHOLDER_USERNAME },
      );
      await this.db.run(`DELETE FROM sync_outbox`);
    });
  }

  private async pendingOutboxCount(): Promise<number> {
    const row = await this.db.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_outbox`,
    );
    return row?.c ?? 0;
  }

  /** Live `COUNT(*)` of `sync_apply_conflicts` (migration 030) — see `SyncStatusPayload.conflictCount`'s doc comment. */
  private async conflictCount(): Promise<number> {
    const row = await this.db.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
    );
    return row?.c ?? 0;
  }

  private startLoop(): void {
    this.clearTimer();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.ensureCycle().catch(() => {});
  }

  private stopLoop(): void {
    this.clearTimer();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    // Deliberately does not cancel an in-flight fetch (no AbortController
    // wiring in SupabaseSyncTransport) — it is simply left to settle and
    // its result discarded by runOnce's own bookkeeping; nothing schedules
    // further work off the back of it once `this.transport` is null (see
    // scheduleNext's own guard).
    this.rerunRequested = false;
  }

  private clearTimer(): void {
    if (this.nextTimer) {
      clearTimeout(this.nextTimer);
      this.nextTimer = null;
    }
  }

  /** At most one syncOnce in flight at a time — a call that arrives mid-cycle marks `rerunRequested` instead of starting a second overlapping run; that rerun fires immediately once the current one settles. */
  private ensureCycle(): Promise<void> {
    if (this.inFlight) {
      this.rerunRequested = true;
      return this.inFlight;
    }
    this.inFlight = this.runOnce().finally(() => {
      this.inFlight = null;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        this.ensureCycle().catch(() => {});
      }
    });
    return this.inFlight;
  }

  private async runOnce(): Promise<void> {
    if (!this.transport) return;
    try {
      const engine = new SyncEngine({ db: this.db, transport: this.transport });
      const report = await engine.syncOnce();
      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      this.backoffMs = BASE_BACKOFF_MS;
      if (report.applied > 0) {
        this.notify({ type: 'sync-applied' });
      }
    } catch (error) {
      this.lastError = classifySyncError(error, this.currentConfig?.url ?? '');
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    } finally {
      this.scheduleNext();
    }
  }

  /** Reschedules the steady-state timer: the fixed interval after a clean run, the current (already-doubled) backoff after a failed one. A disconnect that happened mid-cycle (transport now null) schedules nothing. */
  private scheduleNext(): void {
    this.clearTimer();
    if (!this.transport) return;
    const delay = this.lastError ? this.backoffMs : FIXED_INTERVAL_MS;
    this.nextTimer = setTimeout(() => {
      this.ensureCycle().catch(() => {});
    }, delay);
  }
}
