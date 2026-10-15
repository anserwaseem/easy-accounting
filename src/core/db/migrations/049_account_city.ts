import type { DatabaseDriver } from '../driver';
import { createCaptureTriggers } from './034_create_sync_tables';
import { scheduleTableRepull } from '../../sync/tableRepull';

export const migration049 = {
  name: '049_account_city',
  async up(driver: DatabaseDriver): Promise<void> {
    await driver.exec(`
      ALTER TABLE account ADD COLUMN city TEXT;
      ALTER TABLE account ADD COLUMN cityUrdu TEXT;
    `);

    // Rebuild sync capture triggers to include city and cityUrdu
    await driver.exec(`
      DROP TRIGGER IF EXISTS "trg_sync_capture_account_insert";
      DROP TRIGGER IF EXISTS "trg_sync_capture_account_update";
      DROP TRIGGER IF EXISTS "trg_sync_capture_account_delete";
    `);
    await createCaptureTriggers(driver, 'account');

    // Queue a repull of account rows so upgrading peers receive city fields
    // without resetting the main sync cursor
    await scheduleTableRepull(driver, ['account']);
  },
};
