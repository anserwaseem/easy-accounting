module.exports = {
  name: '019_add_inventory_listPosition',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        if (!hasColumn('inventory', 'listPosition')) {
          db.prepare(
            `ALTER TABLE "inventory" ADD COLUMN "listPosition" INTEGER;`,
          ).run();
        }
      })();

      return true;
    } catch (error) {
      console.log('019 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('019 migration completed!');
    }
  },
};
