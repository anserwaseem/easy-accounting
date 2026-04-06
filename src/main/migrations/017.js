module.exports = {
  name: '017_add_invoice_return_fields',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        if (!hasColumn('invoices', 'isReturned')) {
          db.prepare(
            `ALTER TABLE "invoices" ADD COLUMN "isReturned" BOOLEAN NOT NULL DEFAULT 0;`,
          ).run();
        }
        if (!hasColumn('invoices', 'returnedAt')) {
          db.prepare(
            `ALTER TABLE "invoices" ADD COLUMN "returnedAt" DATETIME;`,
          ).run();
        }
        if (!hasColumn('invoices', 'returnReason')) {
          db.prepare(
            `ALTER TABLE "invoices" ADD COLUMN "returnReason" TEXT;`,
          ).run();
        }
      })();

      return true;
    } catch (error) {
      console.log('017 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('017 migration completed!');
    }
  },
};
