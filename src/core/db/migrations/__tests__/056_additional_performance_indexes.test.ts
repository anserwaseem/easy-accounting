import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { CORE_MIGRATIONS } from '../index';
import { migration056 } from '../056_additional_performance_indexes';

jest.mock('electron-log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  verbose: jest.fn(),
  debug: jest.fn(),
  silly: jest.fn(),
  transports: {
    file: { level: 'debug', getFile: jest.fn() },
    console: { level: 'debug' },
  },
}));

describe('migration 056 — additional performance indexes', () => {
  it('is registered in CORE_MIGRATIONS', () => {
    expect(
      CORE_MIGRATIONS.some(
        (m) => m.name === '056_additional_performance_indexes',
      ),
    ).toBe(true);
  });

  it('creates all indexes on bootstrapDatabase and is idempotent', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    const indexes = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    const expectedIndexes = [
      'idx_journal_invoiceId',
      'idx_invoice_items_sourceInvoiceItemId',
      'idx_invoices_sourceInvoiceId',
      'idx_invoices_type_number',
      'idx_invoices_returnedAt',
      'idx_invoice_items_accountId',
      'idx_invoice_items_invoice_account',
      'idx_account_chartId',
      'idx_chart_userId',
      'idx_chart_parentId',
      'idx_chart_type_parentId',
      'idx_journal_date_id',
      'idx_journal_entry_covering',
      'idx_journal_entry_account_credit',
      'idx_journal_entry_account_debit',
      'idx_stock_adjustments_inventory_date',
      'idx_vendor_issue_items_issueId',
      'idx_vendor_issue_items_inventoryId',
      'idx_vendor_stock_movements_inventoryId',
      'idx_commission_settlements_chart_date',
      'idx_commission_settlements_journalId',
      'idx_sync_outbox_tableName_rowUuid',
    ];

    for (const name of expectedIndexes) {
      expect(indexes).toContain(name);
    }

    // Idempotence test
    await expect(migration056.up(driver)).resolves.not.toThrow();
  });

  it('optimizes query execution plans', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    // 1. journal.invoiceId covering search in linked count
    const invoiceJournalPlan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT (SELECT COUNT(*) FROM journal j WHERE j.invoiceId = i.id) FROM invoices i`,
      )
      .all() as Array<{ detail: string }>;
    expect(
      invoiceJournalPlan.some((p) =>
        p.detail.includes('USING COVERING INDEX idx_journal_invoiceId'),
      ),
    ).toBe(true);

    // 2. invoiceType and invoiceNumber point lookup
    // 2. invoiceType leading search (e.g. MAX(invoiceNumber) or list by type)
    const invoiceLookupPlan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT MAX(invoiceNumber) FROM invoices WHERE invoiceType = 'Sale'`,
      )
      .all() as Array<{ detail: string }>;
    expect(
      invoiceLookupPlan.some((p) =>
        p.detail.includes('USING COVERING INDEX idx_invoices_type_number'),
      ),
    ).toBe(true);

    // 3. invoice_items.sourceInvoiceItemId search
    const returnLinesPlan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT SUM(quantity) FROM invoice_items WHERE sourceInvoiceItemId = 12`,
      )
      .all() as Array<{ detail: string }>;
    expect(
      returnLinesPlan.some((p) =>
        p.detail.includes('USING INDEX idx_invoice_items_sourceInvoiceItemId'),
      ),
    ).toBe(true);

    // 4. stock_adjustments history search without temp btree sort
    const stockHistoryPlan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM stock_adjustments WHERE inventoryId = 1 ORDER BY date DESC, id DESC`,
      )
      .all() as Array<{ detail: string }>;
    expect(
      stockHistoryPlan.some((p) =>
        p.detail.includes('USING INDEX idx_stock_adjustments_inventory_date'),
      ),
    ).toBe(true);
    expect(
      stockHistoryPlan.some((p) => p.detail.includes('USE TEMP B-TREE')),
    ).toBe(false);
  });
});
