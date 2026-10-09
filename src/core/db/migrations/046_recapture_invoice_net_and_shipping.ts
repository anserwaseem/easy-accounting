import type { DatabaseDriver } from '../driver';
import {
  allColumnInfo,
  createCaptureTriggers,
  foreignKeys,
  jsonObjectExpr,
} from './034_create_sync_tables';

/**
 * `045` added `invoices.shippingCharges`, `invoices.shippingAccountId`, and
 * `invoice_items.netPrice` without rebuilding the sync capture triggers.
 * Those triggers freeze the column list from the last time they were
 * created, so a typed net rate and a shipping amount never entered the
 * outbox. The other device applied the invoice with those fields missing
 * and showed an ordinary discounted line.
 *
 * Drop and rebuild the two tables' triggers from the current schema, then
 * re-emit only the local rows that actually hold a net price or shipping.
 * A peer that never had those values must not push its empty copy over the
 * good one.
 */
const TABLES = ['invoices', 'invoice_items'] as const;

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

async function reemit(
  driver: DatabaseDriver,
  table: string,
  whereSql: string,
): Promise<void> {
  const columns = await allColumnInfo(driver, table);
  const fks = await foreignKeys(driver, table);
  const rowJson = jsonObjectExpr(columns, fks, (col) => `t."${col}"`);
  await driver.exec(`
    INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
    SELECT t."uuid" || ':net-046', '${table}', t."uuid", 'put', ${rowJson}, datetime('now')
    FROM "${table}" t
    WHERE ${whereSql}
  `);
}

export const migration046 = {
  name: '046_recapture_invoice_net_and_shipping',
  async up(driver: DatabaseDriver): Promise<void> {
    for (const table of TABLES) {
      // eslint-disable-next-line no-await-in-loop
      await rebuildCaptureTriggers(driver, table);
    }
    await reemit(driver, 'invoice_items', 't."netPrice" IS NOT NULL');
    await reemit(
      driver,
      'invoices',
      'COALESCE(t."shippingCharges", 0) != 0 OR t."shippingAccountId" IS NOT NULL',
    );
  },
};
