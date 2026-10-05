import type { DatabaseDriver } from '../driver';
import { createCaptureTriggers } from './034_create_sync_tables';
import {
  insertTriggerSql,
  updateTriggerSql,
} from './043_fix_insert_timestamp_triggers';

/**
 * Migration 045 — agent tours and the per-account collection role.
 *
 * - `agent_tours`: dated trips of an agent (a custom head, `chart.parentId`
 *   set). One row per tour, kept as history. `endDate` NULL means the tour
 *   is still running. Receipts are attributed to a tour by journal date, so
 *   nothing on `journal` changes.
 * - `account.collectionRole`: NULL follows the default receipt rule (top-level
 *   Asset chart), `'receipt'` always counts the account as a receipt
 *   counterparty, `'exclude'` never does. See `LedgerService`.
 *
 * Both replicate: `account` capture triggers are rebuilt so the new column is
 * in the row image, and `agent_tours` gets its own (it is in
 * `BUSINESS_TABLES`). Older devices drop the unknown column on apply
 * (`SyncEngine.applyRow` uses the column intersection).
 */
export const migration045 = {
  name: '045_agent_tours',
  async up(driver: DatabaseDriver): Promise<void> {
    const accountColumns = await driver.all<{ name: string }>(
      `PRAGMA table_info("account")`,
    );
    if (!accountColumns.some((c) => c.name === 'collectionRole')) {
      await driver.exec(
        `ALTER TABLE "account" ADD COLUMN "collectionRole" TEXT
           CHECK ("collectionRole" IN ('receipt', 'exclude'))`,
      );
    }

    await driver.exec(`
      CREATE TABLE IF NOT EXISTS "agent_tours" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "chartId" INTEGER NOT NULL REFERENCES "chart"("id"),
        "name" TEXT NOT NULL,
        "startDate" TEXT NOT NULL,
        "endDate" TEXT,
        "notes" TEXT,
        "createdAt" DATETIME,
        "updatedAt" DATETIME,
        "uuid" TEXT,
        CHECK ("endDate" IS NULL OR "endDate" >= "startDate")
      )
    `);
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS "idx_agent_tours_chartId" ON "agent_tours"("chartId", "startDate")`,
    );
    await driver.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_tours_uuid" ON "agent_tours"("uuid")`,
    );

    await driver.exec(
      `DROP TRIGGER IF EXISTS "after_insert_agent_tours_add_timestamp"`,
    );
    await driver.exec(
      insertTriggerSql('after_insert_agent_tours_add_timestamp', 'agent_tours'),
    );
    await driver.exec(
      `DROP TRIGGER IF EXISTS "after_update_agent_tours_add_timestamp"`,
    );
    await driver.exec(
      updateTriggerSql('after_update_agent_tours_add_timestamp', 'agent_tours'),
    );

    for (const table of ['account', 'agent_tours']) {
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
