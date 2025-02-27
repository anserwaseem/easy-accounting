module.exports = {
  name: '009_add_biltyNumber_cartons_in_invoices_table',
  up: (db) => {
    try {
      db.transaction(() => {
        db.prepare(
          `ALTER TABLE "invoices" ADD COLUMN "biltyNumber" INTEGER;`,
        ).run();
        db.prepare(
          `ALTER TABLE "invoices" ADD COLUMN "cartons" INTEGER;`,
        ).run();
      })();
      return true;
    } catch (error) {
      console.log('009 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('009 migration completed!');
    }
  },
};
