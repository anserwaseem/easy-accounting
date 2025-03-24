module.exports = {
  name: '006_add_parentId_in_chart_table',
  up: (db) => {
    try {
      db.transaction(() => {
        db.prepare(
          `ALTER TABLE "chart" ADD COLUMN "parentId" INTEGER REFERENCES "chart"("id");`,
        ).run();
      })();
      return true;
    } catch (error) {
      console.log('006 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('006 migration completed!');
    }
  },
};
