import type { DatabaseDriver } from '../driver';
import { UUID_V4_SQL_EXPR } from './034_create_sync_tables';

/**
 * Globally unique row ids for every business table that can travel between
 * devices. INTEGER `id` stays (FKs still point at it). `users` gets a uuid
 * later in `034_create_sync_tables` when it becomes a replicated table.
 *
 * Idempotent: ADD COLUMN / CREATE INDEX IF NOT EXISTS.
 */
const ID_TABLES = [
  'chart',
  'account',
  'journal',
  'journal_entry',
  'ledger',
  'inventory',
  'item_types',
  'discount_profiles',
  'profile_type_discounts',
  'attribute_definitions',
  'price_lists',
  'inventory_prices',
  'invoices',
  'invoice_items',
  'inventory_opening_stock',
  'stock_adjustments',
  'vendor_issues',
  'vendor_issue_items',
  'vendor_stock_movements',
] as const;

async function tableExists(
  driver: DatabaseDriver,
  name: string,
): Promise<boolean> {
  const row = await driver.get(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name=@name`,
    { name },
  );
  return !!row;
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

async function addUuidOnIdTable(
  driver: DatabaseDriver,
  table: string,
): Promise<void> {
  if (!(await tableExists(driver, table))) return;
  const cols = await columnNames(driver, table);
  if (!cols.includes('uuid')) {
    await driver.exec(`ALTER TABLE "${table}" ADD COLUMN "uuid" TEXT`);
  }
  const pending = await driver.all<{ id: number }>(
    `SELECT "id" FROM "${table}" WHERE "uuid" IS NULL`,
  );
  for (const row of pending) {
    // eslint-disable-next-line no-await-in-loop
    await driver.run(
      `UPDATE "${table}" SET "uuid" = ${UUID_V4_SQL_EXPR} WHERE "id" = @id`,
      { id: row.id },
    );
  }
  await driver.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${table}_uuid" ON "${table}"("uuid")`,
  );
  await driver.exec(`
    CREATE TRIGGER IF NOT EXISTS "trg_${table}_uuid"
    AFTER INSERT ON "${table}"
    WHEN NEW."uuid" IS NULL
    BEGIN
      UPDATE "${table}" SET "uuid" = ${UUID_V4_SQL_EXPR}
      WHERE "id" = NEW."id";
    END;
  `);
}

async function addUuidOnVendorStock(driver: DatabaseDriver): Promise<void> {
  if (!(await tableExists(driver, 'vendor_stock'))) return;
  const cols = await columnNames(driver, 'vendor_stock');
  if (!cols.includes('uuid')) {
    await driver.exec(`ALTER TABLE "vendor_stock" ADD COLUMN "uuid" TEXT`);
  }
  const pending = await driver.all<{
    vendorAccountId: number;
    inventoryId: number;
  }>(
    `SELECT "vendorAccountId", "inventoryId" FROM "vendor_stock" WHERE "uuid" IS NULL`,
  );
  for (const row of pending) {
    // eslint-disable-next-line no-await-in-loop
    await driver.run(
      `UPDATE "vendor_stock" SET "uuid" = ${UUID_V4_SQL_EXPR}
       WHERE "vendorAccountId" = @vendorAccountId AND "inventoryId" = @inventoryId`,
      {
        vendorAccountId: row.vendorAccountId,
        inventoryId: row.inventoryId,
      },
    );
  }
  await driver.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_vendor_stock_uuid" ON "vendor_stock"("uuid")`,
  );
  await driver.exec(`
    CREATE TRIGGER IF NOT EXISTS "trg_vendor_stock_uuid"
    AFTER INSERT ON "vendor_stock"
    WHEN NEW."uuid" IS NULL
    BEGIN
      UPDATE "vendor_stock" SET "uuid" = ${UUID_V4_SQL_EXPR}
      WHERE "vendorAccountId" = NEW."vendorAccountId"
        AND "inventoryId" = NEW."inventoryId";
    END;
  `);
}

export const migration029 = {
  name: '029_add_uuid_to_business_tables',
  async up(driver: DatabaseDriver): Promise<void> {
    await driver.transaction(async () => {
      for (const table of ID_TABLES) {
        // eslint-disable-next-line no-await-in-loop
        await addUuidOnIdTable(driver, table);
      }
      await addUuidOnVendorStock(driver);
    });
  },
};
