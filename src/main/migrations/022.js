module.exports = {
  name: '022_add_inventory_excludeFromCatalog',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        // An explicit "do not publish this item" override.
        //
        // Publishability is otherwise derived — an item is published when it has
        // a public price, a public attribute and an image — which leaves no way
        // to hold something back that happens to meet all three. Trade-only
        // lines, a batch withdrawn over a defect, or an item photographed before
        // it is ready to sell all need one, and the alternative is to sabotage
        // the data (delete the price, pull the image) to achieve a publishing
        // decision.
        //
        // Defaults to 0, i.e. included. Unlike attribute_definitions.isPublic,
        // this is opt-out rather than opt-in: the three derived conditions
        // already stop anything being published by accident, so a second opt-in
        // would be friction that buys no safety. The negative name is
        // deliberate — this is an exception, not a symmetric flag.
        if (!hasColumn('inventory', 'excludeFromCatalog')) {
          db.prepare(
            `ALTER TABLE "inventory"
               ADD COLUMN "excludeFromCatalog" BOOLEAN NOT NULL DEFAULT 0`,
          ).run();
        }
      })();

      return true;
    } catch (error) {
      console.log('022 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('022 migration completed!');
    }
  },
};
