import type { DatabaseDriver } from '../driver';
import { BUSINESS_TABLES } from '../import';

/**
 * Migration 029 — the client half of multi-device sync (see
 * docs, and src/core/sync/*). Has a desktop-side twin,
 * src/main/migrations/029.js — same reason migration 028 has one (see
 * src/core/db/migrations/index.ts's doc comment on that migration): the
 * existing Electron install path runs schema changes exclusively through
 * the old synchronous MigrationRunner, which never calls bootstrapDatabase,
 * so a schema change meant to reach it has to be expressed twice. Creates
 * the local sync bookkeeping tables
 * (`sync_outbox`, `sync_state`, `sync_rejected`) and, for every replicated
 * "fact" table, AFTER INSERT/UPDATE/DELETE triggers that capture a full row
 * image into `sync_outbox` whenever a local write happens.
 *
 * ## Which tables replicate
 *
 * {@link SYNC_TABLES} = `BUSINESS_TABLES` (src/core/db/import.ts — the same
 * list the "bring your database" import feature already treats as "the
 * business data") **minus `ledger`**. `ledger` is excluded deliberately:
 * per docs/derived-state-design.md, `ledger` is a stored running-balance
 * table with no self-healing story for out-of-order writes — migrations
 * 025-027 already demoted it to a derived view (`ledger_view`, computed
 * live from `journal`/`journal_entry`, both of which DO replicate) for
 * exactly this reason. Replicating `ledger` itself would resurrect the
 * "two devices decrement/increment the same running counter concurrently"
 * bug class sync exists to avoid. Every device recomputes its own
 * `ledger_view` locally from the synced facts — nothing to replicate.
 *
 * `users` DOES replicate (it was already in `BUSINESS_TABLES`) — this is a
 * deliberate decision, not an oversight: `users` is how *employees* (login
 * accounts operating the books) exist on every device, and `chart.userId`
 * is a real foreign key into it. Migration 024 skipped adding a `uuid`
 * column to `users` ("neither is business data that sync will ever merge
 * across devices" — true of `migrations`, not of `users` once multi-device
 * sync is the point), so this migration backfills one here, the same way
 * migration 024 did for every other business table.
 *
 * ## Row image capture, and the two ordering bugs this migration works
 * around
 *
 * Every replicated table already carries two other AFTER-INSERT/AFTER-UPDATE
 * triggers from the frozen schema snapshot (see schema.snapshot.sql):
 *   - `trg_<table>_uuid` (migration 024) — assigns a uuid post-hoc when a
 *     plain `INSERT` omits one.
 *   - `after_insert_<table>_add_timestamp` / `after_update_..._add_timestamp`
 *     — unconditionally stamp `createdAt`/`updatedAt` to the local device's
 *     current time, no matter what the INSERT/UPDATE supplied.
 *
 * SQLite fires multiple triggers registered for the *same* event on the
 * same table in an order that is explicitly **undefined** by the SQLite
 * documentation, and empirically (verified against the better-sqlite3
 * build this app ships, see the trigger-ordering experiments run while
 * building this migration) is **reverse-of-creation-order**, not creation
 * order. Two concrete consequences, both load-bearing for correctness:
 *
 * 1. **The `NEW`/`OLD` pseudo-row is frozen** to the values the triggering
 *    statement itself supplied — it does NOT reflect changes any sibling
 *    trigger makes to the same row, regardless of firing order. So a
 *    capture trigger that reads `NEW.uuid` directly can observe `NULL`
 *    even though, by the time all AFTER INSERT triggers for that statement
 *    have finished, the row's actual `uuid` column is populated — *and*
 *    doing a correlated self-`SELECT` from the table instead of reading
 *    `NEW.*` does not fix this, because if the capture trigger happens to
 *    fire *before* `trg_<table>_uuid`, the self-select observes the same
 *    not-yet-assigned `NULL` the naive read would have.
 * 2. Because ordering is undefined, a capture trigger cannot assume
 *    `trg_<table>_uuid` has already run. **This migration therefore drops
 *    every `trg_<table>_uuid` trigger for a replicated table and folds its
 *    exact uuid-assignment logic into the front of the new capture
 *    trigger's own body** (same version-4 uuid SQL expression migration 024
 *    uses), so uuid assignment and the row-image capture that depends on it
 *    happen as two sequential statements *inside one trigger body* — where
 *    SQLite statement order is, unlike cross-trigger order, fully
 *    deterministic. This is not optional cleanup; without it, roughly 1 in
 *    2 inserts (whichever way the undefined order happened to resolve)
 *    would capture a `sync_outbox` row with `rowUuid = NULL`, which is
 *    fatal to identity-based replication. (`ledger`'s `trg_ledger_uuid` is
 *    left untouched — `ledger` is not replicated, so it never gets a
 *    capture trigger and never hits this hazard.)
 *
 * The `createdAt`/`updatedAt` stomping (point 1's other instance) is
 * consciously NOT worked around the same way: because
 * `after_insert/update_<table>_add_timestamp` unconditionally overwrites
 * those two columns to the *acting* device's local clock — on every write,
 * not just ones missing a value — the timestamp a device receives via sync
 * and applies (`SyncEngine`'s upsert) is itself immediately re-stamped to
 * the *receiving* device's local time by that same pre-existing trigger.
 * In other words, `createdAt`/`updatedAt` fidelity across devices is
 * already broken by that trigger for reasons that predate and are
 * independent of sync — capturing a "more correct" value here would not
 * survive being applied on the other end anyway. Flagged here explicitly
 * as a known gap for whoever builds the Phase-3 server / a future
 * timestamp-fidelity pass, not fixed in this migration.
 *
 * **Update — fixed by migration 034.** That future pass turned out to be
 * needed sooner than "Phase-3 server": a real field report (a device that
 * had just joined a sync project saw the "Edited" pill lit on every single
 * invoice) traced directly to the gap described just above. Migration 034
 * (src/core/db/migrations/034_suppress_timestamp_triggers_during_apply.ts)
 * prepends this same `APPLYING_GUARD` to both `after_insert_<table>_
 * add_timestamp` and `after_update_<table>_add_timestamp`, so a sync apply
 * no longer re-stamps either column — `SyncEngine.applyRow` writes the row
 * image's own `createdAt`/`updatedAt` verbatim instead, on every table this
 * migration replicates. Left here, unedited, as the historical record of
 * why the gap existed in the first place; the capture-side race described
 * two paragraphs up (an insert-capture trigger observing `NULL` because
 * `after_insert_<table>_add_timestamp` hasn't stamped a value yet) is a
 * *separate*, still-open concern on the CAPTURING device's side that 034
 * does not touch — see `SyncEngine.applyRow`'s doc comment for how the
 * apply path still defends against that one.
 *
 * ## Echo suppression
 *
 * Every capture trigger is additionally guarded with
 * `WHEN (SELECT value FROM sync_state WHERE key = 'applying') IS NULL`.
 * `SyncEngine`'s apply path sets that flag for the duration of the
 * transaction that writes incoming remote rows, so replaying a peer's
 * change never re-enters this device's own outbox.
 *
 * ## Foreign keys travel as uuids, not local ids
 *
 * A row's own integer `id` is local-autoincrement and meaningless on any
 * other device, but every FK *column* in this schema still stores a local
 * id (that's what makes the app's normal queries work). So every captured
 * row image carries, for each FK column, **both** the raw local id (kept
 * for schema-shape symmetry / debugging, ignored by the apply path) and a
 * `<column>_uuid` sibling holding the referenced row's `uuid`, resolved via
 * `PRAGMA foreign_key_list` at migration time — the apply path resolves
 * `<column>_uuid` back to *this* device's local id for that row before
 * writing. This assumes the referenced row already exists locally, which
 * in turn assumes the server's log preserves the causal order rows were
 * created in (a parent is always pushed, and therefore logged, before any
 * child that references it) — see SyncEngine's doc comment for where that
 * assumption is enforced/relied on.
 */

/** Every replicated fact table: every business table except `ledger` and `vendor_stock`.
 * `vendor_stock` has a composite PK (no INTEGER `id`) and is a running
 * quantity like `ledger` — movements/issues replicate; the balance table does not. */
export const SYNC_TABLES = BUSINESS_TABLES.filter(
  (table) => table !== 'ledger' && table !== 'vendor_stock',
) as readonly Exclude<
  (typeof BUSINESS_TABLES)[number],
  'ledger' | 'vendor_stock'
>[];

/** Same version-4 (random) uuid SQL expression migration 024 uses. */
export const UUID_V4_SQL_EXPR = `(SELECT lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ))`;

/** Echo-suppression guard shared by every capture trigger. */
const APPLYING_GUARD = `(SELECT value FROM sync_state WHERE key = 'applying') IS NULL`;

interface ForeignKeyRef {
  /** The local column holding the (locally-meaningful-only) integer id. */
  from: string;
  /** The table that column references — assumed to key off `"id"`. */
  table: string;
}

async function columnNames(
  driver: DatabaseDriver,
  table: string,
): Promise<string[]> {
  const rows = await driver.all<{ name: string }>(
    `PRAGMA table_info("${table}")`,
  );
  return rows.map((r) => r.name);
}

/** One column's name plus whether its *declared* type (PRAGMA table_info) is BLOB. */
export interface ColumnInfo {
  name: string;
  isBlob: boolean;
}

/**
 * Every column on `table`, tagged with whether its declared type is BLOB
 * (e.g. `users.password_hash`) — see {@link jsonObjectExpr} for how a
 * BLOB-declared column is captured differently from every other column.
 *
 * ## History: BLOB columns used to be skipped entirely — a field bug
 *
 * SQLite's `json_object()` raises "JSON cannot hold BLOB values" for any
 * BLOB-typed argument at the moment it's actually a blob (found empirically:
 * `users.password_hash` is declared `BLOB`, which made the naive "every
 * column" version of this migration fail on the very first `INSERT INTO
 * users` in an in-memory smoke test). The original fix filtered every
 * declared-BLOB column out of the row image *unconditionally* — which
 * quietly meant `users` replicated without credentials at all: a second
 * device joining a sync project got the employee record but could never log
 * into it. That was wrong on two counts. First, the columns this schema
 * actually declares BLOB store plain TEXT today in practice (desktop:
 * `${saltHex}:${hashHex}`; web: `webpbkdf2$...` — see
 * apps/web/src/worker/webCrypto.ts), so excluding them lost ordinary
 * strings, not binary data. Second, even a genuine blob value doesn't need
 * to be dropped — it can travel as text via `hex()`.
 *
 * See {@link jsonObjectExpr}'s doc comment for the fix.
 */
export async function allColumnInfo(
  driver: DatabaseDriver,
  table: string,
): Promise<ColumnInfo[]> {
  const rows = await driver.all<{ name: string; type: string }>(
    `PRAGMA table_info("${table}")`,
  );
  return rows.map((r) => ({
    name: r.name,
    isBlob: /BLOB/i.test(r.type ?? ''),
  }));
}

/** Every FK column on `table`, deduped by column (PRAGMA can list a column once per constraint it satisfies). */
export async function foreignKeys(
  driver: DatabaseDriver,
  table: string,
): Promise<ForeignKeyRef[]> {
  const rows = await driver.all<{ from: string; table: string }>(
    `PRAGMA foreign_key_list("${table}")`,
  );
  const seen = new Set<string>();
  const result: ForeignKeyRef[] = [];
  for (const row of rows) {
    if (seen.has(row.from)) continue;
    seen.add(row.from);
    result.push({ from: row.from, table: row.table });
  }
  return result;
}

/**
 * `json_object('col1', <ref col1>, ..., 'fkCol_uuid', (SELECT uuid FROM
 * refTable WHERE id = <ref fkCol>), ...)` — `ref` resolves how to read a
 * given column for this trigger variant (`t."col"` for the self-select
 * INSERT/UPDATE variant, `OLD."col"` for DELETE).
 *
 * A column whose *declared* type is BLOB (`col.isBlob`) gets TWO keys
 * instead of one, mirroring the `<col>_uuid` FK-sibling convention already
 * used below: `'col'` holds the value only when it is NOT actually a blob at
 * runtime (`typeof(...) = 'blob'`), and `'col__hex'` holds `hex(...)` of it
 * when it IS. This is deliberately keyed off the *runtime* `typeof()`, not
 * just the declared column type: SQLite is dynamically typed, so a
 * BLOB-declared column can and, for `users.password_hash` as this schema
 * actually uses it, does hold a plain TEXT value (`${saltHex}:${hashHex}` on
 * desktop, `webpbkdf2$...` on web — see apps/web/src/worker/webCrypto.ts).
 * That common case round-trips as ordinary JSON text via the `'col'` key,
 * never hex-encoded/decoded pointlessly. Only an actual blob value takes the
 * `'col__hex'` path — `json_object()` cannot hold a BLOB argument at all
 * (see {@link allColumnInfo}'s doc comment for why), so encoding is not
 * optional in that case, merely conditional on it. The apply path
 * (`SyncEngine.applyRow`) decodes `col__hex` back into a real blob when
 * present; see its doc comment.
 */
export function jsonObjectExpr(
  columns: ColumnInfo[],
  fks: ForeignKeyRef[],
  ref: (column: string) => string,
): string {
  const parts: string[] = [];
  for (const col of columns) {
    if (col.isBlob) {
      parts.push(
        `'${col.name}', CASE WHEN typeof(${ref(
          col.name,
        )}) = 'blob' THEN NULL ELSE ${ref(col.name)} END`,
      );
      parts.push(
        `'${col.name}__hex', CASE WHEN typeof(${ref(
          col.name,
        )}) = 'blob' THEN hex(${ref(col.name)}) ELSE NULL END`,
      );
    } else {
      parts.push(`'${col.name}', ${ref(col.name)}`);
    }
  }
  for (const fk of fks) {
    parts.push(
      `'${fk.from}_uuid', (SELECT "uuid" FROM "${fk.table}" WHERE "id" = ${ref(
        fk.from,
      )})`,
    );
  }
  return `json_object(${parts.join(', ')})`;
}

/**
 * Columns that do not, on their own, indicate a genuine application-level
 * change to a row: `id` never changes, `uuid` is assigned once (by the
 * insert-capture trigger below) and never again, and `createdAt`/
 * `updatedAt` are unconditionally re-stamped by the pre-existing
 * `after_insert/update_<table>_add_timestamp` triggers on *every* write
 * regardless of what that write touched.
 *
 * This matters more than it looks: those pre-existing timestamp triggers,
 * and this migration's own uuid-assignment step, each issue their own
 * nested `UPDATE` against the row from inside an AFTER INSERT/UPDATE
 * trigger body. SQLite fires every *other* AFTER UPDATE trigger registered
 * on a table in response to such a nested update (`recursive_triggers`
 * being off, the historical default this app runs with, only blocks a
 * trigger from re-firing *itself* — verified empirically against the
 * better-sqlite3 build this app ships, not merely inferred from docs).
 * Without this guard, the update-capture trigger below fires once for the
 * genuine app-level UPDATE and then AGAIN for every incidental nested
 * timestamp/uuid-only update those other triggers cause underneath it —
 * multiple redundant `sync_outbox` rows per single logical change (caught
 * by an in-memory smoke test while building this migration: a single
 * `INSERT` produced five `sync_outbox` rows before this guard existed).
 * Gating the update-capture trigger on "did any column other than these
 * change" makes it fire exactly once per genuine write, independent of how
 * many timestamp/uuid side-effect updates cascade around it.
 */
const CHANGE_IGNORED_COLUMNS = new Set([
  'id',
  'uuid',
  'createdAt',
  'updatedAt',
]);

/** `NEW.col IS NOT OLD.col OR ...` over every column that isn't in {@link CHANGE_IGNORED_COLUMNS} (`IS NOT`, not `!=`, so NULL-vs-NULL correctly counts as "unchanged"). */
function realChangeGuardExpr(columns: string[]): string {
  const tracked = columns.filter((c) => !CHANGE_IGNORED_COLUMNS.has(c));
  // Every business table has at least one tracked column in practice; '1'
  // is a defensive fallback (always capture) rather than a silent no-op
  // trigger, should that ever not hold.
  if (tracked.length === 0) return '1';
  return tracked.map((c) => `NEW."${c}" IS NOT OLD."${c}"`).join(' OR ');
}

/**
 * Builds (or, called again after a `DROP TRIGGER IF EXISTS` on all three,
 * rebuilds) `table`'s three capture triggers from its current schema.
 * Exported so migration 031 (src/core/db/migrations/031_replicate_blob_columns.ts)
 * can reuse this exact builder against an already-bootstrapped database
 * rather than duplicating the trigger SQL.
 */
export async function createCaptureTriggers(
  driver: DatabaseDriver,
  table: string,
): Promise<void> {
  const columns = await allColumnInfo(driver, table);
  const fks = await foreignKeys(driver, table);

  const selfRef = (col: string) => `t."${col}"`;
  const oldRef = (col: string) => `OLD."${col}"`;
  const selfJson = jsonObjectExpr(columns, fks, selfRef);
  const oldJson = jsonObjectExpr(columns, fks, oldRef);

  // Migration 024 created "trg_<table>_uuid" for every business table
  // except `users` (excluded there) and `ledger` stays untouched (not
  // replicated). Drop it and fold its exact logic into the front of the
  // insert-capture trigger below — see this file's doc comment for why
  // relying on cross-trigger firing order is unsafe.
  await driver.exec(`DROP TRIGGER IF EXISTS "trg_${table}_uuid"`);

  await driver.exec(`
    CREATE TRIGGER IF NOT EXISTS "trg_sync_capture_${table}_insert"
    AFTER INSERT ON "${table}"
    WHEN ${APPLYING_GUARD}
    BEGIN
      UPDATE "${table}" SET "uuid" = ${UUID_V4_SQL_EXPR}
        WHERE "id" = NEW."id" AND "uuid" IS NULL;

      INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
      SELECT ${UUID_V4_SQL_EXPR}, '${table}', t."uuid", 'put', ${selfJson}, datetime('now')
      FROM "${table}" t
      WHERE t."id" = NEW."id";
    END;
  `);

  await driver.exec(`
    CREATE TRIGGER IF NOT EXISTS "trg_sync_capture_${table}_update"
    AFTER UPDATE ON "${table}"
    WHEN ${APPLYING_GUARD} AND (${realChangeGuardExpr(
      columns.map((c) => c.name),
    )})
    BEGIN
      INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
      SELECT ${UUID_V4_SQL_EXPR}, '${table}', t."uuid", 'put', ${selfJson}, datetime('now')
      FROM "${table}" t
      WHERE t."id" = NEW."id";
    END;
  `);

  await driver.exec(`
    CREATE TRIGGER IF NOT EXISTS "trg_sync_capture_${table}_delete"
    AFTER DELETE ON "${table}"
    WHEN ${APPLYING_GUARD}
    BEGIN
      INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
      VALUES (${UUID_V4_SQL_EXPR}, '${table}', OLD."uuid", 'delete', ${oldJson}, datetime('now'));
    END;
  `);
}

/** `users` never got a uuid column from migration 024 — give it one now, same shape as every other business table. */
async function ensureUsersUuid(driver: DatabaseDriver): Promise<void> {
  const cols = await columnNames(driver, 'users');
  if (!cols.includes('uuid')) {
    await driver.exec(`ALTER TABLE "users" ADD COLUMN "uuid" TEXT`);
  }

  const pending = await driver.all<{ id: number }>(
    `SELECT "id" FROM "users" WHERE "uuid" IS NULL`,
  );
  for (const row of pending) {
    // eslint-disable-next-line no-await-in-loop
    await driver.run(
      `UPDATE "users" SET "uuid" = ${UUID_V4_SQL_EXPR} WHERE "id" = @id`,
      { id: row.id },
    );
  }

  await driver.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_uuid" ON "users"("uuid")`,
  );
}

export const migration029 = {
  name: '029_create_sync_tables',
  async up(driver: DatabaseDriver): Promise<void> {
    await ensureUsersUuid(driver);

    await driver.exec(`
      CREATE TABLE IF NOT EXISTS sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotencyKey TEXT UNIQUE,
        tableName TEXT NOT NULL,
        rowUuid TEXT NOT NULL,
        op TEXT NOT NULL CHECK (op IN ('put', 'delete')),
        rowJson TEXT NOT NULL,
        createdAt DATETIME
      )
    `);

    await driver.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Not in the migration-029 task list verbatim, but required by it:
    // "rejected entries move to a sync_rejected table for the future
    // needs-review inbox." No server-side validation exists yet (Phase-3
    // work — see MockSyncServer's doc comment), so nothing populates this
    // table today; it exists so SyncEngine has somewhere durable to put a
    // push rejection once a real server starts issuing them.
    await driver.exec(`
      CREATE TABLE IF NOT EXISTS sync_rejected (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotencyKey TEXT,
        tableName TEXT NOT NULL,
        rowUuid TEXT NOT NULL,
        op TEXT NOT NULL CHECK (op IN ('put', 'delete')),
        rowJson TEXT NOT NULL,
        reason TEXT,
        rejectedAt DATETIME
      )
    `);

    for (const table of SYNC_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      await createCaptureTriggers(driver, table);
    }
  },
};
