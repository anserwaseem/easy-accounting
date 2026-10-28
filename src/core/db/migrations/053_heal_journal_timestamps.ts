import type { DatabaseDriver } from '../driver';
import {
  allColumnInfo,
  createCaptureTriggers,
  foreignKeys,
  jsonObjectExpr,
  SYNC_TABLES,
} from './034_create_sync_tables';

/**
 * Migration 053 — Heal journal and account timestamps and protect capture triggers.
 *
 * ## The Problem
 *
 * In SQLite, multiple `AFTER INSERT` triggers on the same table execute in
 * reverse order of creation (LIFO).
 *
 * In migration 051 (`051_journal_reversal_link`), `trg_sync_capture_journal_insert`
 * was dropped and recreated. Because this happened after migration 043 (which
 * created `after_insert_journal_add_timestamp`), SQLite placed the capture trigger
 * ahead of the timestamp trigger.
 *
 * Unlike `invoices` or `inventory` (which define `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`),
 * `journal` and `account` define bare `DATETIME` columns without default values.
 *
 * When a new journal was inserted:
 * 1. `trg_sync_capture_journal_insert` executed FIRST, querying `journal t`.
 * 2. `t.createdAt` and `t.updatedAt` were still NULL because the timestamp trigger
 *    had not executed yet.
 * 3. The capture trigger emitted `{ createdAt: null, updatedAt: null }` into `sync_outbox`.
 * 4. The origin device then ran the timestamp trigger and populated the local row,
 *    but `trg_sync_capture_journal_update` specifically ignores timestamp-only updates
 *    (`realChangeGuardExpr`) to prevent trigger cascades.
 * 5. When any peer device pulled that row, `SyncEngine.applyRow` wrote the row with
 *    `createdAt = NULL` and `updatedAt = NULL`. Furthermore, `sync_state.applying = '1'`
 *    suppressed the peer's own timestamp trigger, leaving the peer with NULL timestamps permanently.
 *
 * Migration 049 similarly rebuilt capture triggers for `account`, leading to the exact
 * same condition for accounts created after Oct 14.
 *
 * ## The Fix
 *
 * 1. Find all `journal` and `account` rows where `createdAt IS NULL` or `updatedAt IS NULL`.
 * 2. Backfill them with timestamps under `sync_state.applying = '1'`:
 *    - For `journal`: prefer the linked invoice's timestamps, then journal `date`, then current time.
 *    - For `account`: prefer account `date`, then current time.
 * 3. Rebuild capture triggers for all `SYNC_TABLES`. Updated `createCaptureTriggers`
 *    now ensures `createdAt` and `updatedAt` are filled in the table row *inside*
 *    the insert-capture trigger before `selfJson` is selected.
 * 4. Re-emit the healed rows to `sync_outbox` so all peer devices receive the corrected
 *    timestamps.
 */

async function rebuildCaptureTriggers(
  driver: DatabaseDriver,
  table: string,
): Promise<void> {
  await driver.exec(
    `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_insert"`,
  );
  await driver.exec(
    `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_update"`,
  );
  await driver.exec(
    `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_delete"`,
  );
  await createCaptureTriggers(driver, table);
}

export const migration053 = {
  name: '053_heal_journal_timestamps',
  async up(driver: DatabaseDriver): Promise<void> {
    const affectedJournals = await driver.all<{ id: number; uuid: string }>(
      `SELECT id, uuid FROM journal WHERE createdAt IS NULL OR updatedAt IS NULL`,
    );
    const affectedAccounts = await driver.all<{ id: number; uuid: string }>(
      `SELECT id, uuid FROM account WHERE createdAt IS NULL OR updatedAt IS NULL`,
    );

    await driver.run(
      `INSERT INTO sync_state (key, value) VALUES ('applying', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );

    try {
      await driver.exec(`
        UPDATE journal
        SET
          createdAt = COALESCE(
            createdAt,
            (SELECT createdAt FROM invoices WHERE invoices.id = journal.invoiceId),
            CASE WHEN date LIKE '%T%' THEN replace(replace(date, 'T', ' '), 'Z', '') ELSE date || ' 00:00:00' END,
            datetime(CURRENT_TIMESTAMP, 'localtime')
          ),
          updatedAt = COALESCE(
            updatedAt,
            (SELECT updatedAt FROM invoices WHERE invoices.id = journal.invoiceId),
            (SELECT createdAt FROM invoices WHERE invoices.id = journal.invoiceId),
            CASE WHEN date LIKE '%T%' THEN replace(replace(date, 'T', ' '), 'Z', '') ELSE date || ' 00:00:00' END,
            datetime(CURRENT_TIMESTAMP, 'localtime')
          )
        WHERE createdAt IS NULL OR updatedAt IS NULL;

        UPDATE account
        SET
          createdAt = COALESCE(
            createdAt,
            CASE WHEN date LIKE '%T%' THEN replace(replace(date, 'T', ' '), 'Z', '') ELSE date || ' 00:00:00' END,
            datetime(CURRENT_TIMESTAMP, 'localtime')
          ),
          updatedAt = COALESCE(
            updatedAt,
            CASE WHEN date LIKE '%T%' THEN replace(replace(date, 'T', ' '), 'Z', '') ELSE date || ' 00:00:00' END,
            datetime(CURRENT_TIMESTAMP, 'localtime')
          )
        WHERE createdAt IS NULL OR updatedAt IS NULL;
      `);

      for (const table of SYNC_TABLES) {
        // eslint-disable-next-line no-await-in-loop
        const cols = (await allColumnInfo(driver, table)).map((c) => c.name);
        if (cols.includes('createdAt') && cols.includes('updatedAt')) {
          // eslint-disable-next-line no-await-in-loop
          await driver.exec(`
            UPDATE "${table}"
            SET
              createdAt = COALESCE(createdAt, updatedAt, datetime(CURRENT_TIMESTAMP, 'localtime')),
              updatedAt = COALESCE(updatedAt, createdAt, datetime(CURRENT_TIMESTAMP, 'localtime'))
            WHERE createdAt IS NULL OR updatedAt IS NULL;
          `);
        }
      }
    } finally {
      await driver.run(`DELETE FROM sync_state WHERE key = 'applying'`);
    }

    // Rebuild capture triggers for all sync tables so the insert trigger sets
    // createdAt and updatedAt before outbox JSON capture
    for (const table of SYNC_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      await rebuildCaptureTriggers(driver, table);
    }

    // Re-emit healed rows to sync_outbox so peer devices receive the valid timestamps
    if (affectedJournals.length > 0) {
      const columns = await allColumnInfo(driver, 'journal');
      const fks = await foreignKeys(driver, 'journal');
      const rowJson = jsonObjectExpr(columns, fks, (col) => `t."${col}"`);
      const ids = affectedJournals.map((j) => j.id).join(',');
      await driver.exec(`
        INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
        SELECT t."uuid" || ':heal-ts-053', 'journal', t."uuid", 'put', ${rowJson}, datetime('now')
        FROM "journal" t
        WHERE t."id" IN (${ids})
      `);
    }

    if (affectedAccounts.length > 0) {
      const columns = await allColumnInfo(driver, 'account');
      const fks = await foreignKeys(driver, 'account');
      const rowJson = jsonObjectExpr(columns, fks, (col) => `t."${col}"`);
      const ids = affectedAccounts.map((a) => a.id).join(',');
      await driver.exec(`
        INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
        SELECT t."uuid" || ':heal-ts-053', 'account', t."uuid", 'put', ${rowJson}, datetime('now')
        FROM "account" t
        WHERE t."id" IN (${ids})
      `);
    }
  },
};
