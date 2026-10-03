import type { DatabaseDriver } from '../driver';

/**
 * Migration 043 — Fix insert & update timestamp triggers and repair invoices.
 *
 * ## The Problem
 *
 * In migration 040, `after_insert_<table>_add_timestamp` was modified to only
 * update `createdAt` and `updatedAt` when they were NULL:
 * `WHERE id = NEW.id AND createdAt IS NULL;`
 *
 * Migration 040 assumed:
 * "both columns have no DEFAULT and are nullable — src/sql/schema.sql"
 *
 * However, `invoices`, `invoice_items`, and `inventory` define:
 * `"createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
 * `"updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
 *
 * In SQLite, `CURRENT_TIMESTAMP` produces a UTC string (e.g. 13:07:22).
 * When an ordinary insert was performed (e.g. via `InvoiceService.insertInvoice`),
 * SQLite evaluated the column defaults and populated `createdAt` and `updatedAt`
 * with UTC timestamps. Because `createdAt` was not NULL, migration 040's
 * trigger did NOT overwrite it with `datetime(CURRENT_TIMESTAMP, 'localtime')` (18:07:22).
 *
 * Subsequently, migration 034's `trg_sync_capture_invoices_insert` backfilled `uuid`:
 * `UPDATE invoices SET uuid = ... WHERE id = NEW.id AND uuid IS NULL;`
 *
 * Because `after_update_invoices_add_timestamp` did not guard against uuid backfills,
 * it fired and unconditionally updated:
 * `updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')` (18:07:22).
 *
 * This left newly inserted invoices with:
 *   - `createdAt` = UTC time (e.g. 13:07:22)
 *   - `updatedAt` = Local Pakistan time (e.g. 18:07:22)
 * Exactly 5 hours apart!
 * In the UI, `isPersistedRowEdited` checks `updatedAt > createdAt`, so every newly
 * created invoice immediately displayed the "Edited" pill.
 *
 * ## The Fix
 *
 * 1. Rebuild `after_insert_<table>_add_timestamp`:
 *    Fill `createdAt` and `updatedAt` with `datetime(CURRENT_TIMESTAMP, 'localtime')`
 *    whenever `createdAt` is NULL OR `createdAt = CURRENT_TIMESTAMP` (the table default).
 *    Guard with `sync_state` checking both `'applying'` (sync) and `'importing'` (desktop import).
 *
 * 2. Rebuild `after_update_<table>_add_timestamp`:
 *    Guard with `AND NOT (OLD.uuid IS NULL AND NEW.uuid IS NOT NULL)` so the
 *    uuid backfill on insert never fires the update trigger and never cascades.
 *    Also guard against `'applying'` and `'importing'`.
 *
 * 3. Repair existing invoices, invoice_items, and inventory rows created with
 *    `createdAt` in UTC and `updatedAt` in local time:
 *    `SET createdAt = updatedAt WHERE datetime(createdAt, 'localtime') = datetime(updatedAt) AND createdAt <> updatedAt`
 *    executed with `sync_state.applying = '1'` so no triggers fire.
 */

const SYNC_OR_IMPORT_GUARD = `(SELECT value FROM sync_state WHERE key IN ('applying', 'importing')) IS NULL`;

export function parseInsertTimestampTriggerName(name: string): string | null {
  const match = /^after_insert_(.+)_add_timestamp$/.exec(name);
  return match ? match[1] : null;
}

export function parseUpdateTimestampTriggerName(name: string): string | null {
  const match = /^after_update_(.+)_add_timestamp$/.exec(name);
  return match ? match[1] : null;
}

function insertTriggerSql(name: string, table: string): string {
  return `
    CREATE TRIGGER "${name}"
    AFTER INSERT ON "${table}"
    WHEN ${SYNC_OR_IMPORT_GUARD}
    BEGIN
      UPDATE "${table}" SET
        createdAt = datetime(CURRENT_TIMESTAMP, 'localtime')
      WHERE id = NEW.id AND (createdAt IS NULL OR createdAt = CURRENT_TIMESTAMP);
      UPDATE "${table}" SET
        updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
      WHERE id = NEW.id AND (updatedAt IS NULL OR updatedAt = CURRENT_TIMESTAMP);
    END;
  `;
}

function updateTriggerSql(name: string, table: string): string {
  return `
    CREATE TRIGGER "${name}"
    AFTER UPDATE ON "${table}"
    WHEN ${SYNC_OR_IMPORT_GUARD}
      AND NOT (OLD.uuid IS NULL AND NEW.uuid IS NOT NULL)
    BEGIN
      UPDATE "${table}" SET
        updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
      WHERE id = NEW.id;
    END;
  `;
}

async function tableHasIdColumn(
  driver: DatabaseDriver,
  table: string,
): Promise<boolean> {
  const rows = await driver.all<{ name: string }>(
    `PRAGMA table_info("${table}")`,
  );
  return rows.some((row) => row.name === 'id');
}

export const migration043 = {
  name: '043_fix_insert_timestamp_triggers',
  async up(driver: DatabaseDriver): Promise<void> {
    // 1. Rebuild insert triggers
    const insertTriggers = await driver.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND
         name LIKE 'after_insert_%_add_timestamp'`,
    );

    for (const { name } of insertTriggers) {
      const table = parseInsertTimestampTriggerName(name);
      if (!table) continue;
      // eslint-disable-next-line no-await-in-loop
      if (!(await tableHasIdColumn(driver, table))) continue;

      // eslint-disable-next-line no-await-in-loop
      await driver.exec(`DROP TRIGGER "${name}"`);
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(insertTriggerSql(name, table));
    }

    // 2. Rebuild update triggers
    const updateTriggers = await driver.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND
         name LIKE 'after_update_%_add_timestamp'`,
    );

    for (const { name } of updateTriggers) {
      const table = parseUpdateTimestampTriggerName(name);
      if (!table) continue;
      // eslint-disable-next-line no-await-in-loop
      if (!(await tableHasIdColumn(driver, table))) continue;

      // eslint-disable-next-line no-await-in-loop
      await driver.exec(`DROP TRIGGER "${name}"`);
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(updateTriggerSql(name, table));
    }

    // 3. Repair existing rows whose createdAt was defaulted in UTC while updatedAt was local time
    await driver.run(
      `INSERT INTO sync_state (key, value) VALUES ('applying', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    try {
      await driver.run(
        `UPDATE invoices
         SET createdAt = updatedAt
         WHERE createdAt IS NOT NULL
           AND updatedAt IS NOT NULL
           AND createdAt <> updatedAt
           AND datetime(createdAt, 'localtime') = datetime(updatedAt)`,
      );
      await driver.run(
        `UPDATE invoice_items
         SET createdAt = updatedAt
         WHERE createdAt IS NOT NULL
           AND updatedAt IS NOT NULL
           AND createdAt <> updatedAt
           AND datetime(createdAt, 'localtime') = datetime(updatedAt)`,
      );
      await driver.run(
        `UPDATE inventory
         SET createdAt = updatedAt
         WHERE createdAt IS NOT NULL
           AND updatedAt IS NOT NULL
           AND createdAt <> updatedAt
           AND datetime(createdAt, 'localtime') = datetime(updatedAt)`,
      );
    } finally {
      await driver.run(`DELETE FROM sync_state WHERE key = 'applying'`);
    }
  },
};
