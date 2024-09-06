export default {
  name: '005_drop_table_todos',
  up: (db) => {
    db.prepare(`DROP TABLE IF EXISTS todos`).run();
  },
};
