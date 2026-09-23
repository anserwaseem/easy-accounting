import type { DatabaseDriver } from '../driver';

/**
 * `ledger_view` / `inventory_quantity_view`. Additive. SQL locked by
 * derivedStateEquivalence.test.ts.
 */
export const migration032 = {
  name: '032_create_ledger_and_inventory_quantity_views',
  async up(driver: DatabaseDriver): Promise<void> {
    await driver.exec(`
      CREATE VIEW IF NOT EXISTS journal_entry_pairs AS
      SELECT
        j.id AS journalId,
        j.date AS date,
        j.narration AS narration,
        d.id AS debitEntryId,
        d.accountId AS debitAccountId,
        d.debitAmount AS debitAmount,
        c.id AS creditEntryId,
        c.accountId AS creditAccountId,
        c.creditAmount AS creditAmount,
        (SELECT SUM(je.debitAmount) FROM journal_entry je WHERE je.journalId = j.id) AS totalDebits,
        (SELECT SUM(je.creditAmount) FROM journal_entry je WHERE je.journalId = j.id) AS totalCredits
      FROM journal j
      JOIN journal_entry d ON d.journalId = j.id AND d.debitAmount > 0
      JOIN journal_entry c ON c.journalId = j.id AND c.creditAmount > 0
    `);

    await driver.exec(`
      CREATE VIEW IF NOT EXISTS ledger_lines AS
      SELECT
        debitAccountId AS accountId,
        date,
        creditAccountId AS linkedAccountId,
        (debitAmount * creditAmount) / totalCredits AS debit,
        0 AS credit,
        CASE WHEN narration = 'Opening Balance from B/S' THEN narration
             ELSE 'Journal #' || journalId END AS particulars,
        journalId,
        debitEntryId AS ownEntryId,
        creditEntryId AS counterEntryId
      FROM journal_entry_pairs
      UNION ALL
      SELECT
        creditAccountId AS accountId,
        date,
        debitAccountId AS linkedAccountId,
        0 AS debit,
        (creditAmount * debitAmount) / totalDebits AS credit,
        CASE WHEN narration = 'Opening Balance from B/S' THEN narration
             ELSE 'Journal #' || journalId END AS particulars,
        journalId,
        creditEntryId AS ownEntryId,
        debitEntryId AS counterEntryId
      FROM journal_entry_pairs
    `);

    await driver.exec(`
      CREATE VIEW IF NOT EXISTS ledger_view AS
      SELECT
        ll.accountId,
        ll.date,
        ll.particulars,
        ll.debit,
        ll.credit,
        ll.linkedAccountId,
        ll.journalId,
        ll.ownEntryId,
        ll.counterEntryId,
        ABS(SUM(
          CASE WHEN ct.type IN ('Asset', 'Expense') THEN ll.debit - ll.credit
               ELSE ll.credit - ll.debit END
        ) OVER (
          PARTITION BY ll.accountId
          ORDER BY datetime(ll.date, 'localtime'), ll.ownEntryId, ll.counterEntryId
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )) AS balance,
        CASE WHEN (
          SUM(
            CASE WHEN ct.type IN ('Asset', 'Expense') THEN ll.debit - ll.credit
                 ELSE ll.credit - ll.debit END
          ) OVER (
            PARTITION BY ll.accountId
            ORDER BY datetime(ll.date, 'localtime'), ll.ownEntryId, ll.counterEntryId
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          )
        ) >= 0
          THEN CASE WHEN ct.type IN ('Asset', 'Expense') THEN 'Dr' ELSE 'Cr' END
          ELSE CASE WHEN ct.type IN ('Asset', 'Expense') THEN 'Cr' ELSE 'Dr' END
        END AS balanceType
      FROM ledger_lines ll
      JOIN account a ON a.id = ll.accountId
      JOIN chart ct ON ct.id = a.chartId
    `);

    await driver.exec(`
      CREATE VIEW IF NOT EXISTS inventory_quantity_view AS
      SELECT
        i.id AS inventoryId,
        COALESCE(os.quantity, 0)
        + COALESCE((
            SELECT SUM(
              CASE
                WHEN COALESCE(inv.isQuotation, 0) != 0 THEN 0
                WHEN inv.invoiceType = 'Sale' THEN
                  CASE WHEN COALESCE(inv.isReturned, 0) = 0 THEN -ii.quantity ELSE 0 END
                WHEN inv.invoiceType = 'Purchase' THEN
                  CASE WHEN COALESCE(inv.isReturned, 0) = 0 THEN ii.quantity ELSE 0 END
                ELSE 0
              END
            )
            FROM invoice_items ii
            JOIN invoices inv ON inv.id = ii.invoiceId
            WHERE ii.inventoryId = i.id
          ), 0)
        + COALESCE((
            SELECT SUM(sa.quantityDelta)
            FROM stock_adjustments sa
            WHERE sa.inventoryId = i.id
          ), 0) AS quantity
      FROM inventory i
      LEFT JOIN inventory_opening_stock os ON os.inventoryId = i.id
    `);
  },
};
