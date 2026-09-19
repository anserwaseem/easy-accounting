import type { DatabaseDriver } from '../db/driver';
import { BUSINESS_TABLES } from '../db/import';
import {
  allColumnInfo,
  foreignKeys,
  jsonObjectExpr,
  SYNC_TABLES,
} from '../db/migrations/029_create_sync_tables';

/**
 * {@link SYNC_TABLES}, but ordered the same way {@link BUSINESS_TABLES}
 * already is: parents before children. `SYNC_TABLES` itself is *derived*
 * from `BUSINESS_TABLES` (minus `ledger` and `vendor_stock` — see migration
 * 029's doc comment) by array iteration, so it already preserves that order
 * today; this re-filters `BUSINESS_TABLES` directly anyway, rather than
 * trusting that derivation to keep doing so forever, because the ordering
 * here is load-bearing for correctness (see this file's top doc comment)
 * and `BUSINESS_TABLES` (src/core/db/import.ts) is the actual, documented
 * source of truth for "parents before children" — `SYNC_TABLES`'s own doc
 * comment makes no ordering promise of its own.
 */
const SYNC_TABLE_SET: ReadonlySet<string> = new Set(SYNC_TABLES);
const SEED_TABLE_ORDER: readonly string[] = BUSINESS_TABLES.filter((table) =>
  SYNC_TABLE_SET.has(table),
);

/**
 * Recovers from a wiped/truncated server log by re-populating
 * `sync_outbox` from this device's OWN already-applied business data, so
 * the very next {@link import('./SyncEngine').SyncEngine.syncOnce | syncOnce}'s
 * outbox drain re-uploads everything.
 *
 * ## The gap this closes
 *
 * `SyncEngine.pullAndApply`'s epoch-reset handling (cursor found ahead of
 * the server's watermark) recovers this device's *cursor* — it resets to 0
 * and re-pulls whatever the server now has. But a device whose
 * `sync_outbox` is already empty (everything it ever wrote was pushed and
 * drained long before the server's log was wiped) has nothing left to
 * push: the cursor heals, the pull loop finds nothing, and the server's
 * log simply stays empty forever, even though this device is sitting on
 * a complete copy of the business's data. This is exactly the real
 * incident that motivated this file: an owner's Supabase `sync_log` was
 * accidentally truncated via a stale buffer re-run in the SQL editor,
 * while their PWA held the complete local SQLite database with nothing
 * pending in its outbox.
 *
 * `SyncEngine` calls this helper (see its `pullAndApply` doc comment for
 * exactly when) once it has independently confirmed both preconditions —
 * the server's log is empty AND this device actually holds business data
 * worth re-seeding it with — so this function itself does not re-check
 * either; it unconditionally (re-)captures every current row of every
 * {@link SYNC_TABLES} table into the outbox, in `SEED_TABLE_ORDER`
 * (parents before children — see `SyncEngine`'s "Apply ordering and the
 * causality assumption" doc comment for why a receiving device's apply
 * loop requires this: a child row's `<fk>_uuid` must resolve against a
 * parent row already applied locally, which only holds if the parent's
 * `put` was logged, and therefore pulled, first).
 *
 * ## Row image: identical to what a capture trigger would produce
 *
 * Each table's `INSERT ... SELECT` builds its row image with the exact
 * same {@link jsonObjectExpr} builder migration 029's `createCaptureTriggers`
 * uses for that table's own triggers (fed the same {@link allColumnInfo}/
 * {@link foreignKeys} introspection) — so a reseeded row is byte-for-byte
 * what a normal INSERT would have captured, including the declared-blob
 * `<col>`/`<col>__hex` typed-pair handling and `<fkCol>_uuid` FK siblings.
 * Nothing here duplicates that trigger SQL by hand.
 *
 * ## Idempotency key: correlated per row, NOT `UUID_V4_SQL_EXPR`
 *
 * A deterministic `'reseed:<table>:' || uuid` key, not a fresh random one.
 * This is deliberate on two counts:
 *
 * 1. **Local idempotency.** Re-running this helper (e.g. `syncOnce` calling
 *    it again on a later cycle before the previous seeding's push actually
 *    landed, or simply because the precondition is still true) must not
 *    pile up a second copy of every row in the outbox. The `NOT EXISTS`
 *    guard against this exact key, keyed off the row's own stable `uuid`
 *    (never off table-generated `id`, which is device-local), makes a
 *    repeat call a no-op for any row already queued.
 * 2. **The non-correlated-subquery trap this deliberately avoids.**
 *    Migration 029's own `UUID_V4_SQL_EXPR` — `(SELECT lower(hex(...)))`,
 *    a scalar subquery that references none of the outer query's columns —
 *    is evaluated ONCE per *statement* by SQLite's query planner, not once
 *    per output row (confirmed empirically against the better-sqlite3 build
 *    this app ships; see migrations 031 and 033's doc comments, where this
 *    was first found and fixed). Using it here in a bulk
 *    `INSERT ... SELECT` matching more than one row per table — the normal
 *    case for this helper, unlike migration 031's narrowly-scoped
 *    `password_hash IS NOT NULL` re-emission — would give every seeded row
 *    of a table the SAME `idempotencyKey`, which `sync_outbox`'s own
 *    `UNIQUE(idempotencyKey)` constraint rejects outright once a table has
 *    more than one qualifying row. `'reseed:' || table || ':' || t."uuid"`
 *    sidesteps this entirely: it's a *correlated* expression (it reads the
 *    current row's own `t."uuid"`), so SQLite evaluates it fresh for every
 *    row the SELECT produces, exactly like every other per-row column in
 *    the same SELECT list.
 *
 *    The table name is folded into the key (not just `'reseed:' || uuid`)
 *    purely as extra insurance: `uuid` is unique *within* a table by
 *    construction, but two different tables' rows colliding on the same
 *    random uuid value, while astronomically unlikely, costs nothing to
 *    rule out entirely.
 *
 * A deterministic key is also harmless wherever it lands: a truncated
 * server log has no dedup memory left to collide with regardless of what
 * key is sent, and an UN-truncated log receiving this same key a second
 * time (this helper called again when its precondition still holds, or a
 * dropped-response retry of the very push that carries these rows) is
 * exactly the "duplicate push, same idempotencyKey" case the whole
 * idempotency-key mechanism (`OutboxEntry.idempotencyKey`,
 * `MockSyncServer`'s dedup) already exists to absorb as a correct no-op.
 *
 * ## No trigger involvement, no echo-suppression interaction
 *
 * This writes directly into `sync_outbox` via a plain `INSERT ... SELECT`
 * against the business tables — it never issues an `INSERT`/`UPDATE`/
 * `DELETE` against a `SYNC_TABLES` table itself, so migration 029's capture
 * triggers (`trg_sync_capture_<table>_*`) are never invoked at all; there
 * is nothing to echo-suppress via `sync_state.applying` here, unlike
 * `SyncEngine.pullAndApply`'s own apply loop.
 *
 * ## Transactional
 *
 * The whole sweep (every table) runs inside one {@link DatabaseDriver.transaction}
 * call — either every currently-missing row gets queued, or (if something
 * throws partway through, e.g. a driver error) none of this call's inserts
 * are left half-applied for the next attempt to reconcile around.
 */
export async function seedOutboxFromLocalData(
  driver: DatabaseDriver,
): Promise<{ seeded: number }> {
  return driver.transaction(async () => {
    let seeded = 0;
    for (const table of SEED_TABLE_ORDER) {
      // eslint-disable-next-line no-await-in-loop
      const columns = await allColumnInfo(driver, table);
      // eslint-disable-next-line no-await-in-loop
      const fks = await foreignKeys(driver, table);
      const rowImage = jsonObjectExpr(columns, fks, (col) => `t."${col}"`);
      const keyExpr = `'reseed:${table}:' || t."uuid"`;

      // eslint-disable-next-line no-await-in-loop
      const result = await driver.run(`
        INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
        SELECT ${keyExpr}, '${table}', t."uuid", 'put', ${rowImage}, datetime('now')
        FROM "${table}" t
        WHERE t."uuid" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM sync_outbox o WHERE o.idempotencyKey = ${keyExpr}
          )
      `);
      seeded += result.changes;
    }
    return { seeded };
  });
}
