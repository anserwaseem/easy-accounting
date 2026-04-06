module.exports = {
  name: '018_add_invoices_isQuotation',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        if (!hasColumn('invoices', 'isQuotation')) {
          db.prepare(
            `ALTER TABLE "invoices" ADD COLUMN "isQuotation" BOOLEAN NOT NULL DEFAULT 0;`,
          ).run();
        }
      })();

      return true;
    } catch (error) {
      console.log('018 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('018 migration completed!');
    }
  },
};
