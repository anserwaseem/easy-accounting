import type { DatabaseDriver } from '../driver';

/**
 * Migration 056 — Comprehensive SQL optimization indexes discovered by
 * applying `/sql-optimization-patterns`.
 *
 * Covers:
 * 1. Correlated subqueries and foreign keys:
 *    - `journal (invoiceId)`: turns the correlated count in `getInvoices` /
 *      `getQuotationInvoices` from an O(N*M) full table scan into an index-only lookup.
 *    - `invoice_items (sourceInvoiceItemId)`: turns the return-qty check in
 *      `getInvoiceItemsForUpdate` from an O(lines * items) full scan into a seek.
 *    - `invoices (sourceInvoiceId)`: return link navigation and joins.
 *    - `account (chartId)`: foreign key linking accounts to chart heads.
 *    - `chart (userId)` & `chart (parentId)` & `chart (type, parentId)`: user scoping
 *      and custom head resolution in ChartService/AccountService/receipt accounts CTE.
 * 2. Range & ordering optimization:
 *    - `journal (date DESC, id DESC)`: avoids temp B-tree sort in `getJournals`.
 *    - `invoices (invoiceType, invoiceNumber)`: fast B-tree lookup for next/prev
 *      invoice number, validation, and max invoice number.
 *    - `invoices (returnedAt)`: partial index for return date-range analytics.
 *    - `stock_adjustments (inventoryId, date DESC, id DESC)`: fast history query without temp B-tree.
 * 3. View & CTE execution:
 *    - `journal_entry (journalId, debitAmount, creditAmount, accountId)`: covering index
 *      for `journal_entry_pairs` view and CTEs.
 *    - `journal_entry (accountId, creditAmount, journalId)`: speeds up `receipt_credits` CTE.
 * 4. Subsystem foreign keys:
 *    - `vendor_issue_items (issueId, quantity)` and `vendor_issue_items (inventoryId)`.
 *    - `vendor_stock_movements (inventoryId)`.
 *    - `agent_commission_settlements (chartId, startDate)` & `(journalId)`.
 *    - `sync_outbox (tableName, rowUuid)`.
 */
export const migration056 = {
  name: '056_additional_performance_indexes',
  async up(driver: DatabaseDriver): Promise<void> {
    // 1. Journal and invoice linking
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_journal_invoiceId
         ON journal (invoiceId)
         WHERE invoiceId IS NOT NULL`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_invoice_items_sourceInvoiceItemId
         ON invoice_items (sourceInvoiceItemId)
         WHERE sourceInvoiceItemId IS NOT NULL`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_invoices_sourceInvoiceId
         ON invoices (sourceInvoiceId)
         WHERE sourceInvoiceId IS NOT NULL`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_invoices_type_number
         ON invoices (invoiceType, invoiceNumber)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_invoices_returnedAt
         ON invoices (returnedAt)
         WHERE isReturned = 1`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_invoice_items_accountId
         ON invoice_items (accountId)`,
    );

    // 2. Account and chart indexing
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_account_chartId
         ON account (chartId)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_chart_userId
         ON chart (userId)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_chart_parentId
         ON chart (parentId)
         WHERE parentId IS NOT NULL`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_chart_type_parentId
         ON chart (type, parentId)`,
    );

    // 3. Journal query and view coverage
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_journal_date_id
         ON journal (date DESC, id DESC)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_journal_entry_covering
         ON journal_entry (journalId, debitAmount, creditAmount, accountId)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_journal_entry_account_credit
         ON journal_entry (accountId, creditAmount, journalId)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_journal_entry_account_debit
         ON journal_entry (accountId, debitAmount, journalId)`,
    );

    // 4. Stock adjustments history
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_stock_adjustments_inventory_date
         ON stock_adjustments (inventoryId, date DESC, id DESC)`,
    );

    // 5. Vendor stock and issues
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_vendor_issue_items_issueId
         ON vendor_issue_items (issueId, quantity)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_vendor_issue_items_inventoryId
         ON vendor_issue_items (inventoryId)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_vendor_stock_movements_inventoryId
         ON vendor_stock_movements (inventoryId)`,
    );

    // 6. Agent commissions settlements
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_commission_settlements_chart_date
         ON agent_commission_settlements (chartId, startDate)`,
    );
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_commission_settlements_journalId
         ON agent_commission_settlements (journalId)
         WHERE journalId IS NOT NULL`,
    );

    // 7. Sync outbox lookups
    await driver.exec(
      `CREATE INDEX IF NOT EXISTS idx_sync_outbox_tableName_rowUuid
         ON sync_outbox (tableName, rowUuid)`,
    );
  },
};
