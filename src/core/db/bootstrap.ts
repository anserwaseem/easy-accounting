import type { DatabaseDriver } from './driver';
import { SCHEMA_SNAPSHOT_SQL } from './schemaSnapshot';
import { CORE_MIGRATIONS } from './migrations';

/**
 * Brings a database up to the current schema, platform-free.
 *
 * - If the database is empty (no `users` table), it is created from the
 *   frozen schema snapshot (src/core/db/schemaSnapshot.ts) — the equivalent
 *   of running the frozen base schema.sql plus migrations 001-030, without
 *   needing better-sqlite3's synchronous API. The snapshot also seeds the
 *   `migrations` bookkeeping table with those names, so the desktop
 *   MigrationRunner (which still runs against every Electron database) sees
 *   them as already applied and does not try to re-run them.
 * - Either way (freshly bootstrapped or a pre-existing database), any
 *   platform-free migrations registered in src/core/db/migrations (028+)
 *   that have not already run are applied in order.
 *
 * Safe to call on every startup: bootstrapping an already-bootstrapped
 * database is a no-op.
 */
export async function bootstrapDatabase(driver: DatabaseDriver): Promise<void> {
  const usersTable = await driver.get(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'`,
  );

  if (!usersTable) {
    await driver.exec(SCHEMA_SNAPSHOT_SQL);
  }

  // Defensive: guarantee the bookkeeping table exists even if this is an
  // old, pre-migrations-table database that predates both the snapshot and
  // the desktop MigrationRunner ever running against it.
  await driver.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'localtime'))
    )`,
  );

  for (const migration of CORE_MIGRATIONS) {
    // eslint-disable-next-line no-await-in-loop
    const applied = await driver.get(
      `SELECT 1 FROM migrations WHERE name = @name`,
      { name: migration.name },
    );
    if (!applied) {
      // eslint-disable-next-line no-await-in-loop
      await migration.up(driver);
      // eslint-disable-next-line no-await-in-loop
      await driver.run(`INSERT INTO migrations (name) VALUES (@name)`, {
        name: migration.name,
      });
    }
  }
}
