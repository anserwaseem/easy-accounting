module.exports = {
  name: '028_add_isActive_to_inventory',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        // active flag for inventory items (mirroring account.isActive).
        //
        // inactive items cannot be added to new invoices or vendor issues,
        // but existing invoices and historical reports continue to resolve them.
        // defaults to 1 (active).
        if (!hasColumn('inventory', 'isActive')) {
          db.prepare(
            `ALTER TABLE "inventory"
               ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT 1`,
          ).run();
        }
      })();

      return true;
    } catch (error) {
      console.log('028 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('028 migration completed!');
    }
  },
};
