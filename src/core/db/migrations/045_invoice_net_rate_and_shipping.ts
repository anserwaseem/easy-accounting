import type { DatabaseDriver } from '../driver';

/**
 * sale lines store a typed unit in `netPrice`. null means the profile percent applies.
 * a bill can add one flat shipping amount, posted onto one account
 * the same way extra discount is subtracted.
 */
export const migration045 = {
  name: '045_invoice_net_rate_and_shipping',
  async up(driver: DatabaseDriver): Promise<void> {
    await driver.exec(
      `ALTER TABLE invoices ADD COLUMN shippingCharges DECIMAL(10, 2) NOT NULL DEFAULT 0`,
    );
    await driver.exec(
      `ALTER TABLE invoices ADD COLUMN shippingAccountId INTEGER REFERENCES account(id)`,
    );
    await driver.exec(
      `ALTER TABLE invoice_items ADD COLUMN netPrice DECIMAL(10, 2)`,
    );
  },
};
