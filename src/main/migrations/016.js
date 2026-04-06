module.exports = {
  name: '016_add_journal_invoiceId_and_invoice_extraDiscountAccountId',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        if (!hasColumn('journal', 'invoiceId')) {
          db.prepare(
            `ALTER TABLE "journal" ADD COLUMN "invoiceId" INTEGER REFERENCES "invoices"("id");`,
          ).run();
        }

        if (!hasColumn('invoices', 'extraDiscountAccountId')) {
          db.prepare(
            `ALTER TABLE "invoices" ADD COLUMN "extraDiscountAccountId" INTEGER REFERENCES "account"("id");`,
          ).run();
        }

        db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_journal_invoiceId ON journal(invoiceId);`,
        ).run();

        // best-effort backfill for dev DBs: link journals using billNumber + narration invoice type
        db.prepare(
          `
          UPDATE journal
          SET invoiceId = (
            SELECT i.id FROM invoices i
            WHERE i.invoiceNumber = journal.billNumber
              AND (
                (journal.narration LIKE 'Sale Invoice%' AND i.invoiceType = 'Sale')
                OR (journal.narration LIKE 'Purchase Invoice%' AND i.invoiceType = 'Purchase')
              )
            LIMIT 1
          )
          WHERE invoiceId IS NULL AND billNumber IS NOT NULL
        `,
        ).run();
      })();

      return true;
    } catch (error) {
      console.log('016 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('016 migration completed!');
    }
  },
};
