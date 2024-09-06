export default {
  name: '001_add_new_table_todos',
  up: (db) => {
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
    `,
    ).run();
  },
};
