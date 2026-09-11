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
  name: '037_add_chart_nameUrdu',
  async up(driver: DatabaseDriver): Promise<void> {
    const cols = await columnNames(driver, 'chart');
    if (!cols.includes('nameUrdu')) {
      await driver.exec(`ALTER TABLE "chart" ADD COLUMN "nameUrdu" TEXT`);
    }
  },
};
