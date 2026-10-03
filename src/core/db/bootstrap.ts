import type { DatabaseDriver } from './driver';
import { SCHEMA_SNAPSHOT_SQL } from './schemaSnapshot';
import { CORE_MIGRATIONS } from './migrations';

/**
 * Brings a database up to the current schema, platform-free.
 *
 * - Empty DB (no `users` table): exec the frozen snapshot
 *   (`001.js`–`028.js` dumped). Snapshot seeds `migrations` with those
 *   names so Electron's `MigrationRunner` will not re-run them.
 * - Then apply every `CORE_MIGRATIONS` entry whose `name` is not yet in
 *   `migrations`. Electron calls this after `001.js`–`028.js`; web calls
 *   it on every worker boot.
 */
export async function bootstrapDatabase(driver: DatabaseDriver): Promise<void> {
  const usersTable = await driver.get(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'`,
  );

  if (!usersTable) {
    await driver.exec(SCHEMA_SNAPSHOT_SQL);
  }

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

  // Match origin/main after 008.js: constraints exist, enforcement is off.
  // Desktop JS 001 turns them on then 008 turns them off; web never runs
  // those files, so pin the same runtime here.
  await driver.exec('PRAGMA foreign_keys = OFF');
}
