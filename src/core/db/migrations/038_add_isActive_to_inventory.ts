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
 * inventory.isActive (mirroring account.isActive). desktop twin is
 * src/main/migrations/040.js, recorded as 028_add_isActive_to_inventory so
 * installs that already ran #174 skip it. this core name is sequential
 * (038) because web never had that desktop 028 name — same split as
 * 037_add_chart_nameUrdu vs desktop 039/027_add_chart_nameUrdu.
 *
 * inactive items cannot be added to new invoices or vendor issues, but
 * existing invoices and historical reports continue to resolve them.
 */
export const migration038 = {
  name: '038_add_isActive_to_inventory',
  async up(driver: DatabaseDriver): Promise<void> {
    const cols = await columnNames(driver, 'inventory');
    if (!cols.includes('isActive')) {
      await driver.exec(
        `ALTER TABLE "inventory" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT 1`,
      );
    }
  },
};
