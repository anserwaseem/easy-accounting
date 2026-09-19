import type { DatabaseDriver } from '../driver';

/**
 * Migration 030 — the local audit trail for a row `SyncEngine.applyRow`
 * could not apply. Has a desktop-side twin, `src/main/migrations/030.js` —
 * same reason migration 028/029 do (see `028_create_settings_table`'s doc
 * comment in `./index.ts`): the existing Electron install path runs schema
 * changes exclusively through the old synchronous `MigrationRunner`, which
 * never calls `bootstrapDatabase`, so a schema change meant to reach it has
 * to be expressed twice.
 *
 * ## Why this table exists — the real incident
 *
 * Two browser origins each independently imported the same desktop
 * database (fresh uuids assigned to every row by each import, since
 * `import.ts`'s replace-import never seeds a `uuid` — migration 029's
 * capture triggers assign it fresh on first insert), then both connected to
 * the *same* Supabase sync project. The result: two devices whose `users`
 * table both contain a row with `username = 'owner'` but two different
 * `uuid`s — same for `account(chartId, name, code)`, `item_types.name`,
 * and every other natural-key `UNIQUE` constraint this schema has. Pulling
 * the other device's log, `SyncEngine.applyRow`'s `INSERT ... ON
 * CONFLICT("uuid") DO UPDATE` cannot match the *other* device's uuid — from
 * this device's perspective it is a brand-new row — so the INSERT branch
 * runs, and the natural-key UNIQUE index (not "uuid") rejects it with
 * `SQLITE_CONSTRAINT_UNIQUE`. Before this migration, that exception
 * propagated out of the page's transaction, rolling back every other row
 * in the same page (including unrelated, perfectly fine rows) and leaving
 * `sync_state.cursor` unmoved — the next `syncOnce` re-fetched the exact
 * same page, hit the exact same conflict, and retried forever. The sync
 * loop was wedged, permanently, with no path to recovery short of a
 * support engineer manually editing the server's log.
 *
 * ## The trade-off this table encodes
 *
 * `SyncEngine` now catches a per-row apply failure, records it here, and
 * **advances the cursor past it anyway** — see `SyncEngine.pullAndApply`'s
 * doc comment for the full reasoning. In short: convergence for that one
 * conflicted row is deliberately abandoned in favor of the sync loop
 * staying live for every other row, on this table and every other table,
 * forever after. This table is the audit trail that makes that trade-off
 * safe to make silently — a human (today: a support engineer reading this
 * table directly; later: a proper "needs review" inbox UI, not built by
 * this migration) can see exactly what was dropped, for which table, with
 * what error, and decide what to do about it (typically: manually rename/
 * merge the conflicting natural-key row, or accept the loss). This is NOT
 * automatic conflict *resolution* — nothing here merges or re-tries a
 * conflicted row. It is conflict *containment*: one bad row can never again
 * take the whole sync loop down with it.
 *
 * `seq` (the server log position the row was pulled at) is stored
 * alongside the row image so a human/tool can correlate a conflict back to
 * exactly where in the log it was seen, even though the cursor has since
 * moved past it.
 */
export const migration030 = {
  name: '030_create_sync_apply_conflicts',
  async up(driver: DatabaseDriver): Promise<void> {
    await driver.exec(`
      CREATE TABLE IF NOT EXISTS sync_apply_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seq INTEGER NOT NULL,
        tableName TEXT NOT NULL,
        rowUuid TEXT NOT NULL,
        op TEXT NOT NULL CHECK (op IN ('put', 'delete')),
        rowJson TEXT NOT NULL,
        error TEXT NOT NULL,
        createdAt DATETIME
      )
    `);
  },
};
