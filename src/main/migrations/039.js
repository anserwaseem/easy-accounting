module.exports = {
  name: '027_add_chart_nameUrdu',
  up: (db) => {
    try {
      const columns = db.prepare(`PRAGMA table_info("chart")`).all();
      const hasNameUrdu = columns.some((column) => column.name === 'nameUrdu');

      if (!hasNameUrdu) {
        // optional Urdu print name for custom heads (agent names on invoices).
        // empty falls back to English chart.name.
        db.prepare(`ALTER TABLE "chart" ADD COLUMN "nameUrdu" TEXT`).run();
      }

      return true;
    } catch (error) {
      console.log('039 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('039 migration completed!');
    }
  },
};
