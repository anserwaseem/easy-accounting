import type { DatabaseDriver } from '../driver';

/**
 * Key/value business settings (company profile, invoice print, publish
 * non-secrets). `038_sync_settings` later adds id/uuid and capture triggers.
 */
export const migration033 = {
  name: '033_create_settings_table',
  async up(driver: DatabaseDriver): Promise<void> {
    await driver.exec(
      `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updatedAt DATETIME)`,
    );
  },
};
