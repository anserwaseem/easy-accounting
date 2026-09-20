import type { DatabaseDriver } from '../driver';

/** Lookup indexes for `ledger_view` / `inventory_quantity_view`. Additive. */
export const migration026 = {
  name: '026_index_journal_entry_and_ledger_lookup',
  async up(driver: DatabaseDriver): Promise<void> {
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_journal_entry_journalId ON journal_entry(journalId)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_journal_entry_accountId ON journal_entry(accountId)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_ledger_accountId_date ON ledger(accountId, date, id)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_invoice_items_inventoryId ON invoice_items(inventoryId)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_invoice_items_invoiceId ON invoice_items(invoiceId)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_stock_adjustments_inventoryId ON stock_adjustments(inventoryId)`,
    );
  },
};
