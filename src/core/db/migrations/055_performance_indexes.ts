import type { DatabaseDriver } from '../driver';

/**
 * Migration 055 — Indexes for the hottest report/list scans.
 *
 * The app grew ~40 heavy date-filtered report queries (invoices by
 * type/date, journals by date, invoices by account/date) whose base tables
 * had no supporting composite index, so SQLite walked the whole table each
 * time. Newer accounts (100k+ rows of invoices) turned that into the
 * full-table scan clients reported as "very slow". Idempotent via
 * `IF NOT EXISTS`.
 */
export const migration055 = {
  name: '055_performance_indexes',
  async up(driver: DatabaseDriver): Promise<void> {
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_invoices_type_date
         ON invoices (invoiceType, isQuotation, isReturned, date)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_invoices_account_date
         ON invoices (accountId, date)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_invoices_date
         ON invoices (date)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_journal_date ON journal (date)`,
    );
  },
};
