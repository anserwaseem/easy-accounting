/* eslint-disable max-classes-per-file --
 * TransportError is small and only ever meaningful alongside the transport
 * that throws it, so it's colocated here rather than split into its own
 * file for one three-field error class.
 */
import type {
  LogRow,
  OutboxEntry,
  PushResult,
  SyncTransport,
} from './transport';
import { fetchWithRetry } from './fetchWithRetry';

/**
 * Thrown for any non-2xx response (or a response whose body doesn't match
 * the shape this transport expects) from either Supabase REST endpoint.
 * Carries the raw HTTP `status` and response `body` text so a caller (or a
 * test) can distinguish, say, a 401 (bad/missing anon key) from a 404 (the
 * project doesn't have `supabase/setup.sql` applied yet — see that file) from
 * a 5xx.
 */
export class TransportError extends Error {
  readonly status: number;

  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(`${message} (status ${status}): ${body}`);
    this.name = 'TransportError';
    this.status = status;
    this.body = body;
    // The root tsconfig targets ES5, where subclassing Error loses the
    // prototype chain (the Error constructor returns its own object), so
    // `instanceof TransportError` silently fails without this restore.
    Object.setPrototypeOf(this, TransportError.prototype);
  }
}

/** One row of `sync_log` (supabase/setup.sql) as PostgREST returns it — snake_case, unlike {@link LogRow}. */
interface SyncLogRestRow {
  seq: number;
  table_name: string;
  row_uuid: string;
  op: 'put' | 'delete';
  row_json: unknown;
  device_id: string;
}

/** The `jsonb` result shape `sync_push` (supabase/setup.sql) returns, before being mapped onto {@link PushResult}. */
interface SyncPushRpcResult {
  accepted: string[];
  rejected: { idempotencyKey: string; reason: string }[];
  newSeq: number;
}

/**
 * {@link SyncTransport} implemented over plain `fetch` against a Supabase
 * project's PostgREST endpoints — the real (non-mock) counterpart of
 * {@link ../__tests__/mockServer.ts}'s `MockSyncServer`, talking to the
 * server half of the protocol defined in `supabase/setup.sql` (repo root):
 * `push` calls the `sync_push` RPC (`POST /rest/v1/rpc/sync_push`), `pull`
 * is a plain filtered `select` on `sync_log`
 * (`GET /rest/v1/sync_log?seq=gt.<cursor>&order=seq.asc&limit=<n>`).
 *
 * ## Why plain `fetch`, not `@supabase/supabase-js`
 *
 * Deliberately, not an oversight. `src/core` is platform-free by the rule
 * documented at the top of `src/core/index.ts` and enforced by
 * `.eslintrc.js`'s `no-restricted-imports` override for `src/core/**`: no
 * Electron, no Node builtins, nothing that assumes a specific host. Pulling
 * in `@supabase/supabase-js` would tie core to that SDK's own runtime
 * assumptions and dependency footprint for what is, at the wire level, two
 * plain HTTP calls. `fetch` is a Web/WHATWG standard global that both
 * targets this transport needs to run identically in — Node 18+ (the
 * Electron main process, and this repo's own test runner, see
 * `jest.node.config.js`) and browser Web Workers (the future mobile/web
 * host this was written for) — already provide natively. No adapter, no
 * polyfill, no extra dependency in `src/core`'s footprint.
 *
 * ## Auth headers
 *
 * Every request sends both `apikey` (the project's anon key) and
 * `Authorization: Bearer <token>` — PostgREST requires both: `apikey`
 * identifies the API project/key pair, `Authorization` carries the JWT PostgREST
 * evaluates RLS policies against (`request.jwt.claims`, `auth.role()`,
 * etc.). Until this device has a signed-in session (no auth wizard exists
 * yet — see `supabase/setup.sql`'s header comment on why its policies still
 * grant `anon`), `accessToken` is omitted and both headers carry the anon
 * key, which is exactly what an unauthenticated PostgREST request expects.
 * Once the auth wizard lands, callers pass a real user JWT as
 * `accessToken` and only `Authorization` changes — `apikey` always stays
 * the project's anon key, per Supabase's own convention.
 *
 * ## Error mapping
 *
 * Any non-2xx response, or a 2xx response whose body isn't shaped the way
 * this transport expects (missing/malformed fields), throws
 * {@link TransportError} with the HTTP `status` and raw response `body`
 * text attached — never a bare `Error` or a silently-wrong `PushResult`.
 * `SyncEngine` does not catch transport errors itself (see `drainOutbox`'s
 * doc comment: "If `transport.push` itself throws ... the batch's rows are
 * left exactly as they were — safe to retry"), so surfacing failures as
 * thrown errors rather than swallowing them is load-bearing for that retry
 * story, not just nice-to-have diagnostics.
 */
export class SupabaseSyncTransport implements SyncTransport {
  private readonly url: string;

  private readonly anonKey: string;

  private readonly accessToken?: string;

  private readonly fetchImpl: typeof fetch;

  private readonly deviceId: string;

  constructor(config: {
    url: string;
    anonKey: string;
    /**
     * This device's stable identifier, stamped onto every pushed mutation —
     * sync_log.device_id is how peers' pulls suppress a device's own echoes.
     * The mock transport receives it via createDeviceTransport(deviceId);
     * here it's constructor config because each device constructs its own
     * transport instance.
     */
    deviceId: string;
    accessToken?: string;
    /**
     * Injectable fetch, defaulting to the global. Exists because Node's
     * built-in fetch ignores HTTPS_PROXY env vars — an environment that
     * fronts outbound HTTPS with a proxy (CI sandboxes) must pass a
     * proxy-aware fetch (e.g. undici's with a ProxyAgent dispatcher).
     * Browsers and direct-egress Node never need it.
     */
    fetchImpl?: typeof fetch;
  }) {
    // Strip a trailing slash so `${this.url}/rest/v1/...` never doubles up.
    this.url = config.url.replace(/\/+$/, '');
    this.anonKey = config.anonKey;
    this.accessToken = config.accessToken;
    // The arrow wrapper is load-bearing: storing the global `fetch` and
    // calling it as `this.fetchImpl(...)` rebinds `this` to the transport
    // instance, which browsers reject with "Illegal invocation" ("Failed to
    // execute 'fetch' on 'WorkerGlobalScope'") — fetch must be invoked on
    // the global. Node's fetch tolerates any `this`, so only real browsers
    // (the web worker) ever hit this.
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
    this.deviceId = config.deviceId;
  }

  private fetch(url: string, init: RequestInit): Promise<Response> {
    return fetchWithRetry(this.fetchImpl, url, init);
  }

  private authHeaders(): Record<string, string> {
    return {
      apikey: this.anonKey,
      Authorization: `Bearer ${this.accessToken ?? this.anonKey}`,
    };
  }

  async push(batch: OutboxEntry[]): Promise<PushResult> {
    const response = await this.fetch(`${this.url}/rest/v1/rpc/sync_push`, {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      // Each mutation carries this device's id — sync_push persists it as
      // sync_log.device_id (not-null), the echo-suppression key for pulls.
      body: JSON.stringify({
        mutations: batch.map((entry) => ({
          ...entry,
          deviceId: this.deviceId,
        })),
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new TransportError(
        'SupabaseSyncTransport.push: sync_push RPC failed',
        response.status,
        text,
      );
    }

    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      throw new TransportError(
        'SupabaseSyncTransport.push: sync_push returned non-JSON body',
        response.status,
        text,
      );
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as SyncPushRpcResult).accepted) ||
      !Array.isArray((parsed as SyncPushRpcResult).rejected) ||
      typeof (parsed as SyncPushRpcResult).newSeq !== 'number'
    ) {
      throw new TransportError(
        'SupabaseSyncTransport.push: sync_push returned an unexpected shape',
        response.status,
        text,
      );
    }

    const result = parsed as SyncPushRpcResult;
    return {
      // PushResult.accepted is a count (see transport.ts); sync_push
      // returns the accepted idempotency keys themselves so the caller can
      // tell *which* entries landed — SyncEngine only needs the count today
      // (it identifies rejections by key via `result.rejected`, and treats
      // every batch entry not in `rejected` as accepted), so the mapping
      // here is deliberately lossy in the same direction MockSyncServer's
      // `{ accepted: batch.length, ... }` already is.
      accepted: result.accepted.length,
      rejected: result.rejected,
      newSeq: result.newSeq,
    };
  }

  /**
   * `device_id=neq.<this device's id>` is applied server-side (PostgREST
   * `neq` filter) alongside the `seq` filter — both are ANDed together by
   * PostgREST since they're distinct query params on the same request. This
   * is the fix for a real observed-in-production egress problem: after a
   * device bootstraps a large business (~140k rows), every later background
   * pull re-downloaded that SAME device's own previously-pushed rows page
   * by page (the log's `seq > cursor` filter has no way to know they're
   * this device's own) only for {@link SyncEngine}'s echo-suppression
   * (`sync_state.applying`, see that class's doc comment) to discard them
   * *after* they'd already been paid for in Supabase egress — the free
   * tier's scarce resource. Excluding them server-side means they are never
   * transferred at all, not merely discarded on arrival.
   *
   * This does **not** change what ends up applied locally — a device's own
   * rows were always going to be echo-suppressed no-ops — only how many
   * bytes crossed the wire to arrive at that same no-op. It does, however,
   * change what "the page was shorter than `limit`" can mean: see
   * {@link SyncEngine.pullAndApply}'s "Cursor advancement past filtered
   * own-device rows" section for why that method takes a `currentSeq()`
   * snapshot *before* paging and never advances the cursor past it.
   *
   * ## `opts.includeSelf`
   *
   * When true, the `device_id=neq.<self>` filter above is omitted entirely
   * from the PostgREST query — this device's own rows come back like any
   * other device's. This is NOT the egress optimization being turned off
   * for no reason: it's `SyncEngine.rebuildFromServer`'s one legitimate use
   * case, where this device has just deleted its own local copies of every
   * replicated row and, unlike ordinary steady-state sync, genuinely needs
   * them back. See {@link SyncTransport.pull}'s doc comment and
   * `SyncEngine.rebuildFromServer`'s for the full incident. Every other
   * caller leaves `opts` unset and gets the exact same filtered query this
   * method has always sent.
   */
  async pull(
    afterSeq: number,
    limit: number,
    opts?: { includeSelf?: boolean },
  ): Promise<LogRow[]> {
    const params = new URLSearchParams({
      select: 'seq,table_name,row_uuid,op,row_json,device_id',
      seq: `gt.${afterSeq}`,
      order: 'seq.asc',
      limit: String(limit),
    });
    if (!opts?.includeSelf) {
      params.set('device_id', `neq.${this.deviceId}`);
    }
    const response = await this.fetch(
      `${this.url}/rest/v1/sync_log?${params.toString()}`,
      {
        method: 'GET',
        headers: this.authHeaders(),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new TransportError(
        'SupabaseSyncTransport.pull: sync_log select failed',
        response.status,
        text,
      );
    }

    let rows: SyncLogRestRow[];
    try {
      rows = text.length > 0 ? (JSON.parse(text) as SyncLogRestRow[]) : [];
    } catch {
      throw new TransportError(
        'SupabaseSyncTransport.pull: sync_log select returned non-JSON body',
        response.status,
        text,
      );
    }
    if (!Array.isArray(rows)) {
      throw new TransportError(
        'SupabaseSyncTransport.pull: sync_log select returned a non-array body',
        response.status,
        text,
      );
    }

    return rows.map((row) => ({
      seq: row.seq,
      tableName: row.table_name,
      rowUuid: row.row_uuid,
      op: row.op,
      // `row_json` comes back from PostgREST as parsed JSON (the column is
      // `jsonb`), but LogRow.rowJson is a *string* — the same JSON-encoded
      // string shape SyncEngine.applyRow's `JSON.parse(row.rowJson)`
      // already expects and the client's own sync_outbox stores it as (see
      // migration 029) — so re-stringify here rather than changing that
      // contract for this one transport.
      rowJson: JSON.stringify(row.row_json),
      deviceId: row.device_id,
    }));
  }

  /**
   * `SELECT seq ... ORDER BY seq DESC LIMIT 1` against `sync_log` — see
   * {@link SyncTransport.currentSeq}'s doc comment for why this exists and
   * how `SyncEngine` uses it. Returns 0 for an empty log, same as an
   * unseeded `sync_state.cursor`.
   */
  async currentSeq(): Promise<number> {
    const params = new URLSearchParams({
      select: 'seq',
      order: 'seq.desc',
      limit: '1',
    });
    const response = await this.fetch(
      `${this.url}/rest/v1/sync_log?${params.toString()}`,
      {
        method: 'GET',
        headers: this.authHeaders(),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new TransportError(
        'SupabaseSyncTransport.currentSeq: sync_log select failed',
        response.status,
        text,
      );
    }

    let rows: { seq: number }[];
    try {
      rows = text.length > 0 ? (JSON.parse(text) as { seq: number }[]) : [];
    } catch {
      throw new TransportError(
        'SupabaseSyncTransport.currentSeq: sync_log select returned non-JSON body',
        response.status,
        text,
      );
    }
    if (!Array.isArray(rows)) {
      throw new TransportError(
        'SupabaseSyncTransport.currentSeq: sync_log select returned a non-array body',
        response.status,
        text,
      );
    }

    return rows.length > 0 ? rows[0].seq : 0;
  }
}
