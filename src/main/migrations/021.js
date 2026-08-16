module.exports = {
  name: '021_add_attribute_isPublic',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        // Whether an attribute may leave the building.
        //
        // Attributes are published verbatim into the public catalog, so any key
        // a business defines for its own bookkeeping — import flags, internal
        // notes, sourcing codes — would otherwise become world-readable the
        // moment the catalog is published. Publishing is therefore opt-in, for
        // existing rows as much as new ones: every attribute starts private and
        // is named public in the UI, deliberately, one at a time.
        if (!hasColumn('attribute_definitions', 'isPublic')) {
          db.prepare(
            `ALTER TABLE "attribute_definitions"
               ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT 0`,
          ).run();
        }
      })();

      return true;
    } catch (error) {
      console.log('021 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('021 migration completed!');
    }
  },
};
