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

export const migration037 = {
  // same recorded name as src/main/migrations/027.js (released on main).
  // web snapshot 001-032 already has this row; bootstrap skips it. kept
  // here so an OPFS db from the old 001-030 snapshot still picks it up.
  name: '027_add_chart_nameUrdu',
  async up(driver: DatabaseDriver): Promise<void> {
    const cols = await columnNames(driver, 'chart');
    if (!cols.includes('nameUrdu')) {
      await driver.exec(`ALTER TABLE "chart" ADD COLUMN "nameUrdu" TEXT`);
    }
  },
};
