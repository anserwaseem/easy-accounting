import type { DatabaseDriver } from '../driver';
import { migration024 } from './024_add_uuid_to_business_tables';
import { migration025 } from './025_migrate_opening_balance_ledger_to_journal';
import { migration026 } from './026_index_journal_entry_and_ledger_lookup';
import { migration027 } from './027_create_ledger_and_inventory_quantity_views';
import { migration029 } from './029_create_sync_tables';
import { migration030 } from './030_create_sync_apply_conflicts';
import { migration031 } from './031_replicate_blob_columns';
import { migration032 } from './032_redate_import_baselines';
import { migration033 } from './033_sync_settings';
import { migration034 } from './034_suppress_timestamp_triggers_during_apply';
import { migration035 } from './035_insert_timestamps_fill_only';

/**
 * Platform-free schema after origin/main's released `001.js`–`028.js`.
 *
 * Two runners, one bookkeeping table (`migrations.name` is the identity):
 *
 * 1. Electron already on main: `MigrationRunner` applies `001.js`–`028.js`
 *    (filename order). Then `bootstrapDatabase` applies this array.
 * 2. Web / empty DB: frozen snapshot of `001`–`028`, then this array.
 *
 * Do not add another `src/main/migrations/*.js` file. Append here, give it
 * the next unused `name` (`036_…` onward), and list that name in
 * `knownMigrations.ts`. Both platforms pick it up via `bootstrapDatabase`.
 *
 * Names `024_add_uuid…`–`035_insert_timestamps…` predate this cleanup
 * (they used to live in `029.js`–`040.js` twins). Keep them so databases
 * that already recorded those strings skip. Prefixes collide with main's
 * `024_normalize…` / `027_add_chart_nameUrdu` / `028_add_isActive…` —
 * compare the full string, never the leading digits.
 */
export interface CoreMigration {
  name: string;
  up(driver: DatabaseDriver): Promise<void>;
}

export const CORE_MIGRATIONS: CoreMigration[] = [
  migration024,
  migration025,
  migration026,
  migration027,
  {
    name: '028_create_settings_table',
    async up(driver) {
      await driver.exec(
        `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updatedAt DATETIME)`,
      );
    },
  },
  migration029,
  migration030,
  migration031,
  migration032,
  migration033,
  migration034,
  migration035,
];
