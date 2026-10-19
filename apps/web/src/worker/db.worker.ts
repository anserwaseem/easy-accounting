/**
 * The db worker: hosts the real core services (src/core) against a SQLite
 * database persisted to OPFS, and answers RPC calls from the main thread
 * (see src/api/client.ts and src/api/rpc.ts).
 *
 * VFS choice: the OPFS SAH-pool VFS (`sqlite3.installOpfsSAHPoolVfs`), not
 * the plain 'opfs' VFS. Both require the page to be cross-origin isolated
 * (COOP/COEP — see vite.config.ts), but the plain VFS additionally needs
 * `SharedArrayBuffer` to coordinate its synchronous/asynchronous halves,
 * which has proven flakier under headless Chromium/CI than the SAH-pool
 * VFS, which does its file I/O synchronously in this worker via
 * `FileSystemSyncAccessHandle` and needs no such coordination. Documented
 * here rather than silently chosen: if a future increment needs
 * multi-worker/multi-tab concurrent writers, the plain 'opfs' VFS (or a
 * single-writer-elected-tab scheme) will need revisiting — SAH-pool locks
 * its whole directory to one VFS instance at a time.
 *
 * Surface: this worker backs the AppApi (src/core/api/AppApi.ts) contract
 * that src/core's platform-free services can serve — account, chart,
 * journal, ledger, invoice, inventory, pricing, statement/report, auth,
 * settings, and catalog publish (config in ./publishConfig.ts, run in
 * ./publishService.ts via SigV4 PUT). print:* and backup:* still reject
 * in apps/web/src/api/client.ts without reaching this worker.
 *
 * Two handlers are deliberately NOT part of that AppApi contract:
 *
 * `import:database`, the "bring your database" importer (see
 * src/core/db/import.ts for the platform-free merge logic and
 * ./deserializeDatabase.ts for the sqlite-wasm-specific half that opens the
 * upload as a second database). It has no desktop counterpart to mirror —
 * the desktop app already IS the source of that data, never a destination
 * for it — so it lives outside AppApi entirely, reached only via
 * apps/web/src/api/client.ts's `importDatabase` export and gated behind
 * `window.electron.supportsDbImport` (see electronShim.ts) rather than
 * appearing on `window.electron` unconditionally the way every AppApi
 * method does.
 *
 * `export:database`, "Export my data" — the inverse: serializes the live
 * OPFS database to a standard SQLite file's bytes, for a plain download (see
 * src/renderer/lib/exportDatabase.ts and its Settings/Import entry points).
 * Also has no desktop counterpart worth mirroring (desktop's `database.db`
 * already IS a plain file on disk — nothing to "export" it into) and is
 * reached only via apps/web/src/api/client.ts's `exportDatabase` export,
 * gated behind `window.electron.supportsDbExport`.
 *
 * Snapshot consistency for `export:database`: this worker's `onmessage`
 * (below) only ever has ONE RPC call's handler running at a time — a second
 * queued message is not dispatched until the current handler's promise
 * settles, and this worker has no other source of concurrency (no other
 * threads, no timers touching the database). The `export:database` handler
 * itself never `await`s before calling `sqlite3_js_db_export` — it is a
 * synchronous wasm call from the handler's first tick — so no other queued
 * message (in particular, nothing that could write to the database) can
 * possibly run between "start exporting" and "the export is done". The
 * bytes returned are therefore always an exact, consistent snapshot of the
 * database as it stood at the moment `export:database` was received, with
 * no possibility of a write landing mid-serialize.
 *
 * `sync:getStatus` / `sync:connect` / `sync:disconnect` / `sync:syncNow` /
 * `sync:join` / `sync:rebuild` / `sync:getJoinInvite`, the BYOK multi-device
 * sync connect wizard + "join existing sync" (second-device) flow +
 * "re-download everything from sync" (device repair) flow + "Add a device"
 * QR/copy-link invite + status surface (see ./syncManager.ts's
 * `SyncManager` for the actual implementation — this file only wires it up
 * and forwards these seven calls to it). Also outside AppApi (no desktop
 * counterpart this increment — see syncManager.ts's doc comment), gated
 * behind `window.electron.supportsSync`. Unlike the two handlers above,
 * this one has an ongoing side effect beyond serving these seven calls:
 * `SyncManager` also runs a background loop (a `setTimeout` chain, not a
 * handler this `onmessage` dispatches) and hooks into this `onmessage`'s
 * own dispatch below to schedule a debounced sync after any call that
 * looks like a local write.
 */
import '../bufferPolyfill';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { addDays, format, parse } from 'date-fns';
import { bootstrapDatabase } from '@core/db/bootstrap';
import type { DatabaseDriver } from '@core/db/driver';
import {
  importDatabase as runImportDatabase,
  looksLikeSqliteFile,
  validateUploadedDatabase,
} from '@core/db/import';
import type { KeyValueStore, SessionContext } from '@core/ports';
import { AccountService } from '@core/services/AccountService';
import { ChartService } from '@core/services/ChartService';
import { AgentTourService } from '@core/services/AgentTourService';
import { LedgerService } from '@core/services/LedgerService';
import { PricingService } from '@core/services/PricingService';
import { InventoryService } from '@core/services/InventoryService';
import { JournalService } from '@core/services/JournalService';
import { StatementService } from '@core/services/StatementService';
import { InvoiceService } from '@core/services/InvoiceService';
import { SettingsService } from '@core/services/SettingsService';
import { VendorStockService } from '@core/services/VendorStockService';
import { CommissionService } from '@core/services/CommissionService';
import { repairInvoiceEditedTimestamps } from '@core/sync/repairInvoiceTimestamps';
import { INITIAL_CHARTS } from '@core/utils/constants';
import { enrichLedgerRowsWithJournalSummaries } from '@core/utils/ledgerJournalEnrichment';
import type { UserCredentials } from 'types';
import { openDeserializedDatabase } from './deserializeDatabase';
import { PLACEHOLDER_USERNAME } from '@core/sync/placeholderUser';
import {
  getWebPublishConfig,
  getWebPublishSecrets,
  saveWebPublishConfig,
  migratePublishConnectionToSettings,
} from './publishConfig';
import { WebPublishService } from './publishService';
import { SqliteWasmDriver } from './SqliteWasmDriver';
import { SyncManager } from './syncManager';
import { createTurnQueue } from './turnQueue';
import {
  coerceStoredPasswordHash,
  hashPassword,
  isDesktopFormatHash,
  verifyDesktopPassword,
  verifyPassword,
} from './webCrypto';
import type { RpcCall, WorkerMessage } from '../api/rpc';

// Minimal ambient shape for what this file needs from the worker global
// scope. Deliberately not pulling in TypeScript's "webworker" lib: it
// declares globals (`self`, `postMessage`, ...) that conflict with the "dom"
// lib apps/web's single tsconfig also needs for the React app side, and
// splitting the worker into its own tsconfig is more machinery than this
// file's small surface is worth.
interface WorkerScope {
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<RpcCall>) => void) | null;
}
declare const self: WorkerScope;

function isLocalDebugHost(): boolean {
  const host = (globalThis as { location?: { hostname: string } }).location
    ?.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

/**
 * A key/value store backed by an in-DB table (`web_kv`), for the same role
 * electron-store plays on desktop (src/main/coreRuntime.ts's `keyValueStore`)
 * — this worker has no `localStorage` (workers don't get one) and no
 * synchronous storage API at all, while the core `KeyValueStore` port
 * (src/core/ports.ts) is deliberately synchronous (`get`/`set`/`delete`
 * return/accept plain values, no promises) because InventoryService reads it
 * inline mid-query.
 *
 * The trick: `load()` hydrates an in-memory `Map` from `web_kv` once at
 * boot (the only genuinely async step), and every `get` after that is a
 * synchronous Map lookup — satisfying the port's synchronous contract
 * exactly. Writes update the Map synchronously (so a `get` immediately after
 * a `set` sees the new value, matching electron-store's synchronous
 * read-your-writes behavior) and persist to `web_kv` underneath; `set`/
 * `delete` persist fire-and-forget (nothing in this worker's handler surface
 * currently calls them on a path where the caller needs to await
 * durability), while `setAwaited`/`deleteAwaited` are used for the one case
 * that does — the login/register/logout session username below, where a
 * caller could plausibly reload the page immediately after and needs the
 * session to have actually landed in OPFS first.
 *
 * Values are stored JSON-encoded so the table can hold anything the port's
 * `unknown` type allows, not just strings.
 */
class WebKv implements KeyValueStore {
  private readonly cache = new Map<string, unknown>();

  constructor(private readonly db: DatabaseDriver) {}

  async load(): Promise<void> {
    await this.db.exec(
      `CREATE TABLE IF NOT EXISTS web_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
    const rows = await this.db.all<{ key: string; value: string }>(
      `SELECT key, value FROM web_kv`,
    );
    for (const row of rows) {
      try {
        this.cache.set(row.key, JSON.parse(row.value));
      } catch {
        // Tolerate a hand-written/legacy non-JSON value rather than losing it.
        this.cache.set(row.key, row.value);
      }
    }
  }

  get(key: string): unknown {
    return this.cache.get(key);
  }

  set(key: string, value: unknown): void {
    this.cache.set(key, value);
    void this.persist(key, value);
  }

  delete(key: string): void {
    this.cache.delete(key);
    void this.remove(key);
  }

  async setAwaited(key: string, value: unknown): Promise<void> {
    this.cache.set(key, value);
    await this.persist(key, value);
  }

  async deleteAwaited(key: string): Promise<void> {
    this.cache.delete(key);
    await this.remove(key);
  }

  private async persist(key: string, value: unknown): Promise<void> {
    await this.db.run(
      `INSERT INTO web_kv (key, value) VALUES (@key, @value)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      { key, value: JSON.stringify(value) },
    );
  }

  private async remove(key: string): Promise<void> {
    await this.db.run(`DELETE FROM web_kv WHERE key = @key`, { key });
  }
}

/**
 * Suppresses migration 034's capture triggers for the duration of `fn` by
 * setting, then clearing, `sync_state.applying` directly via SQL — the same
 * flag {@link import('@core/sync/SyncEngine').SyncEngine}'s own private
 * `setApplying` uses, and the exact flag migration 034's `APPLYING_GUARD`
 * (`(SELECT value FROM sync_state WHERE key = 'applying') IS NULL`) gates
 * every capture trigger on. Set directly with SQL here, rather than by
 * constructing a `SyncEngine`, because this runs from `main()` below before
 * any `SyncEngine`/`SyncManager` wiring exists for this device, and the flag
 * itself is just two rows in `sync_state` — no engine required to read or
 * write it.
 *
 * ONLY caller: {@link ensurePlaceholderDefaultUser} — the placeholder
 * `'default'` user + its `INITIAL_CHARTS` scaffolding is device-local
 * bootstrap state, never business data a real employee typed in, and
 * capturing it into `sync_outbox` was the root cause of a real cross-device
 * `username` collision (see that function's doc comment for the incident).
 *
 * Defensive existence check on `sync_state` itself (created by migration
 * 029, which `bootstrapDatabase` — called by `main()` before this ever runs
 * — always runs to completion): this should never actually be missing in
 * practice, but a caller that DID somehow run before migration 034 applied
 * falls back to running `fn` unsuppressed rather than crashing worker boot
 * outright over a table that isn't there yet.
 *
 * ## Suppressed INSERTs must assign `uuid` themselves
 *
 * REAL INCIDENT (caught by the import e2e spec): migration 034's
 * insert-capture trigger is ALSO what assigns a brand-new row its `uuid`
 * (`UPDATE ... SET "uuid" = ... WHERE "uuid" IS NULL` — its first
 * statement, before the outbox capture). Suppressing capture suppresses
 * that assignment too, so an INSERT made under this wrapper leaves
 * `uuid = NULL` — and the NEXT unsuppressed `DELETE` of such a row has the
 * delete-capture trigger try to write `rowUuid = NULL` into `sync_outbox`
 * (a NOT NULL column), aborting the deleting statement's whole transaction
 * with `SQLITE_CONSTRAINT_NOTNULL`. In the field that made both
 * `import:database`'s wipe-and-replace and `SyncManager.join`'s
 * `clearBootPlaceholder` blow up against a freshly-booted device's
 * placeholder rows. So: every INSERT inside `fn` must set `uuid` itself
 * (see `ensurePlaceholderDefaultUser`'s uuid backfill for the pattern).
 */
async function withCaptureSuppressed(
  driver: DatabaseDriver,
  fn: () => Promise<void>,
): Promise<void> {
  const syncStateTable = await driver.get<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_state'`,
  );
  if (!syncStateTable) {
    await fn();
    return;
  }

  await driver.run(
    `INSERT INTO sync_state (key, value) VALUES ('applying', '1')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  try {
    await fn();
  } finally {
    await driver.run(`DELETE FROM sync_state WHERE key = 'applying'`);
  }
}

/**
 * Inserts the placeholder local user (`PLACEHOLDER_USERNAME`,
 * ./placeholderUser.ts) + INITIAL_CHARTS on first boot, mirroring what
 * AuthService.register() does on desktop (src/main/services/Auth.service.ts)
 * minus password handling. Runs unconditionally on every boot: a no-op once
 * the row exists (whether created here or inherited from a pre-auth OPFS
 * database), so the migration path is simply "never touch it" — a NULL
 * `password_hash` is left as-is rather than back-filled with a fake hash,
 * and `auth:login` for this username always fails (see below), which is
 * correct: nobody ever set a real password for it.
 *
 * This keeps the Accounts screen usable with zero login step (this
 * increment's wave-A UI, and both existing e2e specs), while real
 * register/login now also work against the same `users` table for any
 * other username.
 *
 * ## Never captured into sync_outbox
 *
 * REAL INCIDENT this guards against: `users` and `chart` are both
 * replicated tables (migration 034), so this INSERT (and INITIAL_CHARTS's)
 * used to be captured into `sync_outbox` like any other local write,
 * unconditionally, on every fresh boot — regardless of whether this device
 * ever connects to sync at all. A device that then "joined" an existing
 * sync project (or simply connected while its own placeholder was still
 * pending in the outbox) pushed this throwaway placeholder onto the shared
 * project as a spurious extra `'default'` user with a NULL password hash.
 * When the REAL `'default'` user later arrived from another device, the two
 * collided on `users.username` — see `SyncEngine.applyRow`'s
 * "users.username collision" doc comment for the apply-side half of the
 * fix and the full incident this was the root cause of.
 *
 * The fix: the whole insert (user + charts) now runs wrapped in
 * {@link withCaptureSuppressed}, the same `sync_state.applying` flag
 * `SyncEngine`'s own apply path uses — this device-local scaffolding is
 * simply never captured in the first place, so there is nothing for
 * `SyncManager.join`'s boot-placeholder cleanup (syncManager.ts's
 * `clearBootPlaceholder`) to have to drain out of the outbox before a join
 * pull. That cleanup still runs (removing the local placeholder row itself,
 * which this suppression does not touch) as defense-in-depth — see its own
 * doc comment.
 */
async function ensurePlaceholderDefaultUser(
  driver: DatabaseDriver,
  chartService: ChartService,
): Promise<void> {
  const existing = await driver.get<{ id: number }>(
    `SELECT id FROM users WHERE username = @username`,
    { username: PLACEHOLDER_USERNAME },
  );
  if (existing) return;

  await withCaptureSuppressed(driver, async () => {
    await driver.run(
      `INSERT INTO users (username, password_hash, status) VALUES (@username, @password_hash, @status)`,
      { username: PLACEHOLDER_USERNAME, password_hash: null, status: 1 },
    );
    await chartService.insertCharts(PLACEHOLDER_USERNAME, INITIAL_CHARTS);

    // uuid backfill — REQUIRED under suppression, see withCaptureSuppressed's
    // "Suppressed INSERTs must assign `uuid` themselves" doc comment: the
    // insert-capture trigger that normally assigns these is suppressed right
    // now, and a NULL uuid turns every later unsuppressed DELETE of these
    // rows (import's wipe, join's clearBootPlaceholder) into a
    // SQLITE_CONSTRAINT_NOTNULL abort inside the delete-capture trigger.
    // One UPDATE per row, each with its own JS-generated uuid — a single
    // bulk `UPDATE ... SET uuid = <sql uuid expr>` would hit the
    // non-correlated-scalar-subquery trap (evaluated once per STATEMENT,
    // same uuid for every chart row — see migration 036's idempotencyKey
    // comment for the same trap) and violate the uuid unique index.
    await driver.run(
      `UPDATE users SET uuid = @uuid WHERE username = @username AND uuid IS NULL`,
      { uuid: crypto.randomUUID(), username: PLACEHOLDER_USERNAME },
    );
    const chartsMissingUuid = await driver.all<{ id: number }>(
      `SELECT c.id FROM chart c
       JOIN users u ON u.id = c.userId
       WHERE u.username = @username AND c.uuid IS NULL`,
      { username: PLACEHOLDER_USERNAME },
    );
    for (const chart of chartsMissingUuid) {
      // eslint-disable-next-line no-await-in-loop
      await driver.run(`UPDATE chart SET uuid = @uuid WHERE id = @id`, {
        uuid: crypto.randomUUID(),
        id: chart.id,
      });
    }
  });
}

type Handlers = Record<string, (...args: unknown[]) => Promise<unknown>>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function openOpfsDatabase(
  sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
        name: 'easy-accounting',
      });
      return new poolUtil.OpfsSAHPoolDb('/easy-accounting.sqlite3');
    } catch (error) {
      lastError = error;
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.min(2000, 200 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function main(): Promise<void> {
  const sqlite3 = await sqlite3InitModule();

  const sqliteDb = await openOpfsDatabase(sqlite3);

  const driver = new SqliteWasmDriver(sqlite3, sqliteDb);
  await bootstrapDatabase(driver);
  try {
    await driver.compactIfNeeded();
  } catch (error) {
    console.warn('Startup compact failed:', error);
  }

  const webKv = new WebKv(driver);
  await webKv.load();

  let currentUsername = webKv.get('username') as string | undefined;
  const hasRealSession =
    typeof currentUsername === 'string' &&
    currentUsername.length > 0 &&
    currentUsername !== PLACEHOLDER_USERNAME;

  const turn = createTurnQueue();

  // BYOK sync: device-scoped connect wizard + background sync loop (see
  // syncManager.ts's doc comment). Config lives in web_kv, independent of
  // which business user is signed in. `bootIfConfigured` is local-only
  // (constructs the transport; `startLoop` fires `ensureCycle` without
  // awaiting it) so awaiting it does not delay `ready` on a network trip.
  // Logged-out boots pass `startLoop: false` so Safari Login is not
  // competing with a 288k-row pull; `resumeBackgroundLoop` after
  // auth:login starts it. The loop itself is armed only after this
  // function's own driver work, on the same turn queue as RPCs.
  const syncManager = new SyncManager({
    db: driver,
    kv: webKv,
    notify: (message) => self.postMessage(message),
    background: (fn) => {
      void turn(fn);
    },
  });
  driver.setMutationListener(() => {
    syncManager.scheduleDebouncedSync();
  });
  await syncManager.bootIfConfigured({ startLoop: false });

  // every path that ends the session (logout, import, rebuild) goes through
  // here so none of them leaves the background poll running on Login
  const clearSession = async (): Promise<void> => {
    currentUsername = undefined;
    await webKv.deleteAwaited('username');
    syncManager.pauseBackgroundLoop();
  };

  // Session: which user is "logged in" right now. Sourced from web_kv's
  // 'username' key (durable across page reloads, the web counterpart of
  // desktop's electron-store-backed `store.get('username')` — see
  // src/main/coreRuntime.ts) and updated in place by auth:login/register/
  // logout below. `getUsername` itself must stay synchronous (the
  // SessionContext port contract), which `currentUsername` — a plain
  // in-memory mirror of the persisted value — satisfies.
  const session: SessionContext = { getUsername: () => currentUsername };

  // account, chart, ledger, pricing, inventory, journal, statement and
  // invoice: the full platform-free core (src/core), wired exactly like
  // src/main/coreRuntime.ts's createCoreServices().
  const accountService = new AccountService({ db: driver, session });
  const chartService = new ChartService({ db: driver, session });
  const agentTourService = new AgentTourService({ db: driver, session });
  const ledgerService = new LedgerService({ db: driver, session });
  const pricingService = new PricingService({ db: driver, session });
  const vendorStockService = new VendorStockService({ db: driver });
  const inventoryService = new InventoryService({
    db: driver,
    session,
    store: webKv,
    vendorStockService,
  });
  const journalService = new JournalService({
    db: driver,
    session,
    ledgerService,
  });
  const statementService = new StatementService({
    db: driver,
    session,
    chartService,
    accountService,
    ledgerService,
  });
  const invoiceService = new InvoiceService({
    db: driver,
    session,
    journalService,
    accountService,
    pricingService,
    vendorStockService,
  });
  const settingsService = new SettingsService({ db: driver });
  const commissionService = new CommissionService({
    db: driver,
    journalService,
  });

  // One-time, per-device migration of the publish feature's eleven
  // non-secret connection fields out of web_kv into the settings table
  // (see ./publishConfig.ts). Must run after bootstrapDatabase and
  // webKv.load(), and is deliberately NOT capture-suppressed — these
  // copies must reach other devices.
  await migratePublishConnectionToSettings(webKv, settingsService);

  const publishService = new WebPublishService(
    driver,
    webKv,
    () => getWebPublishConfig(webKv, settingsService),
    () => getWebPublishSecrets(webKv),
    (event) => {
      self.postMessage({ type: 'publish-progress', event });
    },
  );

  await ensurePlaceholderDefaultUser(driver, chartService);
  // No real session persisted yet (fresh worker, never logged in on this
  // origin) — fall back to the placeholder user so the Accounts screen (and
  // both pre-existing e2e specs, which never call auth:login) keep working
  // exactly as before this increment. A real auth:login overwrites
  // `currentUsername` below and that takes over on every subsequent boot via
  // the web_kv-persisted value above.
  if (currentUsername === undefined) {
    currentUsername = PLACEHOLDER_USERNAME;
  }

  // account:* / chart:* / journal:* / ledger:* / invoice:* / inventory:* /
  // pricing:* / statement & report / auth:* / settings — the AppApi
  // (src/core/api/AppApi.ts) surface that src/core's services can serve.
  // Method names and handler bodies match src/main/main.ts's ipcMain
  // wiring for that subset (including the
  // enrichLedgerRowsWithJournalSummaries wrapping on ledger reads) so
  // src/api/client.ts can expose the real `AppApi` type directly.
  // print:*/backup:* are intentionally absent here — client.ts stubs those
  // without ever reaching this worker.
  const handlers: Handlers = {
    // -- Auth --------------------------------------------------------------
    login: async (user) => {
      const credentials = user as UserCredentials;
      const typedUsername = credentials.username.trim();
      const typedPassword = credentials.password;
      if (!typedUsername || !typedPassword) return false;

      const dbUser = await driver.get<{
        username: string;
        password_hash: unknown;
      }>(
        `SELECT username, password_hash FROM users WHERE username = @username COLLATE NOCASE`,
        { username: typedUsername },
      );
      if (!dbUser) {
        const listed = await driver.all<{ username: string }>(
          `SELECT username FROM users ORDER BY username`,
        );
        const names = listed.map((row) => row.username).join(', ');
        throw new Error(
          names
            ? `No account named "${typedUsername}" on this phone. Accounts here: ${names}.`
            : `No accounts on this phone. Do not Join again if Chrome still has the books — use that copy.`,
        );
      }

      const storedHash = coerceStoredPasswordHash(dbUser.password_hash);
      const passwordsToTry = [typedPassword];
      const trimmed = typedPassword.trim();
      if (trimmed && trimmed !== typedPassword) passwordsToTry.push(trimmed);

      let isValid = false;
      for (const candidate of passwordsToTry) {
        // eslint-disable-next-line no-await-in-loop
        const ok =
          (await verifyPassword(candidate, storedHash)) ||
          (isDesktopFormatHash(storedHash) &&
            (await verifyDesktopPassword(candidate, storedHash!)));
        if (ok) {
          isValid = true;
          break;
        }
      }

      // null password_hash is a failed login. do not store the typed
      // password — knowing the username would otherwise claim the account.
      // the device that has the real hash must sync it.
      if (!isValid) return false;

      currentUsername = dbUser.username;
      await webKv.setAwaited('username', dbUser.username);
      syncManager.resumeBackgroundLoop();
      return true;
    },
    register: async (user) => {
      const credentials = user as UserCredentials;
      if (credentials.username.length < 4 || credentials.password.length < 4) {
        return false;
      }
      const existing = await driver.get<{ id: number }>(
        `SELECT id FROM users WHERE username = @username`,
        { username: credentials.username },
      );
      if (existing) return false;

      const passwordHash = await hashPassword(credentials.password);
      await driver.run(
        `INSERT INTO users (username, password_hash, status) VALUES (@username, @password_hash, @status)`,
        {
          username: credentials.username,
          password_hash: passwordHash,
          status: 1,
        },
      );
      await chartService.insertCharts(credentials.username, INITIAL_CHARTS);
      return true;
    },
    logout: clearSession,

    // -- "Bring your database" import (see src/core/db/import.ts) ----------
    //
    // Two-call flow driven by the same RPC method, distinguished by
    // `confirm`: `confirm: false` (or omitted) validates the upload and
    // returns a row-count preview with NO write to the OPFS database at
    // all — safe to call the moment a file is chosen, before the user has
    // agreed to anything. `confirm: true` performs the actual
    // replace-import (see src/renderer/views/Import for the two-step UI
    // this drives) and additionally clears the current session exactly
    // like `logout` above: the just-wiped-and-reimported `users` table may
    // no longer contain whoever was previously signed in on this origin, so
    // the caller-side session (both this worker's `currentUsername`/web_kv
    // AND the main thread's localStorage mirror — see electronShim.ts's
    // `importDatabase` wrapper) must not silently keep pointing at them.
    'import:database': async (bytesArg, confirmArg) => {
      const bytes = new Uint8Array(bytesArg as ArrayBuffer);
      const confirm = confirmArg === true;

      if (!looksLikeSqliteFile(bytes)) {
        return { ok: false, reason: 'That file is not a SQLite database.' };
      }

      const sourceDb = openDeserializedDatabase(sqlite3, bytes);
      try {
        const source = new SqliteWasmDriver(sqlite3, sourceDb);

        if (!confirm) {
          // Preview only — validateUploadedDatabase never writes.
          return await validateUploadedDatabase(source);
        }

        const validation = await validateUploadedDatabase(source);
        if (!validation.ok) return validation;

        const summary = await runImportDatabase({ source, target: driver });
        await clearSession();
        return { ok: true, ...summary };
      } finally {
        sourceDb.close();
      }
    },

    // -- "Export my data" (see the file doc comment above for the snapshot-
    // consistency argument and why this lives outside AppApi) -------------
    //
    // sqlite3.capi.sqlite3_js_db_export is the wasm binding's documented
    // inverse of ./deserializeDatabase.ts's sqlite3_deserialize call: a thin
    // wrapper over sqlite3_serialize() that copies the live database's pages
    // out of wasm memory into a fresh Uint8Array (see that binding's own doc
    // comment — it internally does a `heap8u().slice(...)`, so the returned
    // buffer is an independent copy, not a view over wasm heap memory that
    // could be invalidated by a later allocation). `.buffer` is transferred
    // (not cloned) to the main thread below — see the postMessage call at
    // the bottom of this file.
    'export:database': async () => {
      const bytes = sqlite3.capi.sqlite3_js_db_export(sqliteDb.pointer!);
      return bytes.buffer;
    },

    // -- Account -------------------------------------------------------------
    getAccounts: () => accountService.getAccounts(),
    getAccountsByIds: (ids) => accountService.getAccountsByIds(ids as number[]),
    getAccountByName: (name) => accountService.getAccountByName(name as string),
    getAccountByNameAndCode: (name, code) =>
      accountService.getAccountByNameAndCode(
        name as string,
        code as string | undefined,
      ),
    getAccountByNameAndChart: (chartId, name) =>
      accountService.getAccountByNameAndChart(
        chartId as number,
        name as string,
      ),
    checkAccountCode: (code, excludeAccountId) =>
      accountService.findAccountCodeConflicts(
        code as string | number,
        excludeAccountId as number | undefined,
      ),
    insertAccount: (account) =>
      accountService.insertAccount(
        account as Parameters<AccountService['insertAccount']>[0],
      ),
    updateAccount: (account) =>
      accountService.updateAccount(
        account as Parameters<AccountService['updateAccount']>[0],
      ),
    bulkUpdateAccountUrduFields: (patches) =>
      accountService.bulkUpdateUrduFields(
        patches as Parameters<AccountService['bulkUpdateUrduFields']>[0],
      ),
    updateAccountDiscountProfile: (accountId, discountProfileId) =>
      accountService.updateAccountDiscountProfile(
        accountId as number,
        discountProfileId as number | null,
      ),
    hasJournalEntries: (accountId) =>
      accountService.hasJournalEntries(accountId as number),
    deleteAccount: (accountId) =>
      accountService.deleteAccount(accountId as number),
    setAccountCollectionRole: (accountId, role) =>
      accountService.setCollectionRole(
        accountId as number,
        role as Parameters<AccountService['setCollectionRole']>[1],
      ),
    toggleAccountActive: (accountId, isActive) =>
      accountService.toggleAccountActive(
        accountId as number,
        isActive as boolean,
      ),

    // -- Chart -----------------------------------------------------------
    getCharts: () => chartService.getCharts(),
    insertCustomHead: (chart) =>
      chartService.insertCustomHead(
        chart as Parameters<ChartService['insertCustomHead']>[0],
      ),
    updateCustomHeadName: (chartId, name) =>
      chartService.updateCustomHeadName(chartId as number, name as string),
    updateCustomHeadUrdu: (chartId, nameUrdu) =>
      chartService.updateCustomHeadUrdu(
        chartId as number,
        nameUrdu as string | null,
      ),

    // -- Agent tours -------------------------------------------------------
    getAgentTours: (chartId) =>
      agentTourService.getAgentTours(chartId as number),
    insertAgentTour: (tour) =>
      agentTourService.insertAgentTour(
        tour as Parameters<AgentTourService['insertAgentTour']>[0],
      ),
    insertAgentTours: (tours) =>
      agentTourService.insertAgentTours(
        tours as Parameters<AgentTourService['insertAgentTours']>[0],
      ),
    updateAgentTour: (id, tour) =>
      agentTourService.updateAgentTour(
        id as number,
        tour as Parameters<AgentTourService['updateAgentTour']>[1],
      ),
    deleteAgentTour: (id) => agentTourService.deleteAgentTour(id as number),
    suggestAgentTours: (chartId) =>
      agentTourService.suggestAgentTours(chartId as number),

    // -- Journal ---------------------------------------------------------
    getNextJournalId: () => journalService.getNextJournalId(),
    insertJournal: (journal) =>
      journalService.insertJournal(
        journal as Parameters<JournalService['insertJournal']>[0],
      ),
    getJournals: () => journalService.getJournals(),
    getJournal: (journalId) => journalService.getJournal(journalId as number),
    getJournalNarrationSummariesByIds: (journalIds) =>
      journalService.getJournalNarrationSummariesByIds(journalIds as number[]),
    getJournalsByInvoiceId: (invoiceId) =>
      journalService.getJournalsByInvoiceId(invoiceId as number),
    updateJournalNarration: (journalId, narration) =>
      journalService.updateJournalNarration(
        journalId as number,
        narration as string,
      ),
    updateJournalInfo: (journalId, fields) =>
      journalService.updateJournalInfo(
        journalId as number,
        fields as Parameters<JournalService['updateJournalInfo']>[1],
      ),
    reverseJournal: (journalId, options) =>
      journalService.reverseJournal(
        journalId as number,
        options as Parameters<JournalService['reverseJournal']>[1],
      ),
    deleteManualJournal: (journalId) =>
      journalService.deleteManualJournal(journalId as number),

    // -- Ledger ------------------------------------------------------------
    getLedger: async (accountId) => {
      const rows = await ledgerService.getLedger(accountId as number);
      return enrichLedgerRowsWithJournalSummaries(rows, journalService);
    },
    getLedgerBalance: async (accountId) =>
      (await ledgerService.getBalance(accountId as number)) ?? null,
    getLedgerBalancesForAccountIds: (accountIds) =>
      ledgerService.getBalancesForAccountIds(accountIds as number[]),
    getLedgerBalancesForAccountIdsAsOfDate: (accountIds, asOfDate) =>
      ledgerService.getBalancesForAccountIdsAsOfDate(
        accountIds as number[],
        asOfDate as string,
      ),
    getLedgerRangeForAccountIds: async (accountIds, startDate, endDate) => {
      const ids = accountIds as number[];
      const map = await ledgerService.getLedgerRangeForAccountIds(
        ids,
        startDate as string,
        endDate as string,
      );
      const unique = [
        ...new Set(ids.filter((id) => Number.isInteger(id) && id > 0)),
      ].sort((a, b) => a - b);
      const flat = unique.flatMap((id) => map[id] ?? []);
      const enriched = await enrichLedgerRowsWithJournalSummaries(
        flat,
        journalService,
      );
      const result: Record<number, typeof enriched> = {};
      for (const id of unique) {
        result[id] = [];
      }
      for (const row of enriched) {
        result[row.accountId].push(row);
      }
      return result;
    },
    getLedgersUpToDateForAccountIds: (accountIds, endDate) =>
      ledgerService.getLedgersUpToDateForAccountIds(
        accountIds as number[],
        endDate as string,
      ),
    getReceiptSumsForAccountIdsInRange: (accountIds, startDate, endDate) =>
      ledgerService.getReceiptSumsForAccountIdsInRange(
        accountIds as number[],
        startDate as string,
        endDate as string,
      ),
    getTourCollectionsForAccountIds: (
      accountIds,
      tourIds,
      startDate,
      endDate,
    ) =>
      ledgerService.getTourCollectionsForAccountIds(
        accountIds as number[],
        tourIds as number[],
        (startDate as string | null | undefined) ?? null,
        (endDate as string | null | undefined) ?? null,
      ),
    getUntouredCollectionsForAccountIds: (
      accountIds,
      chartId,
      startDate,
      endDate,
    ) =>
      ledgerService.getUntouredCollectionsForAccountIds(
        accountIds as number[],
        chartId as number,
        startDate as string,
        endDate as string,
      ),
    getCollectionSources: (chartId, startDate, endDate) =>
      ledgerService.getCollectionSources(
        chartId as number,
        startDate as string,
        endDate as string,
      ),

    // -- Invoice -----------------------------------------------------------
    getNextInvoiceNumber: (invoiceType) =>
      invoiceService.getNextInvoiceNumber(
        invoiceType as Parameters<InvoiceService['getNextInvoiceNumber']>[0],
      ),
    insertInvoice: (invoiceType, invoice) =>
      invoiceService.insertInvoice(
        invoiceType as Parameters<InvoiceService['insertInvoice']>[0],
        invoice as Parameters<InvoiceService['insertInvoice']>[1],
      ),
    insertQuotation: (invoiceType, invoice) =>
      invoiceService.insertQuotationInvoice(
        invoiceType as Parameters<InvoiceService['insertQuotationInvoice']>[0],
        invoice as Parameters<InvoiceService['insertQuotationInvoice']>[1],
      ),
    getQuotations: (invoiceType) =>
      invoiceService.getQuotationInvoices(
        invoiceType as Parameters<InvoiceService['getQuotationInvoices']>[0],
      ),
    updateQuotation: (invoiceId, invoice) =>
      invoiceService.updateQuotationInvoice(
        invoiceId as number,
        invoice as Parameters<InvoiceService['updateQuotationInvoice']>[1],
      ),
    convertQuotation: (invoiceId) =>
      invoiceService.convertQuotationInvoice(invoiceId as number),
    updateInvoice: (invoiceType, invoiceId, invoice) =>
      invoiceService.updateInvoice(
        invoiceType as Parameters<InvoiceService['updateInvoice']>[0],
        invoiceId as number,
        invoice as Parameters<InvoiceService['updateInvoice']>[2],
      ),
    getInvoices: (invoiceType) =>
      invoiceService.getInvoices(
        invoiceType as Parameters<InvoiceService['getInvoices']>[0],
      ),
    getInvoice: (invoiceId) => invoiceService.getInvoice(invoiceId as number),
    returnSaleInvoice: (invoiceId, payload) =>
      invoiceService.returnSaleInvoice(
        invoiceId as number,
        payload as Parameters<InvoiceService['returnSaleInvoice']>[1],
      ),
    returnPurchaseInvoice: (invoiceId, payload) =>
      invoiceService.returnPurchaseInvoice(
        invoiceId as number,
        payload as Parameters<InvoiceService['returnPurchaseInvoice']>[1],
      ),
    getInvoiceEditDateBounds: (
      invoiceId,
      accountId,
      invoiceNumber,
      invoiceType,
    ) =>
      invoiceService.getInvoiceEditDateBounds(
        invoiceId as number,
        accountId as number,
        invoiceNumber as number,
        invoiceType as Parameters<
          InvoiceService['getInvoiceEditDateBounds']
        >[3],
      ),
    updateInvoiceBiltyAndCartons: (invoiceId, biltyNumber, cartons) =>
      invoiceService.updateInvoiceBiltyAndCartons(
        invoiceId as number,
        biltyNumber as string | undefined,
        cartons as number | undefined,
      ),
    exportInvoices: (startDate, endDate) =>
      invoiceService.exportSaleInvoices(
        startDate as string | undefined,
        endDate as string | undefined,
      ),
    doesInvoiceExists: (invoiceId, invoiceType) =>
      invoiceService.doesInvoiceExists(
        invoiceId as number,
        invoiceType as Parameters<InvoiceService['doesInvoiceExists']>[1],
      ),
    getAdjacentInvoiceId: (invoiceId, invoiceType, direction, scope) =>
      invoiceService.getAdjacentInvoiceId(
        invoiceId as number,
        invoiceType as Parameters<InvoiceService['getAdjacentInvoiceId']>[1],
        direction as 'next' | 'previous',
        (scope as 'posted' | 'quotation' | undefined) ?? 'posted',
      ),
    getLastInvoiceNumber: (invoiceType) =>
      invoiceService.getLastInvoiceNumber(
        invoiceType as Parameters<InvoiceService['getLastInvoiceNumber']>[0],
      ),
    getSaleBillsForAccountIdsInRange: (accountIds, startDate, endDate) =>
      invoiceService.getSaleBillsForAccountIdsInRange(
        accountIds as number[],
        startDate as string,
        endDate as string,
      ),
    getInvoiceIdsFromMinId: (invoiceType, fromInvoiceId, scope) =>
      invoiceService.getInvoiceIdsFromMinId(
        invoiceType as Parameters<InvoiceService['getInvoiceIdsFromMinId']>[0],
        fromInvoiceId as number,
        (scope as 'posted' | 'quotation' | undefined) ?? 'posted',
      ),
    getInvoicePdfOutputBaseName: (invoiceId, invoiceType) =>
      invoiceService.getInvoicePdfOutputBaseName(
        invoiceId as number,
        invoiceType as Parameters<
          InvoiceService['getInvoicePdfOutputBaseName']
        >[1],
      ),
    getAutoDiscount: (accountId, inventoryId) =>
      pricingService.getAutoDiscount(
        accountId as number,
        inventoryId as number,
      ),

    // -- Inventory (items, opening stock, adjustments, attributes) -------
    saveInventory: (inventory) =>
      inventoryService.saveInventory(
        inventory as Parameters<InventoryService['saveInventory']>[0],
      ),
    getInventory: () => inventoryService.getInventory(),
    doesInventoryExist: () => inventoryService.doesInventoryExist(),
    insertInventoryItem: (item) =>
      inventoryService.insertItem(
        item as Parameters<InventoryService['insertItem']>[0],
      ),
    updateInventoryItem: (item) =>
      inventoryService.updateItem(
        item as Parameters<InventoryService['updateItem']>[0],
      ),
    toggleInventoryActive: (id, isActive) =>
      inventoryService.toggleInventoryActive(id as number, isActive as boolean),
    hasInventoryInvoiceItems: (id) =>
      inventoryService.hasInvoiceItems(id as number),
    canDeleteInventoryItem: (id) =>
      inventoryService.canDeleteInventoryItem(id as number),
    deleteInventoryItem: (id) =>
      inventoryService.deleteInventoryItem(id as number),
    bulkUpdateInventoryUrduFields: (patches) =>
      inventoryService.bulkUpdateUrduFields(
        patches as Parameters<InventoryService['bulkUpdateUrduFields']>[0],
      ),
    bulkUpdateInventoryAttributeFields: (patches) =>
      inventoryService.bulkUpdateAttributeFields(
        patches as Parameters<InventoryService['bulkUpdateAttributeFields']>[0],
      ),
    setInventoryParentId: (inventoryId, parentId) =>
      inventoryService.setInventoryParentId(
        inventoryId as number,
        parentId as number | null,
      ),
    bulkUpdateInventoryPricesAndListPositions: (patches) =>
      inventoryService.bulkUpdatePricesAndListPositions(
        patches as Parameters<
          InventoryService['bulkUpdatePricesAndListPositions']
        >[0],
      ),
    applyInventoryListPositions: (rows) =>
      inventoryService.applyListPositions(
        rows as Parameters<InventoryService['applyListPositions']>[0],
      ),
    getOpeningStock: () => inventoryService.getOpeningStock(),
    setOpeningStock: (items, asOfDate, resetOthersToZero) =>
      inventoryService.setOpeningStock(
        items as Parameters<InventoryService['setOpeningStock']>[0],
        asOfDate as string | undefined,
        resetOthersToZero as boolean | undefined,
      ),
    applyStockAdjustment: (payload) =>
      inventoryService.applyStockAdjustment(
        payload as Parameters<InventoryService['applyStockAdjustment']>[0],
      ),
    getStockAdjustments: (inventoryId) =>
      inventoryService.getStockAdjustments(inventoryId as number | undefined),
    getInventoryIdsWithHistory: () =>
      inventoryService.getInventoryIdsWithHistory(),
    getAttributeDefinitions: () => inventoryService.getAttributeDefinitions(),
    upsertAttributeDefinition: (input) =>
      inventoryService.upsertAttributeDefinition(
        input as Parameters<InventoryService['upsertAttributeDefinition']>[0],
      ),
    deleteAttributeDefinition: (id, force) =>
      inventoryService.deleteAttributeDefinition(
        id as number,
        (force as boolean) ?? false,
      ),
    reorderAttributeDefinitions: (ids) =>
      inventoryService.reorderAttributeDefinitions(ids as number[]),
    setItemExcludedFromCatalog: (id, excluded) =>
      inventoryService.setItemExcludedFromCatalog(
        id as number,
        excluded as boolean,
      ),
    setAttributeDefinitionPublic: (id, isPublic) =>
      inventoryService.setAttributeDefinitionPublic(
        id as number,
        isPublic as boolean,
      ),
    setAttributeDefinitionActive: (id, isActive) =>
      inventoryService.setAttributeDefinitionActive(
        id as number,
        isActive as boolean,
      ),
    updateInventoryAttributes: (id, attributes) =>
      inventoryService.updateInventoryAttributes(
        id as number,
        attributes as Record<string, unknown>,
      ),

    // -- Pricing (item types, discount profiles) --------------------------
    getItemTypes: () => pricingService.getItemTypes(),
    insertItemType: (name) => pricingService.insertItemType(name as string),
    updateItemTypeName: (id, name) =>
      pricingService.updateItemTypeName(id as number, name as string),
    toggleItemTypeActive: (id, isActive) =>
      pricingService.toggleItemType(id as number, isActive as boolean),
    deleteItemType: (id) => pricingService.deleteItemType(id as number),
    getPrimaryItemType: () => pricingService.getPrimaryItemType(),
    setPrimaryItemType: (itemTypeId) =>
      pricingService.setPrimaryItemType(itemTypeId as number),
    clearPrimaryItemType: () => pricingService.clearPrimaryItemType(),
    getDiscountProfiles: () => pricingService.getDiscountProfiles(),
    insertDiscountProfile: (name) =>
      pricingService.insertDiscountProfile(name as string),
    updateDiscountProfileName: (id, name) =>
      pricingService.updateDiscountProfileName(id as number, name as string),
    toggleDiscountProfileActive: (id, isActive) =>
      pricingService.toggleDiscountProfile(id as number, isActive as boolean),
    deleteDiscountProfile: (id) =>
      pricingService.deleteDiscountProfile(id as number),
    deleteDiscountProfileFromAccount: (accountId, profileId) =>
      pricingService.deleteDiscountProfileFromAccount(
        accountId as number,
        profileId as number,
      ),
    getDiscountProfileTypeDiscounts: (profileId) =>
      pricingService.getProfileTypeDiscounts(profileId as number),
    saveDiscountProfileTypeDiscounts: (profileId, discounts) =>
      pricingService.saveProfileTypeDiscounts(
        profileId as number,
        discounts as Parameters<PricingService['saveProfileTypeDiscounts']>[1],
      ),

    // -- Statement / Balance Sheet / Reports -------------------------------
    saveBalanceSheet: (balanceSheet) =>
      statementService.saveBalanceSheet(
        balanceSheet as Parameters<StatementService['saveBalanceSheet']>[0],
      ),
    reportGetLedgerRange: async (params) => {
      const { accountId, startDate, endDate } = params as {
        accountId: number;
        startDate: string;
        endDate: string;
      };
      // opening balance should be "as of before startDate"
      // closing balance should include endDate (use endDate + 1 day with the existing "< date" query)
      const closingExclusiveDate = format(
        addDays(parse(endDate, 'yyyy-MM-dd', new Date()), 1),
        'yyyy-MM-dd',
      );
      const [open, entries, close] = await Promise.all([
        ledgerService.getBalanceAtDate(accountId, startDate),
        ledgerService.getLedgerRange(accountId, startDate, endDate),
        ledgerService.getBalanceAtDate(accountId, closingExclusiveDate),
      ]);
      const enrichedEntries = await enrichLedgerRowsWithJournalSummaries(
        entries,
        journalService,
      );
      return {
        openingBalance: open,
        entries: enrichedEntries,
        closingBalance: close,
      };
    },
    reportGetInventoryHealth: (filters) =>
      inventoryService.getInventoryHealth(
        filters as Parameters<InventoryService['getInventoryHealth']>[0],
      ),
    reportGetStockAsOf: (filters) =>
      inventoryService.getStockAsOf(
        filters as Parameters<InventoryService['getStockAsOf']>[0],
      ),
    reportGetSalesPerformance: (filters) =>
      invoiceService.getSalesPerformance(
        filters as Parameters<InvoiceService['getSalesPerformance']>[0],
      ),
    reportGetPurchasesByVendor: (filters) =>
      invoiceService.getPurchasesByVendor(
        filters as Parameters<InvoiceService['getPurchasesByVendor']>[0],
      ),
    reportGetSalesByCustomer: (filters) =>
      invoiceService.getSalesByCustomer(
        filters as Parameters<InvoiceService['getSalesByCustomer']>[0],
      ),

    getVendorStockOnHand: (vendorAccountId) =>
      vendorStockService.getOnHand(vendorAccountId as number | undefined),
    getTrackedVendorAccounts: () =>
      vendorStockService.getTrackedVendorAccounts(),
    setVendorOpeningStock: (
      vendorAccountId,
      items,
      asOfDate,
      resetOthersToZero,
    ) =>
      vendorStockService.setOpeningStock(
        vendorAccountId as number,
        items as Parameters<VendorStockService['setOpeningStock']>[1],
        asOfDate as string,
        resetOthersToZero as boolean | undefined,
      ),
    importVendorOpeningStock: (rows, asOfDate, resetOthersToZero) =>
      vendorStockService.importOpeningStock(
        rows as Parameters<VendorStockService['importOpeningStock']>[0],
        asOfDate as string,
        resetOthersToZero as boolean | undefined,
      ),
    getNextVendorIssueNumber: () => vendorStockService.getNextIssueNumber(),
    createVendorIssue: (payload) =>
      vendorStockService.createIssue(
        payload as Parameters<VendorStockService['createIssue']>[0],
      ),
    updateVendorIssue: (issueId, payload) =>
      vendorStockService.updateIssue(
        issueId as number,
        payload as Parameters<VendorStockService['updateIssue']>[1],
      ),
    deleteVendorIssue: (issueId) =>
      vendorStockService.deleteIssue(issueId as number),
    getVendorIssues: () => vendorStockService.getIssues(),
    getVendorIssue: (issueId) => vendorStockService.getIssue(issueId as number),
    getVendorStockActivity: (filters) =>
      vendorStockService.getActivity(
        filters as Parameters<VendorStockService['getActivity']>[0],
      ),

    // -- Settings (src/core/services/SettingsService.ts, migration 033) ----
    getSetting: (key) => settingsService.get(key as string),
    setSetting: (key, value) => settingsService.set(key as string, value),
    deleteSetting: (key) => settingsService.delete(key as string),
    getAllSettings: () => settingsService.getAll(),

    // -- Commission (src/core/services/CommissionService.ts, migration 047) -
    commissionGetConfig: (chartId) =>
      commissionService.getCommissionConfig(chartId as number),
    commissionSaveConfig: (config) =>
      commissionService.saveCommissionConfig(
        config as Parameters<CommissionService['saveCommissionConfig']>[0],
      ),
    commissionGetReport: (chartId, startDate, endDate) =>
      commissionService.getCommissionReport(
        chartId as number,
        startDate as string,
        endDate as string,
      ),
    commissionPostSettlement: (payload) =>
      commissionService.postCommissionSettlement(
        payload as Parameters<CommissionService['postCommissionSettlement']>[0],
      ),
    commissionUnpostSettlement: (settlementId) =>
      commissionService.unpostCommissionSettlement(settlementId as number),

    // -- Publish (./publishConfig.ts + ./publishService.ts) ----------------
    getPublishConfig: () => getWebPublishConfig(webKv, settingsService),
    savePublishConfig: (input) =>
      saveWebPublishConfig(
        webKv,
        settingsService,
        input as Parameters<typeof saveWebPublishConfig>[2],
      ),
    getPriceListNames: () => publishService.getPriceListNames(),
    getPriceLists: () => publishService.getPriceLists(),
    createPriceList: (name) => publishService.createPriceList(name as string),
    renamePriceList: (id, name) =>
      publishService.renamePriceList(id as number, name as string),
    setPriceListActive: (id, isActive) =>
      publishService.setPriceListActive(id as number, isActive as boolean),
    previewPriceListSeed: (priceListId, options, inventoryIds) =>
      publishService.previewSeed(
        priceListId as number,
        options as Parameters<WebPublishService['previewSeed']>[1],
        inventoryIds as number[] | undefined,
      ),
    applyPriceListSeed: (priceListId, options, inventoryIds) =>
      publishService.applySeed(
        priceListId as number,
        options as Parameters<WebPublishService['applySeed']>[1],
        inventoryIds as number[] | undefined,
      ),
    getItemPublishStatuses: () => publishService.getItemPublishStatuses(),
    previewCatalog: () => publishService.previewCatalog(),
    runPublish: (force) => publishService.publish((force as boolean) ?? false),
    getLastPublishResult: () => Promise.resolve(publishService.getLastResult()),

    // -- Sync (BYOK connect wizard + background loop — see syncManager.ts) -
    'sync:getStatus': () => syncManager.getStatus(),
    'sync:connect': (config) =>
      syncManager.connect(config as Parameters<SyncManager['connect']>[0]),
    'sync:disconnect': () => syncManager.disconnect(),
    'sync:syncNow': () => syncManager.syncNow(),
    // "Join existing sync" (Login screen, second-device flow) — validates
    // like sync:connect, then pulls the whole project's history down BEFORE
    // this call resolves (see syncManager.ts's `SyncManager.join`), so the
    // renderer can send the user to Login with their real, just-synced
    // account already present locally.
    'sync:join': (config) =>
      syncManager.join(config as Parameters<SyncManager['join']>[0]),
    // "Re-download everything from sync" (Settings screen's Advanced row,
    // a device repair action — see SyncEngine.rebuildFromServer's doc
    // comment for the full incident and mechanism, and
    // syncManager.ts's `SyncManager.rebuild` for the connected-transport
    // precondition). The users table is wholly replaced by a rebuild, so —
    // exactly like `import:database`'s confirmed path above — this device's
    // session no longer necessarily names a user who still exists: clear it
    // on success so the renderer doesn't keep pointing at a stale login.
    // Left untouched on failure (nothing was changed — see
    // `rebuildFromServer`'s "refuses against an empty server" doc comment).
    'sync:rebuild': async () => {
      const result = await syncManager.rebuild();
      if (result.ok) {
        await clearSession();
      }
      return result;
    },
    // Settings "Add a device" QR/copy-link — Project URL + anon key of the
    // currently-connected project (null when disconnected or mock). See
    // SyncManager.getJoinInvite.
    'sync:getJoinInvite': () => Promise.resolve(syncManager.getJoinInvite()),

    // localhost playwright only. holds a transaction across several awaits
    // so a second RPC can sit pending. rolls the temp table back.
    'debug:txHold': async () => {
      if (!isLocalDebugHost()) throw new Error('debug rpc is local only');
      let innerCount = -1;
      try {
        await driver.transaction(async () => {
          await driver.exec(
            'CREATE TEMP TABLE IF NOT EXISTS _debug_tx (v TEXT)',
          );
          await driver.run('DELETE FROM _debug_tx');
          await driver.run(`INSERT INTO _debug_tx (v) VALUES ('inside')`);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 400);
          });
          const row = await driver.get<{ c: number }>(
            'SELECT COUNT(*) AS c FROM _debug_tx',
          );
          innerCount = row?.c ?? -1;
          throw new Error('abort');
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'abort') throw error;
      }
      return { innerCount };
    },
    'debug:txProbe': async () => {
      if (!isLocalDebugHost()) throw new Error('debug rpc is local only');
      await driver.exec('CREATE TEMP TABLE IF NOT EXISTS _debug_tx (v TEXT)');
      await driver.run(`INSERT INTO _debug_tx (v) VALUES ('outside')`);
      const row = await driver.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM _debug_tx',
      );
      return { count: row?.c ?? -1 };
    },
    'debug:seedBulkJournals': async (rawArgs: unknown) => {
      if (!isLocalDebugHost()) throw new Error('debug rpc is local only');
      const params = rawArgs as {
        debitAccountId: number;
        creditAccountId: number;
        count: number;
        startDateIso: string;
        baseAmount: number;
      };
      const {
        debitAccountId,
        creditAccountId,
        count,
        startDateIso,
        baseAmount,
      } = params;
      const startMs = new Date(startDateIso).getTime();
      return driver.transaction(async () => {
        for (let i = 0; i < count; i++) {
          const date = new Date(startMs + i * 60_000).toISOString();
          const amount = baseAmount + (i % 25) * 10;
          const narration = `Bulk Transaction #${i + 1}`;
          // eslint-disable-next-line no-await-in-loop
          const res = await driver.run(
            'INSERT INTO journal (date, narration, isPosted) VALUES (?, ?, 1)',
            [date, narration],
          );
          const journalId = Number(res.lastInsertRowid);
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, ?, 0)',
            [journalId, debitAccountId, amount],
          );
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, ?)',
            [journalId, creditAccountId, amount],
          );
        }
        return { count };
      });
    },
    'debug:seedReportsFixtures': async (rawArgs: unknown) => {
      if (!isLocalDebugHost()) throw new Error('debug rpc is local only');
      const params = (rawArgs ?? {}) as {
        agentHeadName?: string;
        billCount?: number;
        username?: string;
      };
      const agentHeadName = params.agentHeadName ?? 'Soak Agent Head';
      const billCount = params.billCount ?? 120;
      const targetUsername =
        params.username ?? session.getUsername() ?? 'default';

      return driver.transaction(async () => {
        let user = await driver.get<{ id: number }>(
          'SELECT id FROM users WHERE username = ? LIMIT 1',
          [targetUsername],
        );
        if (!user) {
          user = await driver.get<{ id: number }>(
            'SELECT id FROM users ORDER BY id DESC LIMIT 1',
          );
        }
        if (!user) {
          const r = await driver.run(
            "INSERT INTO users (username, password_hash, status) VALUES (?, X'00', 1)",
            [targetUsername],
          );
          user = { id: Number(r.lastInsertRowid) };
        }

        let assetChart = await driver.get<{ id: number }>(
          "SELECT id FROM chart WHERE type = 'Asset' AND parentId IS NULL AND userId = ? LIMIT 1",
          [user.id],
        );
        if (!assetChart) {
          const r = await driver.run(
            "INSERT INTO chart (date, name, type, userId, parentId) VALUES ('2025-01-01', 'Current Assets', 'Asset', ?, NULL)",
            [user.id],
          );
          assetChart = { id: Number(r.lastInsertRowid) };
        }

        let agentHead = await driver.get<{ id: number }>(
          'SELECT id FROM chart WHERE name = ? AND parentId IS NOT NULL AND userId = ? LIMIT 1',
          [agentHeadName, user.id],
        );
        if (!agentHead) {
          const r = await driver.run(
            "INSERT INTO chart (date, name, type, userId, parentId) VALUES ('2025-01-01', ?, 'Asset', ?, ?)",
            [agentHeadName, user.id, assetChart.id],
          );
          agentHead = { id: Number(r.lastInsertRowid) };
        }

        let revChart = await driver.get<{ id: number }>(
          "SELECT id FROM chart WHERE type = 'Revenue' AND userId = ? LIMIT 1",
          [user.id],
        );
        if (!revChart) {
          const r = await driver.run(
            "INSERT INTO chart (date, name, type, userId, parentId) VALUES ('2025-01-01', 'Sales Revenue', 'Revenue', ?, NULL)",
            [user.id],
          );
          revChart = { id: Number(r.lastInsertRowid) };
        }
        let revAccount = await driver.get<{ id: number }>(
          'SELECT id FROM account WHERE chartId = ? LIMIT 1',
          [revChart.id],
        );
        if (!revAccount) {
          const r = await driver.run(
            "INSERT INTO account (chartId, name, code, isActive) VALUES (?, 'General Sales', 'GEN-SALE', 1)",
            [revChart.id],
          );
          revAccount = { id: Number(r.lastInsertRowid) };
        }

        let receiptAccount = await driver.get<{ id: number }>(
          "SELECT id FROM account WHERE collectionRole = 'receipt' AND chartId = ? LIMIT 1",
          [assetChart.id],
        );
        if (!receiptAccount) {
          const r = await driver.run(
            "INSERT INTO account (chartId, name, code, collectionRole, isActive) VALUES (?, 'Soak Cash Counter', 'SOAK-CASH', 'receipt', 1)",
            [assetChart.id],
          );
          receiptAccount = { id: Number(r.lastInsertRowid) };
        }

        const accountNames = [
          { name: 'Alpha Book Shop', code: 'SOAK-001', address: 'Main Bazar' },
          {
            name: 'Beta Stationery',
            code: 'SOAK-002',
            address: 'Commercial Market',
          },
          { name: 'Gamma Traders', code: 'SOAK-003', address: 'College Road' },
          {
            name: 'Delta Book Store',
            code: 'SOAK-004',
            address: 'Circular Road',
          },
          { name: 'Echo Library', code: 'SOAK-005', address: 'Urdu Bazar' },
          {
            name: 'Foxtrot Publications',
            code: 'SOAK-006',
            address: 'Anarkali',
          },
          { name: 'Golf Stationers', code: 'SOAK-007', address: 'Gulberg' },
          { name: 'Hotel Paper House', code: 'SOAK-008', address: 'Mall Road' },
          {
            name: 'India Book Depot',
            code: 'SOAK-009',
            address: 'Sadar Bazar',
          },
          {
            name: 'Juliet Academy Shop',
            code: 'SOAK-010',
            address: 'Ferozepur Road',
          },
          {
            name: 'Kilo Uniform & Books',
            code: 'SOAK-011',
            address: 'Johar Town',
          },
        ];
        const accounts: { id: number; name: string; code: string }[] = [];
        for (const info of accountNames) {
          // eslint-disable-next-line no-await-in-loop
          let acc = await driver.get<{
            id: number;
            name: string;
            code: string;
          }>(
            'SELECT id, name, code FROM account WHERE chartId = ? AND name = ? LIMIT 1',
            [agentHead.id, info.name],
          );
          if (!acc) {
            // eslint-disable-next-line no-await-in-loop
            const r = await driver.run(
              'INSERT INTO account (chartId, name, code, address, isActive) VALUES (?, ?, ?, ?, 1)',
              [agentHead.id, info.name, info.code, info.address],
            );
            acc = {
              id: Number(r.lastInsertRowid),
              name: info.name,
              code: info.code,
            };
          }
          accounts.push(acc);
        }

        let tour1 = await driver.get<{ id: number }>(
          "SELECT id FROM agent_tours WHERE chartId = ? AND name = 'Feb Tour 1' LIMIT 1",
          [agentHead.id],
        );
        if (!tour1) {
          const r = await driver.run(
            "INSERT INTO agent_tours (chartId, name, startDate, endDate, notes) VALUES (?, 'Feb Tour 1', '2025-02-01', '2025-02-15', 'First Feb trip')",
            [agentHead.id],
          );
          tour1 = { id: Number(r.lastInsertRowid) };
        }
        let tour2 = await driver.get<{ id: number }>(
          "SELECT id FROM agent_tours WHERE chartId = ? AND name = 'Mar Tour 2' LIMIT 1",
          [agentHead.id],
        );
        if (!tour2) {
          const r = await driver.run(
            "INSERT INTO agent_tours (chartId, name, startDate, endDate, notes) VALUES (?, 'Mar Tour 2', '2025-03-10', '2025-03-25', 'Second Mar trip')",
            [agentHead.id],
          );
          tour2 = { id: Number(r.lastInsertRowid) };
        }

        let item = await driver.get<{ id: number }>(
          'SELECT id FROM inventory LIMIT 1',
        );
        if (!item) {
          const r = await driver.run(
            "INSERT INTO inventory (name, description, price, quantity) VALUES ('Soak Sample Item', 'Sample item', 100, 100)",
          );
          item = { id: Number(r.lastInsertRowid) };
        }

        const alpha = accounts[0];
        const beta = accounts[1];
        const gamma = accounts[2];

        const nextInvNumRow = await driver.get<{ maxNum: number }>(
          "SELECT COALESCE(MAX(invoiceNumber), 0) AS maxNum FROM invoices WHERE invoiceType = 'Sale'",
        );
        const invNum1 = (nextInvNumRow?.maxNum ?? 0) + 1;
        const invNum2 = invNum1 + 1;
        const invNum3 = invNum1 + 2;
        const invNum4 = invNum1 + 3;

        const invRes1 = await driver.run(
          "INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount) VALUES (?, ?, 'Sale', '2025-02-05', 5000)",
          [invNum1, alpha.id],
        );
        const inv1Id = Number(invRes1.lastInsertRowid);
        await driver.run(
          'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId) VALUES (?, ?, 5, 1000, 0, ?)',
          [inv1Id, item.id, alpha.id],
        );

        const invRes2 = await driver.run(
          "INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount) VALUES (?, ?, 'Sale', '2025-03-12', 3500)",
          [invNum2, alpha.id],
        );
        const inv2Id = Number(invRes2.lastInsertRowid);
        await driver.run(
          'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId) VALUES (?, ?, 7, 500, 0, ?)',
          [inv2Id, item.id, alpha.id],
        );

        const invRes3 = await driver.run(
          "INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount) VALUES (?, ?, 'Sale', '2025-02-08', 5000)",
          [invNum3, beta.id],
        );
        const inv3Id = Number(invRes3.lastInsertRowid);
        await driver.run(
          'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId) VALUES (?, ?, 5, 1000, 0, ?)',
          [inv3Id, item.id, beta.id],
        );

        const invRes4 = await driver.run(
          "INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount) VALUES (?, ?, 'Sale', '2025-03-14', 8000)",
          [invNum4, gamma.id],
        );
        const inv4Id = Number(invRes4.lastInsertRowid);
        await driver.run(
          'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId) VALUES (?, ?, 8, 1000, 0, ?)',
          [inv4Id, item.id, gamma.id],
        );

        const startMs = new Date('2025-01-05T09:00:00.000Z').getTime();
        for (let i = 0; i < billCount; i++) {
          const billDate = new Date(startMs + i * 12 * 3600_000).toISOString();
          const billNumber = `BILL-${1001 + i}`;
          const amount = 1000;
          // eslint-disable-next-line no-await-in-loop
          const res = await driver.run(
            'INSERT INTO journal (date, narration, isPosted, billNumber, discountPercentage) VALUES (?, ?, 1, ?, 10)',
            [billDate, `Sales Bill #${billNumber}`, billNumber],
          );
          const jId = Number(res.lastInsertRowid);
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, ?, 0)',
            [jId, alpha.id, amount],
          );
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, ?)',
            [jId, revAccount.id, amount],
          );
        }

        const rec1 = await driver.run(
          "INSERT INTO journal (date, narration, isPosted) VALUES ('2025-02-10T11:00:00.000Z', 'Feb Tour 1 Collection', 1)",
        );
        const rec1Id = Number(rec1.lastInsertRowid);
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 40000, 0)',
          [rec1Id, receiptAccount.id],
        );
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, 40000)',
          [rec1Id, alpha.id],
        );

        const rec2 = await driver.run(
          "INSERT INTO journal (date, narration, isPosted) VALUES ('2025-03-15T14:00:00.000Z', 'Mar Tour 2 Collection', 1)",
        );
        const rec2Id = Number(rec2.lastInsertRowid);
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 20500, 0)',
          [rec2Id, receiptAccount.id],
        );
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, 20500)',
          [rec2Id, alpha.id],
        );

        const rec3 = await driver.run(
          "INSERT INTO journal (date, narration, isPosted) VALUES ('2025-04-10T10:00:00.000Z', 'Direct Bank Receipt', 1)",
        );
        const rec3Id = Number(rec3.lastInsertRowid);
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 10000, 0)',
          [rec3Id, receiptAccount.id],
        );
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, 10000)',
          [rec3Id, alpha.id],
        );

        for (let i = 0; i < 20; i++) {
          const bDate = new Date(
            new Date('2025-01-10T10:00:00.000Z').getTime() + i * 24 * 3600_000,
          ).toISOString();
          const bNum = `BETA-${101 + i}`;
          // eslint-disable-next-line no-await-in-loop
          const res = await driver.run(
            'INSERT INTO journal (date, narration, isPosted, billNumber) VALUES (?, ?, 1, ?)',
            [bDate, `Beta Bill #${bNum}`, bNum],
          );
          const jId = Number(res.lastInsertRowid);
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 1000, 0)',
            [jId, beta.id],
          );
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, 1000)',
            [jId, revAccount.id],
          );
        }
        const betaRec = await driver.run(
          "INSERT INTO journal (date, narration, isPosted) VALUES ('2025-02-12T12:00:00.000Z', 'Beta Payment', 1)",
        );
        const betaRecId = Number(betaRec.lastInsertRowid);
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 15000, 0)',
          [betaRecId, receiptAccount.id],
        );
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, 15000)',
          [betaRecId, beta.id],
        );

        // Echo Library (accounts[4]): 5 bills @ 1000 = 5000, receipt = 8000 (3000 unallocated receipt for Bills Aging)
        const echo = accounts[4];
        for (let i = 0; i < 5; i++) {
          const eDate = new Date(
            new Date('2025-01-15T10:00:00.000Z').getTime() + i * 24 * 3600_000,
          ).toISOString();
          const eNum = `ECHO-${201 + i}`;
          // eslint-disable-next-line no-await-in-loop
          const res = await driver.run(
            'INSERT INTO journal (date, narration, isPosted, billNumber) VALUES (?, ?, 1, ?)',
            [eDate, `Echo Bill #${eNum}`, eNum],
          );
          const jId = Number(res.lastInsertRowid);
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 1000, 0)',
            [jId, echo.id],
          );
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, 1000)',
            [jId, revAccount.id],
          );
        }
        const echoRec = await driver.run(
          "INSERT INTO journal (date, narration, isPosted) VALUES ('2025-02-14T10:00:00.000Z', 'Echo Excess Payment', 1)",
        );
        const echoRecId = Number(echoRec.lastInsertRowid);
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 8000, 0)',
          [echoRecId, receiptAccount.id],
        );
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, 8000)',
          [echoRecId, echo.id],
        );

        const gammaOpen = await driver.run(
          "INSERT INTO journal (date, narration, isPosted) VALUES ('2024-12-15T09:00:00.000Z', 'Opening Debit Balance', 1)",
        );
        const gammaOpenId = Number(gammaOpen.lastInsertRowid);
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 6000, 0)',
          [gammaOpenId, gamma.id],
        );
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, 6000)',
          [gammaOpenId, revAccount.id],
        );

        for (let i = 0; i < 5; i++) {
          const gDate = new Date(
            new Date('2025-01-20T10:00:00.000Z').getTime() + i * 48 * 3600_000,
          ).toISOString();
          const gNum = `GAMMA-${501 + i}`;
          // eslint-disable-next-line no-await-in-loop
          const res = await driver.run(
            'INSERT INTO journal (date, narration, isPosted, billNumber) VALUES (?, ?, 1, ?)',
            [gDate, `Gamma Bill #${gNum}`, gNum],
          );
          const jId = Number(res.lastInsertRowid);
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 2000, 0)',
            [jId, gamma.id],
          );
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, 2000)',
            [jId, revAccount.id],
          );
        }
        const gammaRec = await driver.run(
          "INSERT INTO journal (date, narration, isPosted) VALUES ('2025-03-18T15:00:00.000Z', 'Gamma Tour 2 Payment', 1)",
        );
        const gammaRecId = Number(gammaRec.lastInsertRowid);
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 8000, 0)',
          [gammaRecId, receiptAccount.id],
        );
        await driver.run(
          'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, 8000)',
          [gammaRecId, gamma.id],
        );

        for (let i = 0; i < accounts.length; i++) {
          if (i === 0 || i === 1 || i === 2 || i === 4) continue;
          const acc = accounts[i];
          const bNum = `OTHER-${300 + i}`;
          // eslint-disable-next-line no-await-in-loop
          const res = await driver.run(
            'INSERT INTO journal (date, narration, isPosted, billNumber) VALUES (?, ?, 1, ?)',
            ['2025-01-25T10:00:00.000Z', `Bill #${bNum}`, bNum],
          );
          const jId = Number(res.lastInsertRowid);
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 1000, 0)',
            [jId, acc.id],
          );
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO journal_entry (journalId, accountId, debitAmount, creditAmount) VALUES (?, ?, 0, 1000)',
            [jId, revAccount.id],
          );
        }

        return {
          agentHeadId: agentHead.id,
          agentHeadName,
          account1Id: alpha.id,
          account2Id: beta.id,
          account3Id: gamma.id,
          receiptAccountId: receiptAccount.id,
          tour1Id: tour1.id,
          tour2Id: tour2.id,
          billCount,
        };
      });
    },
    'debug:seedStockAsOfFixtures': async (rawArgs: unknown) => {
      if (!isLocalDebugHost()) throw new Error('debug rpc is local only');
      return driver.transaction(async () => {
        let itemType = await driver.get<{ id: number; name: string }>(
          "SELECT id, name FROM item_types WHERE name = 'Urdu' LIMIT 1",
        );
        if (!itemType) {
          const res = await driver.run(
            "INSERT INTO item_types (name, isActive) VALUES ('Urdu', 1)",
          );
          itemType = { id: Number(res.lastInsertRowid), name: 'Urdu' };
        }

        let account = await driver.get<{ id: number }>(
          'SELECT id FROM account LIMIT 1',
        );
        if (!account) {
          const chart = await driver.get<{ id: number }>(
            'SELECT id FROM chart LIMIT 1',
          );
          const res = await driver.run(
            "INSERT INTO account (chartId, name, code, isActive) VALUES (?, 'Replay Customer', 'REP-01', 1)",
            [chart?.id ?? 1],
          );
          account = { id: Number(res.lastInsertRowid) };
        }

        // Clean up any existing sample replay items
        await driver.run(
          "DELETE FROM inventory WHERE name IN ('Chronology Novel Vol 1', 'Chronology Novel Vol 2')",
        );

        // Item 1: Chronology Novel Vol 1 (Current live on-hand: 70)
        const item1Res = await driver.run(
          'INSERT INTO inventory (name, description, price, quantity, itemTypeId, listPosition) VALUES (?, ?, ?, ?, ?, ?)',
          [
            'Chronology Novel Vol 1',
            'Urdu Chronology Series Vol 1',
            500,
            70,
            itemType.id,
            1,
          ],
        );
        const item1Id = Number(item1Res.lastInsertRowid);
        await driver.run(
          'INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate) VALUES (?, 100, ?)',
          [item1Id, '2025-01-01T00:00:00.000Z'],
        );

        // Item 2: Chronology Novel Vol 2 (Current live on-hand: 220)
        const item2Res = await driver.run(
          'INSERT INTO inventory (name, description, price, quantity, itemTypeId, listPosition) VALUES (?, ?, ?, ?, ?, ?)',
          [
            'Chronology Novel Vol 2',
            'Urdu Chronology Series Vol 2',
            750,
            220,
            itemType.id,
            2,
          ],
        );
        const item2Id = Number(item2Res.lastInsertRowid);
        await driver.run(
          'INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate) VALUES (?, 200, ?)',
          [item2Id, '2025-01-01T00:00:00.000Z'],
        );

        const nextInvNumRow = await driver.get<{ maxNum: number }>(
          'SELECT COALESCE(MAX(invoiceNumber), 0) AS maxNum FROM invoices',
        );
        let nextInv = (nextInvNumRow?.maxNum ?? 0) + 1;

        // --- Item 1 Chronology Movements ---
        // Mov 1: Jan 15, 2025 Purchase (+50)
        const p1 = await driver.run(
          "INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount, isReturned) VALUES (?, ?, 'Purchase', '2025-01-15T10:00:00.000Z', 25000, 0)",
          [nextInv++, account.id],
        );
        await driver.run(
          'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId) VALUES (?, ?, 50, 500, 0, ?)',
          [Number(p1.lastInsertRowid), item1Id, account.id],
        );

        // Mov 2: Feb 01, 2025 Sale (-30)
        const s1 = await driver.run(
          "INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount, isReturned) VALUES (?, ?, 'Sale', '2025-02-01T10:00:00.000Z', 15000, 0)",
          [nextInv++, account.id],
        );
        await driver.run(
          'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId) VALUES (?, ?, 30, 500, 0, ?)',
          [Number(s1.lastInsertRowid), item1Id, account.id],
        );

        // Mov 3: Feb 15, 2025 Stock Adjustment (-10)
        await driver.run(
          "INSERT INTO stock_adjustments (inventoryId, quantityDelta, reason, date) VALUES (?, -10, 'Damaged in transit', '2025-02-15T12:00:00.000Z')",
          [item1Id],
        );

        // Mov 4: Mar 01, 2025 Sale (-20), returned on Mar 10, 2025 (+20)
        const s2 = await driver.run(
          "INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, returnedAt, totalAmount, isReturned) VALUES (?, ?, 'Sale', '2025-03-01T10:00:00.000Z', '2025-03-10T10:00:00.000Z', 10000, 1)",
          [nextInv++, account.id],
        );
        await driver.run(
          'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId) VALUES (?, ?, 20, 500, 0, ?)',
          [Number(s2.lastInsertRowid), item1Id, account.id],
        );

        // Mov 5: Apr 01, 2025 Sale (-40)
        const s3 = await driver.run(
          "INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount, isReturned) VALUES (?, ?, 'Sale', '2025-04-01T10:00:00.000Z', 20000, 0)",
          [nextInv++, account.id],
        );
        await driver.run(
          'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId) VALUES (?, ?, 40, 500, 0, ?)',
          [Number(s3.lastInsertRowid), item1Id, account.id],
        );

        // --- Item 2 Chronology Movements ---
        // Mov 1: Jan 20, 2025 Purchase (+100)
        const p2 = await driver.run(
          "INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount, isReturned) VALUES (?, ?, 'Purchase', '2025-01-20T10:00:00.000Z', 75000, 0)",
          [nextInv++, account.id],
        );
        await driver.run(
          'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId) VALUES (?, ?, 100, 750, 0, ?)',
          [Number(p2.lastInsertRowid), item2Id, account.id],
        );

        // Mov 2: Mar 20, 2025 Sale (-80)
        const s4 = await driver.run(
          "INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount, isReturned) VALUES (?, ?, 'Sale', '2025-03-20T10:00:00.000Z', 60000, 0)",
          [nextInv++, account.id],
        );
        await driver.run(
          'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId) VALUES (?, ?, 80, 750, 0, ?)',
          [Number(s4.lastInsertRowid), item2Id, account.id],
        );

        return {
          item1Id,
          item1Name: 'Chronology Novel Vol 1',
          item2Id,
          item2Name: 'Chronology Novel Vol 2',
          itemTypeName: 'Urdu',
        };
      });
    },
    'debug:seedCatalogFixtures': async (rawArgs: unknown) => {
      if (!isLocalDebugHost()) throw new Error('debug rpc is local only');
      const params = (rawArgs ?? {}) as { count?: number };
      const totalCount = params.count ?? 1050;

      return driver.transaction(async () => {
        // 1. Ensure attribute definitions
        const defs = [
          {
            key: 'binding',
            label: 'Binding',
            unit: null,
            valueType: 'text',
            sortOrder: 1,
          },
          {
            key: 'pages',
            label: 'Pages',
            unit: 'pp',
            valueType: 'number',
            sortOrder: 2,
          },
          {
            key: 'language',
            label: 'Language',
            unit: null,
            valueType: 'text',
            sortOrder: 3,
          },
        ];
        for (const def of defs) {
          // eslint-disable-next-line no-await-in-loop
          const existing = await driver.get<{ id: number }>(
            'SELECT id FROM attribute_definitions WHERE key = ?',
            [def.key],
          );
          if (!existing) {
            // eslint-disable-next-line no-await-in-loop
            await driver.run(
              'INSERT INTO attribute_definitions (key, label, unit, valueType, sortOrder, isActive, isPublic) VALUES (?, ?, ?, ?, ?, 1, 1)',
              [def.key, def.label, def.unit, def.valueType, def.sortOrder],
            );
          }
        }

        // 2. Ensure item types
        const typeNames = ['Fiction', 'Non-Fiction', 'Reference', 'Poetry'];
        const typeIds: number[] = [];
        for (const name of typeNames) {
          // eslint-disable-next-line no-await-in-loop
          let row = await driver.get<{ id: number }>(
            'SELECT id FROM item_types WHERE name = ?',
            [name],
          );
          if (!row) {
            // eslint-disable-next-line no-await-in-loop
            const r = await driver.run(
              'INSERT INTO item_types (name, isActive) VALUES (?, 1)',
              [name],
            );
            row = { id: Number(r.lastInsertRowid) };
          }
          typeIds.push(row.id);
        }

        // 3. Clear existing catalog items starting with CAT-
        await driver.run("DELETE FROM inventory WHERE name LIKE 'CAT-%'");

        // 4. Batch insert totalCount items in chunks
        // Family logic: every 5 items form a family.
        // Item (i % 5 === 0) is head (parentId = NULL).
        // Items 1..4 have parentId set to the head item's ID.
        let currentHeadId: number | null = null;
        for (let i = 0; i < totalCount; i++) {
          const numStr = String(i + 1).padStart(4, '0');
          const name = `CAT-${numStr}`;
          const isHead = i % 5 === 0;
          const parentId = isHead ? null : currentHeadId;
          const itemTypeId = typeIds[i % typeIds.length];
          const price = 100 + (i % 25) * 50;
          const quantity = 50 + (i % 30) * 10;
          const binding = i % 2 === 0 ? 'Hardcover' : 'Paperback';
          const pages = 100 + (i % 20) * 50;
          const language =
            i % 3 === 0 ? 'Urdu' : i % 3 === 1 ? 'English' : 'Arabic';
          const attributes = JSON.stringify({ binding, pages, language });

          // eslint-disable-next-line no-await-in-loop
          const res = await driver.run(
            'INSERT INTO inventory (name, description, price, quantity, itemTypeId, listPosition, parentId, attributes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
              name,
              `Catalog Book ${name}`,
              price,
              quantity,
              itemTypeId,
              i + 1,
              parentId,
              attributes,
            ],
          );
          const itemId = Number(res.lastInsertRowid);
          if (isHead) currentHeadId = itemId;

          // Add opening stock so inventory_quantity_view matches
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate) VALUES (?, ?, ?)',
            [itemId, quantity, '2025-01-01T00:00:00.000Z'],
          );
        }

        return {
          totalCount,
          headCount: Math.ceil(totalCount / 5),
          attributeKeys: ['binding', 'pages', 'language'],
        };
      });
    },
    'debug:seed150InvoiceFixtures': async () => {
      return driver.transaction(async () => {
        const getOrInsertAccount = async (name: string, headName: string) => {
          let row = (await driver.get<{ id: number }>(
            'SELECT id FROM account WHERE name = ?',
            [name],
          )) as { id: number } | undefined;
          if (!row) {
            await accountService.insertAccount({
              name,
              headName,
            } as Parameters<AccountService['insertAccount']>[0]);
            row = (await driver.get<{ id: number }>(
              'SELECT id FROM account WHERE name = ?',
              [name],
            )) as { id: number };
          }
          return row.id;
        };

        await getOrInsertAccount('Sale', 'Revenue');
        await getOrInsertAccount('Purchase', 'Expense');
        await getOrInsertAccount('Cash', 'Current Asset');
        const customerId = await getOrInsertAccount(
          'Soak Customer 150',
          'Current Asset',
        );

        await driver.run("DELETE FROM inventory WHERE name LIKE 'Item %'");

        const invoiceItems: Array<{
          id: number;
          inventoryId: number;
          quantity: number;
          price: number;
          discount: number;
          discountedPrice: number;
        }> = [];
        let totalAmount = 0;

        for (let i = 1; i <= 150; i++) {
          const name = `Item ${String(i).padStart(3, '0')}`;
          const price = 50 + (i % 20) * 10;
          const qty = ((i * 7 + 13) % 20) + 1;
          // eslint-disable-next-line no-await-in-loop
          const res = await driver.run(
            'INSERT INTO inventory (name, description, price, quantity) VALUES (?, ?, ?, 1000)',
            [name, `Description for ${name}`, price],
          );
          const itemId = Number(res.lastInsertRowid);
          // eslint-disable-next-line no-await-in-loop
          await driver.run(
            'INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate) VALUES (?, 1000, ?)',
            [itemId, '2025-01-01T00:00:00.000Z'],
          );
          const lineTotal = qty * price;
          totalAmount += lineTotal;
          invoiceItems.push({
            id: i,
            inventoryId: itemId,
            quantity: qty,
            price,
            discount: 0,
            discountedPrice: lineTotal,
          });
        }

        const invoiceRes = await invoiceService.insertInvoice(
          'Sale' as Parameters<InvoiceService['insertInvoice']>[0],
          {
            invoiceNumber: 9001,
            date: '2026-10-16T12:00:00.000Z',
            totalAmount,
            useSingleAccount: true,
            accountMapping: {
              singleAccountId: customerId,
            },
            invoiceItems,
          } as unknown as Parameters<InvoiceService['insertInvoice']>[1],
        );

        return {
          invoiceId: (invoiceRes as { invoiceId: number }).invoiceId,
          totalAmount,
          itemCount: 150,
          customerId,
        };
      });
    },
  };

  self.onmessage = (event: MessageEvent<RpcCall>) => {
    void turn(async () => {
      const { id, method, args } = event.data;
      const handler = handlers[method];
      if (!handler) {
        self.postMessage({
          id,
          ok: false,
          type: 'result',
          error: `Unknown method: ${method}`,
        });
        return;
      }
      try {
        const result = await handler(...args);
        self.postMessage(
          { id, ok: true, type: 'result', result },
          result instanceof ArrayBuffer ? [result] : undefined,
        );
      } catch (error: unknown) {
        self.postMessage({
          id,
          ok: false,
          type: 'result',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  if (hasRealSession) syncManager.resumeBackgroundLoop();

  self.postMessage({ type: 'ready' });

  // after ready: a large invoice UPDATE must never delay first paint.
  // same turn queue as RPCs so the repair cannot join an open transaction.
  void turn(() =>
    repairInvoiceEditedTimestamps(driver)
      .then((changed) => {
        if (changed > 0) {
          self.postMessage({ type: 'sync-applied' });
        }
      })
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          'repairInvoiceEditedTimestamps failed',
          error instanceof Error ? error.message : error,
        );
      }),
  );
}

main().catch((error: unknown) => {
  self.postMessage({
    type: 'init-error',
    error: error instanceof Error ? error.message : String(error),
  });
});
