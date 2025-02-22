module.exports = {
  name: '005_add_extra_discount_in_invoice_table',
  up: (db) => {
    try {
      db.transaction(() => {
        db.prepare(
          `ALTER TABLE invoices ADD COLUMN extraDiscount DECIMAL(10, 4) NOT NULL DEFAULT 0;`,
        ).run();
      })();
      return true;
    } catch (error) {
      console.log('005 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('005 migration completed!');
    }
  },
};
