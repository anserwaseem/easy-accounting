// Performance prerequisite for docs/derived-state-design.md §4's ledger_view
// (and §5's inventory_quantity_view): none of these lookup columns are
// indexed today (see the design doc's §1.1), so every account/journal/
// inventory lookup the view relies on is a full scan. Purely additive —
// six `CREATE INDEX IF NOT EXISTS` statements, no table/column changes.
//
// `idx_ledger_accountId_date` is kept temporarily even though `ledger` is on
// its way out (design doc §6/029): the equivalence harness that gates the
// view cutover (§7) still queries the stored `ledger` table directly and
// needs this index to do so at any real scale. It is dropped alongside the
// table itself in migration 029.
module.exports = {
  name: '026_index_journal_entry_and_ledger_lookup',
  up: (db) => {
    try {
      db.transaction(() => {
        db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_journal_entry_journalId ON journal_entry(journalId);`,
        ).run();
        db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_journal_entry_accountId ON journal_entry(accountId);`,
        ).run();
        db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_ledger_accountId_date ON ledger(accountId, date, id);`,
        ).run();
        db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_invoice_items_inventoryId ON invoice_items(inventoryId);`,
        ).run();
        db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_invoice_items_invoiceId ON invoice_items(invoiceId);`,
        ).run();
        db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_stock_adjustments_inventoryId ON stock_adjustments(inventoryId);`,
        ).run();
      })();

      return true;
    } catch (error) {
      console.log('026 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('026 migration completed!');
    }
  },
};
