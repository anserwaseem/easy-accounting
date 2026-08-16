module.exports = {
  name: '023_add_inventory_title',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        // What a customer should see this item called.
        //
        // `name` is the internal identifier: businesses routinely key inventory
        // by a code rather than a sentence, and that code is the item's identity
        // — it matches the folder holding its photographs, the SKU on the
        // storefront, the id in an ad feed, and what a customer quotes when
        // ordering. It is therefore immutable, and it is frequently not a name
        // at all.
        //
        // Without this column, anything that publishes has to invent a title
        // from the code plus whatever attributes happen to be set. That works
        // for items whose specification describes them, and fails completely for
        // items whose title is a particular work's own name, where no rule can
        // derive it from data.
        //
        // Nullable, and empty is the normal state: a publisher is free to leave
        // it unset and let a downstream consumer compose a title, which is what
        // most items want. It is here for the ones where only a person knows the
        // answer. Deliberately NOT a rename of `name`, which cannot move without
        // breaking identity in six places.
        if (!hasColumn('inventory', 'title')) {
          db.prepare(`ALTER TABLE "inventory" ADD COLUMN "title" TEXT`).run();
        }
      })();

      return true;
    } catch (error) {
      console.log('023 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('023 migration completed!');
    }
  },
};
