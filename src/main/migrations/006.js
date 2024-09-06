export default {
  name: '006_create_table_todos',
  up: (db) => {
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task TEXT NOT NULL
      );
      `,
    ).run();
  },
};
