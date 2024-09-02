import type { Database } from 'better-sqlite3';

export const migration001 = {
  name: '001_add_new_table_todos',
  up: (db: Database) => {
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
