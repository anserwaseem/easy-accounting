module.exports = {
  name: '025_add_account_urdu_fields',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        // optional Urdu print fields for invoice/quotation RTL output.
        // empty is normal: print falls back to the English name/address/goodsName.
        // not a rename — English fields stay the operational identity for search,
        // ledgers, and existing documents.
        if (!hasColumn('account', 'nameUrdu')) {
          db.prepare(
            `ALTER TABLE "account" ADD COLUMN "nameUrdu" TEXT`,
          ).run();
        }
        if (!hasColumn('account', 'addressUrdu')) {
          db.prepare(
            `ALTER TABLE "account" ADD COLUMN "addressUrdu" TEXT`,
          ).run();
        }
        if (!hasColumn('account', 'goodsNameUrdu')) {
          db.prepare(
            `ALTER TABLE "account" ADD COLUMN "goodsNameUrdu" TEXT`,
          ).run();
        }
      })();

      return true;
    } catch (error) {
      console.log('025 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('025 migration completed!');
    }
  },
};
