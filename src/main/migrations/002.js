module.exports = {
  name: '002_drop_table_todos',
  up: (db) => {
    db.prepare(`DROP TABLE IF EXISTS todos`).run();
  },
};
