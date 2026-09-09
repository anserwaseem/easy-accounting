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
import { LedgerService } from '@core/services/LedgerService';
import { PricingService } from '@core/services/PricingService';
import { InventoryService } from '@core/services/InventoryService';
import { JournalService } from '@core/services/JournalService';
import { StatementService } from '@core/services/StatementService';
import { InvoiceService } from '@core/services/InvoiceService';
import { SettingsService } from '@core/services/SettingsService';
import { VendorStockService } from '@core/services/VendorStockService';
import { repairInvoiceEditedTimestamps } from '@core/sync/repairInvoiceTimestamps';
import { INITIAL_CHARTS } from '@core/utils/constants';
import { enrichLedgerRowsWithJournalSummaries } from '@core/utils/ledgerJournalEnrichment';
import type { UserCredentials } from 'types';
import { openDeserializedDatabase } from './deserializeDatabase';
import { PLACEHOLDER_USERNAME } from './placeholderUser';
import {
  getWebPublishConfig,
  getWebPublishSecrets,
  saveWebPublishConfig,
  migratePublishConnectionToSettings,
} from './publishConfig';
import { WebPublishService } from './publishService';
import { SqliteWasmDriver } from './SqliteWasmDriver';
import { SyncManager } from './syncManager';
import {
  coerceStoredPasswordHash,
  hashPassword,
  isDesktopFormatHash,
  isUsablePasswordHash,
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
 * Suppresses migration 029's capture triggers for the duration of `fn` by
 * setting, then clearing, `sync_state.applying` directly via SQL — the same
 * flag {@link import('@core/sync/SyncEngine').SyncEngine}'s own private
 * `setApplying` uses, and the exact flag migration 029's `APPLYING_GUARD`
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
 * practice, but a caller that DID somehow run before migration 029 applied
 * falls back to running `fn` unsuppressed rather than crashing worker boot
 * outright over a table that isn't there yet.
 *
 * ## Suppressed INSERTs must assign `uuid` themselves
 *
 * REAL INCIDENT (caught by the import e2e spec): migration 029's
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
 * replicated tables (migration 029), so this INSERT (and INITIAL_CHARTS's)
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
    // same uuid for every chart row — see migration 031's idempotencyKey
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

async function main(): Promise<void> {
  const sqlite3 = await sqlite3InitModule();

  const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
    name: 'easy-accounting',
  });
  const sqliteDb = new poolUtil.OpfsSAHPoolDb('/easy-accounting.sqlite3');

  const driver = new SqliteWasmDriver(sqlite3, sqliteDb);
  await bootstrapDatabase(driver);

  const webKv = new WebKv(driver);
  await webKv.load();

  let currentUsername = webKv.get('username') as string | undefined;
  const hasRealSession =
    typeof currentUsername === 'string' &&
    currentUsername.length > 0 &&
    currentUsername !== PLACEHOLDER_USERNAME;

  // BYOK sync: device-scoped connect wizard + background sync loop (see
  // syncManager.ts's doc comment). Config lives in web_kv, independent of
  // which business user is signed in. `bootIfConfigured` is local-only
  // (constructs the transport; `startLoop` fires `ensureCycle` without
  // awaiting it) so awaiting it does not delay `ready` on a network trip.
  // Logged-out boots pass `startLoop: false` so Safari Login is not
  // competing with a 288k-row pull; `resumeBackgroundLoop` after
  // auth:login starts it.
  const syncManager = new SyncManager({
    db: driver,
    kv: webKv,
    notify: (message) => self.postMessage(message),
  });
  await syncManager.bootIfConfigured({ startLoop: hasRealSession });

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

      // Re-join can apply a users row whose password_hash was NULL in the
      // log (origin capture racing the hash insert). Dashboard still worked
      // via the leftover session; after logout nothing verifies. If this
      // device already has business data, the typed password becomes the
      // local hash and sign-in succeeds.
      if (!isValid && !isUsablePasswordHash(storedHash)) {
        const accounts = await driver.get<{ c: number }>(
          `SELECT COUNT(*) AS c FROM account`,
        );
        const journals = await driver.get<{ c: number }>(
          `SELECT COUNT(*) AS c FROM journal`,
        );
        if ((accounts?.c ?? 0) > 0 || (journals?.c ?? 0) > 0) {
          const passwordHash = await hashPassword(trimmed || typedPassword);
          await driver.run(
            `UPDATE users SET password_hash = @password_hash WHERE username = @username`,
            { password_hash: passwordHash, username: dbUser.username },
          );
          isValid = true;
        }
      }

      if (isValid) {
        currentUsername = dbUser.username;
        await webKv.setAwaited('username', dbUser.username);
        syncManager.resumeBackgroundLoop();
      }
      return isValid;
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
    logout: async () => {
      currentUsername = undefined;
      await webKv.deleteAwaited('username');
    },

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
        currentUsername = undefined;
        await webKv.deleteAwaited('username');
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
    getSaleInvoiceEditDateBounds: (invoiceId, accountId, invoiceNumber) =>
      invoiceService.getSaleInvoiceEditDateBounds(
        invoiceId as number,
        accountId as number,
        invoiceNumber as number,
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
    bulkUpdateInventoryUrduFields: (patches) =>
      inventoryService.bulkUpdateUrduFields(
        patches as Parameters<InventoryService['bulkUpdateUrduFields']>[0],
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

    // -- Settings (src/core/services/SettingsService.ts, migration 028) ----
    getSetting: (key) => settingsService.get(key as string),
    setSetting: (key, value) => settingsService.set(key as string, value),
    deleteSetting: (key) => settingsService.delete(key as string),
    getAllSettings: () => settingsService.getAll(),

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
        currentUsername = undefined;
        await webKv.deleteAwaited('username');
      }
      return result;
    },
    // Settings "Add a device" QR/copy-link — Project URL + anon key of the
    // currently-connected project (null when disconnected or mock). See
    // SyncManager.getJoinInvite.
    'sync:getJoinInvite': () => Promise.resolve(syncManager.getJoinInvite()),
  };

  /**
   * Read-only-by-name prefixes: a handler whose method name starts with one
   * of these never writes to the database, so it never needs to schedule a
   * sync. Everything else is treated as a write — see this function's call
   * site below for the one exception that needs its own args-aware check
   * (`import:database`'s preview call, `confirm: false`, writes nothing).
   * Deliberately a conservative (over-inclusive on the "is a write" side)
   * heuristic rather than an exhaustive hand-maintained list: scheduling an
   * unnecessary debounced sync after a read that slipped through is
   * harmless (the next syncOnce just finds an empty outbox), while missing
   * a real write would silently delay that change reaching the server.
   */
  const READ_ONLY_METHOD_PREFIXES = [
    'get',
    'does',
    'has',
    'report',
    'export',
    'preview',
  ];

  function isLikelyWrite(method: string, args: unknown[]): boolean {
    if (method.startsWith('sync:')) return false;
    if (method === 'runPublish') return false; // lastResult is web_kv, not synced
    if (READ_ONLY_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix)))
      return false;
    if (method === 'import:database') return args[1] === true; // only the confirmed call writes
    return true;
  }

  self.onmessage = (event: MessageEvent<RpcCall>) => {
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
    handler(...args).then(
      (result) => {
        // Any local write schedules a debounced background sync (see
        // syncManager.ts's `scheduleDebouncedSync` — a no-op while
        // disconnected) — this is the one place every mutating RPC call
        // passes through, regardless of which service handled it.
        if (isLikelyWrite(method, args)) {
          syncManager.scheduleDebouncedSync();
        }
        // `export:database`'s ArrayBuffer result is transferred (zero-copy)
        // rather than structured-cloned — the only handler that currently
        // returns one; anything else takes the normal (cloned) path.
        self.postMessage(
          { id, ok: true, type: 'result', result },
          result instanceof ArrayBuffer ? [result] : undefined,
        );
      },
      (error: unknown) =>
        self.postMessage({
          id,
          ok: false,
          type: 'result',
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  };

  self.postMessage({ type: 'ready' });

  // After ready: a large invoice UPDATE must never delay first paint.
  // Notify the renderer if any row changed so the invoice list refreshes.
  void repairInvoiceEditedTimestamps(driver)
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
    });
}

main().catch((error: unknown) => {
  self.postMessage({
    type: 'init-error',
    error: error instanceof Error ? error.message : String(error),
  });
});
