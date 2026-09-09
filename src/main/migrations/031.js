// Migration 028 — creates the `settings` table business settings move into
// (company profile, invoice print settings, and a handful of non-secret
// publish-catalog fields today; more will follow as Phase 2 continues). See
// src/core/services/SettingsService.ts for the reader/writer and
// src/core/db/migrations/index.ts for the platform-free twin of this exact
// migration ('028_create_settings_table') — that file's doc comment explains
// in full why this schema change is written twice (once here, sync against
// better-sqlite3, for existing desktop installs; once there, async against
// DatabaseDriver, for the web build and any fresh bootstrap) and why the DDL
// below must stay word-for-word identical to the one there.
module.exports = {
  name: '028_create_settings_table',
  up: (db) => {
    try {
      db.prepare(
        `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updatedAt DATETIME)`,
      ).run();
      return true;
    } catch (error) {
      return error;
    }
  },
};
