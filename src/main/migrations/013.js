module.exports = {
  name: '013_add_billNumber_and_discountPercentage_to_journal_table',
  up: (db) => {
    try {
      db.transaction(() => {
        db.prepare(
          `ALTER TABLE "journal" ADD COLUMN "billNumber" INTEGER;`,
        ).run();
        db.prepare(
          `ALTER TABLE "journal" ADD COLUMN "discountPercentage" DECIMAL(5, 2);`,
        ).run();
      })();
      return true;
    } catch (error) {
      console.log('013 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('013 migration completed!');
    }
  },
};
