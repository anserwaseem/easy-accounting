module.exports = {
  name: '012_add_isActive_to_account_table',
  up: (db) => {
    try {
      db.transaction(() => {
        db.prepare(
          `ALTER TABLE "account" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT 1;`,
        ).run();
      })();
      return true;
    } catch (error) {
      console.log('012 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('012 migration completed!');
    }
  },
};
