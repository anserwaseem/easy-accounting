import type { DatabaseDriver } from '../driver';

/** unit net charged on a typed line. `price` stays the full price; the amount is qty × netPrice. */
export const migration046 = {
  name: '046_invoice_item_net_price',
  async up(driver: DatabaseDriver): Promise<void> {
    await driver.exec(
      `ALTER TABLE invoice_items ADD COLUMN netPrice DECIMAL(10, 2)`,
    );
  },
};
