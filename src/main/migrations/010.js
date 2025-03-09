module.exports = {
  name: '010_add_account_id_to_invoice_items_table',
  up: (db) => {
    try {
      db.transaction(() => {
        db.prepare(
          `ALTER TABLE "invoice_items" ADD COLUMN "accountId" INTEGER DEFAULT NULL REFERENCES "account"("id");`,
        ).run();
      })();
      return true;
    } catch (error) {
      console.log('010 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('010 migration completed!');
    }
  },
};
