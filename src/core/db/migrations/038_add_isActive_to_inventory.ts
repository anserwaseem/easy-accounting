import type { DatabaseDriver } from '../driver';

async function columnNames(
  driver: DatabaseDriver,
  table: string,
): Promise<string[]> {
  const rows = await driver.all<{ name: string }>(
    `PRAGMA table_info("${table}")`,
  );
  return rows.map((r) => r.name);
}

/**
 * inventory.isActive (mirroring account.isActive). same recorded name as
 * src/main/migrations/028.js so Electron DBs that already ran #174 skip it
 * and web/desktop share one identity. inactive items cannot be added to
 * new invoices or vendor issues, but existing invoices and historical
 * reports continue to resolve them.
 */
export const migration038 = {
  name: '028_add_isActive_to_inventory',
  async up(driver: DatabaseDriver): Promise<void> {
    const cols = await columnNames(driver, 'inventory');
    if (!cols.includes('isActive')) {
      await driver.exec(
        `ALTER TABLE "inventory" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT 1`,
      );
    }
  },
};
