module.exports = {
  name: '003_add_invoice_items_triggers',
  up: (db) => {
    try {
      db.transaction(() => {
        // Step 1: add new column
        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_invoice_items_add_timestamp
            AFTER INSERT ON invoice_items
            BEGIN
              UPDATE invoice_items SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        // Step 2: create new after_update_invoice_items_add_timestamp trigger
        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_invoice_items_add_timestamp
            AFTER UPDATE ON invoice_items
            BEGIN
              UPDATE invoice_items SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();
      })();
      return true;
    } catch (error) {
      console.log('003 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('003 migration completed!');
    }
  },
};
