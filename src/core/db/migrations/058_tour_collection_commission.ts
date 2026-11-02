import type { DatabaseDriver } from '../driver';
import { createCaptureTriggers } from './034_create_sync_tables';

/**
 * Migration 058 — tour-collection commission: a separately configurable rate
 * on `agent_commissions`, plus a dedicated settlement table so the sale-based
 * and tour-collection modes never collide on the (chartId, startDate, endDate)
 * key.
 */
const NEW_TABLE = 'agent_tour_collection_settlements';
const CHANGED_TABLES = ['agent_commissions', NEW_TABLE] as const;

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

export const migration058 = {
  name: '058_tour_collection_commission',
  async up(driver: DatabaseDriver): Promise<void> {
    const cols = await driver.all<{ name: string }>(
      `PRAGMA table_info("agent_commissions")`,
    );
    if (!cols.some((c) => c.name === 'tourCollectionRatePercent')) {
      await driver.exec(
        `ALTER TABLE "agent_commissions" ADD COLUMN "tourCollectionRatePercent" REAL NOT NULL DEFAULT 0`,
      );
    }

    await driver.exec(`
      CREATE TABLE IF NOT EXISTS "${NEW_TABLE}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "chartId" INTEGER NOT NULL,
        "startDate" TEXT NOT NULL,
        "endDate" TEXT NOT NULL,
        "journalId" INTEGER,
        "grossCommission" DECIMAL(10, 2) NOT NULL DEFAULT 0,
        "tourCollectionRatePercent" REAL NOT NULL DEFAULT 0,
        "totalBase" DECIMAL(10, 2) NOT NULL DEFAULT 0,
        "clearedBase" DECIMAL(10, 2) NOT NULL DEFAULT 0,
        "pendingBase" DECIMAL(10, 2) NOT NULL DEFAULT 0,
        "adjustmentsJson" TEXT NOT NULL DEFAULT '[]',
        "netCommission" DECIMAL(10, 2) NOT NULL DEFAULT 0,
        "snapshotJson" TEXT NOT NULL DEFAULT '[]',
        "createdAt" DATETIME,
        "updatedAt" DATETIME,
        "uuid" TEXT,
        FOREIGN KEY ("chartId") REFERENCES "chart"("id") ON DELETE CASCADE,
        FOREIGN KEY ("journalId") REFERENCES "journal"("id") ON DELETE SET NULL
      )
    `);
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS "idx_${NEW_TABLE}_chartId" ON "${NEW_TABLE}"("chartId", "startDate", "endDate")`,
    );
    await driver.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${NEW_TABLE}_uuid" ON "${NEW_TABLE}"("uuid")`,
    );

    for (const table of CHANGED_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(
        `DROP TRIGGER IF EXISTS "after_insert_${table}_add_timestamp"`,
      );
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(
        `DROP TRIGGER IF EXISTS "after_update_${table}_add_timestamp"`,
      );
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(timestampTriggersSql(table));

      // eslint-disable-next-line no-await-in-loop
      for (const op of ['insert', 'update', 'delete']) {
        // eslint-disable-next-line no-await-in-loop
        await driver.exec(
          `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_${op}"`,
        );
      }
      // eslint-disable-next-line no-await-in-loop
      await createCaptureTriggers(driver, table);
    }
  },
};
