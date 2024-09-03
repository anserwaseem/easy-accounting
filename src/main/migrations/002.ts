import type { Database } from 'better-sqlite3';
import type { Migration } from './index';

export const migration002: Migration = {
  name: '002_drop_table_todos',
  up: (db: Database) => {
    db.prepare(`DROP TABLE IF EXISTS todos`).run();
  },
};
