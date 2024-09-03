import type { Database } from 'better-sqlite3';
import type { Migration } from './index';

export const migration001: Migration = {
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
