module.exports = {
  name: '027_add_inventory_descriptionUrdu',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        // optional Urdu print description; empty falls back to English description.
        // English description stays the operational field for search/imports.
        if (!hasColumn('inventory', 'descriptionUrdu')) {
          db.prepare(
            `ALTER TABLE "inventory" ADD COLUMN "descriptionUrdu" TEXT`,
          ).run();
        }
      })();

      return true;
    } catch (error) {
      console.log('027 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('027 migration completed!');
    }
  },
};
