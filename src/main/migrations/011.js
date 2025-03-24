module.exports = {
  name: '011_add_unique_constraint_to_account_name_and_code_in_chart',
  up: (db) => {
    try {
      db.transaction(() => {
        db.prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS "unique_account_name_and_code_in_chart" ON "account" ("chartId", "name", "code");`,
        ).run();
      })();
      return true;
    } catch (error) {
      console.log('011 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('011 migration completed!');
    }
  },
};
