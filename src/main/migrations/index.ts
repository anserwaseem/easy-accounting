import type { Database } from 'better-sqlite3';
import { connect } from '../services/Database.service';
import { migration001 } from './001';

export async function runMigrations() {
  const db = connect();

  // Ensure the schema_migrations table exists
  db.prepare(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY
      )`,
  ).run();

  // List of migrations
  const migrations: Array<{
    name: string;
    up: (dbInstance: Database) => void;
  }> = [migration001];

  for (const migration of migrations) {
    const { name, up } = migration;
    const applied = db
      .prepare('SELECT * FROM schema_migrations WHERE name = ?')
      .get(name);

    console.log(`migration ${name}`, applied);
    if (!applied) {
      console.log(`Applying migration: ${name}`);
      try {
        up(db);
      } catch (err) {
        console.error(err);
      }
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
    }
  }
}
