module.exports = {
  name: '004_add_discount_in_invoice_items_table',
  up: (db) => {
    try {
      db.transaction(() => {
        // Step 1: add new column discount
        db.prepare(
          `ALTER TABLE invoice_items ADD COLUMN discount DECIMAL(10, 2) NOT NULL DEFAULT 0;`,
        ).run();
      })();
      return true;
    } catch (error) {
      console.log('004 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('004 migration completed!');
    }
  },
};
