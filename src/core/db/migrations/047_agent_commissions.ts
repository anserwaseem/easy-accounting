import type { DatabaseDriver } from '../driver';
import { createCaptureTriggers } from './034_create_sync_tables';

/**
 * Migration 047 — Agent commissions and settlements (2 tables).
 *
 * 1. agent_commissions: One row per agent head storing linked accounts, item type % rates,
 *    and SKU rupee overrides in JSON arrays.
 * 2. agent_commission_settlements: Audit log of periodic settlements linking date range,
 *    gross/net amounts, adjustment notes, line-item snapshot, and posted journal entry.
 */

const SYNC_OR_IMPORT_GUARD = `(SELECT value FROM sync_state WHERE key IN ('applying', 'importing')) IS NULL`;

function timestampTriggersSql(table: string): string {
  return `
    CREATE TRIGGER IF NOT EXISTS "after_insert_${table}_add_timestamp"
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

    CREATE TRIGGER IF NOT EXISTS "after_update_${table}_add_timestamp"
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

const COMMISSION_TABLES = [
  'agent_commissions',
  'agent_commission_settlements',
] as const;

export const migration047 = {
  name: '047_agent_commissions',
  async up(driver: DatabaseDriver): Promise<void> {
    await driver.exec(`
      CREATE TABLE IF NOT EXISTS agent_commissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chartId INTEGER NOT NULL UNIQUE,
        payableAccountId INTEGER,
        expenseAccountId INTEGER,
        ratesJson TEXT NOT NULL DEFAULT '[]',
        overridesJson TEXT NOT NULL DEFAULT '[]',
        createdAt DATETIME,
        updatedAt DATETIME,
        uuid TEXT,
        FOREIGN KEY (chartId) REFERENCES chart(id) ON DELETE CASCADE,
        FOREIGN KEY (payableAccountId) REFERENCES account(id) ON DELETE SET NULL,
        FOREIGN KEY (expenseAccountId) REFERENCES account(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS agent_commission_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chartId INTEGER NOT NULL,
        startDate TEXT NOT NULL,
        endDate TEXT NOT NULL,
        journalId INTEGER,
        grossCommission DECIMAL(10, 2) NOT NULL DEFAULT 0,
        adjustmentsJson TEXT NOT NULL DEFAULT '[]',
        netCommission DECIMAL(10, 2) NOT NULL DEFAULT 0,
        snapshotJson TEXT NOT NULL DEFAULT '[]',
        createdAt DATETIME,
        updatedAt DATETIME,
        uuid TEXT,
        FOREIGN KEY (chartId) REFERENCES chart(id) ON DELETE CASCADE,
        FOREIGN KEY (journalId) REFERENCES journal(id) ON DELETE SET NULL
      );
    `);

    for (const table of COMMISSION_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${table}_uuid" ON "${table}"("uuid");`,
      );
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(timestampTriggersSql(table));

      // eslint-disable-next-line no-await-in-loop
      await driver.exec(
        `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_insert";`,
      );
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(
        `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_update";`,
      );
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(
        `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_delete";`,
      );
      // eslint-disable-next-line no-await-in-loop
      await createCaptureTriggers(driver, table);
    }
  },
};
