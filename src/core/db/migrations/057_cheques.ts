import type { DatabaseDriver } from '../driver';
import { createCaptureTriggers } from './034_create_sync_tables';

/**
 * Migration 057 — cheque register and clearance workflow.
 *
 * New tables:
 *  - cheques: one row per received customer/agent cheque. Stays pending until
 *    bank clearance; custody and holder are tracked independently of status.
 *  - cheque_allocations: the exact tier-account allocation for a cheque.
 *    Customer ledger accounts are NOT credited until clearance, so these rows
 *    are the source of truth for what becomes a receipt.
 *  - cheque_presentments: one row per presentment attempt (date, outcome,
 *    actual clearance date, bank fee, linked receipt journal).
 *  - cheque_custody_events: audit trail for holder changes (incl. transfer to
 *    an agent), without creating a second cheque or marking it cleared.
 *
 * pending instruments never touch customer balances / bill aging / cleared
 * collection totals; only a confirmed clearance posts the linked receipt.
 */
const CHEQUE_TABLES = [
  'cheques',
  'cheque_allocations',
  'cheque_presentments',
  'cheque_custody_events',
] as const;

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

export const migration057 = {
  name: '057_cheques',
  async up(driver: DatabaseDriver): Promise<void> {
    await driver.exec(`
      CREATE TABLE IF NOT EXISTS "cheques" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "chartId" INTEGER NOT NULL REFERENCES "chart"("id") ON DELETE CASCADE,
        "tourId" INTEGER REFERENCES "agent_tours"("id") ON DELETE SET NULL,
        "chequeNumber" TEXT NOT NULL,
        "bankName" TEXT,
        "branchName" TEXT,
        "amount" REAL NOT NULL DEFAULT 0,
        "receivedDate" TEXT NOT NULL,
        "expectedClearanceDate" TEXT,
        "status" TEXT NOT NULL DEFAULT 'pending'
          CHECK ("status" IN ('pending', 'presented', 'cleared', 'bounced')),
        "holder" TEXT NOT NULL DEFAULT 'business'
          CHECK ("holder" IN ('business', 'agent', 'bank')),
        "heldForCommission" INTEGER NOT NULL DEFAULT 0,
        "transferredToAgentAt" TEXT,
        "commissionSettlementId" INTEGER REFERENCES "agent_commission_settlements"("id") ON DELETE SET NULL,
        "commissionAppliedAmount" REAL,
        "clearedJournalId" INTEGER REFERENCES "journal"("id") ON DELETE SET NULL,
        "actualClearanceDate" TEXT,
        "notes" TEXT,
        "createdAt" DATETIME,
        "updatedAt" DATETIME,
        "uuid" TEXT
      );

      CREATE TABLE IF NOT EXISTS "cheque_allocations" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "chequeId" INTEGER NOT NULL REFERENCES "cheques"("id") ON DELETE CASCADE,
        "accountId" INTEGER NOT NULL REFERENCES "account"("id") ON DELETE RESTRICT,
        "amount" REAL NOT NULL DEFAULT 0,
        "createdAt" DATETIME,
        "updatedAt" DATETIME,
        "uuid" TEXT,
        UNIQUE ("chequeId", "accountId")
      );

      CREATE TABLE IF NOT EXISTS "cheque_presentments" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "chequeId" INTEGER NOT NULL REFERENCES "cheques"("id") ON DELETE CASCADE,
        "attemptNumber" INTEGER NOT NULL,
        "presentmentDate" TEXT NOT NULL,
        "bankReference" TEXT,
        "outcome" TEXT NOT NULL DEFAULT 'pending'
          CHECK ("outcome" IN ('pending', 'cleared', 'bounced')),
        "actualClearanceDate" TEXT,
        "bankFee" REAL NOT NULL DEFAULT 0,
        "notes" TEXT,
        "journalId" INTEGER REFERENCES "journal"("id") ON DELETE SET NULL,
        "createdAt" DATETIME,
        "updatedAt" DATETIME,
        "uuid" TEXT
      );

      CREATE TABLE IF NOT EXISTS "cheque_custody_events" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "chequeId" INTEGER NOT NULL REFERENCES "cheques"("id") ON DELETE CASCADE,
        "fromHolder" TEXT,
        "toHolder" TEXT NOT NULL,
        "eventDate" TEXT NOT NULL,
        "notes" TEXT,
        "createdAt" DATETIME,
        "updatedAt" DATETIME,
        "uuid" TEXT
      );
    `);

    await driver.exec(
      `CREATE INDEX IF NOT EXISTS "idx_cheques_chartId" ON "cheques"("chartId", "receivedDate")`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS "idx_cheques_tourId" ON "cheques"("tourId")`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS "idx_cheques_status" ON "cheques"("status")`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS "idx_cheque_allocations_chequeId" ON "cheque_allocations"("chequeId")`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS "idx_cheque_presentments_chequeId" ON "cheque_presentments"("chequeId")`,
    );
    await driver.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_cheques_uuid" ON "cheques"("uuid")`,
    );
    await driver.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_cheque_allocations_uuid" ON "cheque_allocations"("uuid")`,
    );
    await driver.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_cheque_presentments_uuid" ON "cheque_presentments"("uuid")`,
    );
    await driver.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_cheque_custody_events_uuid" ON "cheque_custody_events"("uuid")`,
    );

    for (const table of CHEQUE_TABLES) {
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
