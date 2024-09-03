import type { Database } from 'better-sqlite3';
import type { Migration } from './index';

export const migration003: Migration = {
  name: '003_drop_table_schema_migrations',
  up: (db: Database) => {
    db.prepare(`DROP TABLE IF EXISTS schema_migrations`).run();
  },
};
