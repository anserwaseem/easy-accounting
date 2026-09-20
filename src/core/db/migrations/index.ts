import type { DatabaseDriver } from '../driver';
import { migration029 } from './029_add_uuid_to_business_tables';
import { migration030 } from './030_migrate_opening_balance_ledger_to_journal';
import { migration031 } from './031_index_journal_entry_and_ledger_lookup';
import { migration032 } from './032_create_ledger_and_inventory_quantity_views';
import { migration033 } from './033_create_settings_table';
import { migration034 } from './034_create_sync_tables';
import { migration035 } from './035_create_sync_apply_conflicts';
import { migration036 } from './036_replicate_blob_columns';
import { migration037 } from './037_redate_import_baselines';
import { migration038 } from './038_sync_settings';
import { migration039 } from './039_suppress_timestamp_triggers_during_apply';
import { migration040 } from './040_insert_timestamps_fill_only';

/**
 * Schema after origin/main's frozen `001.js`–`028.js`.
 *
 * Linear clock, one bookkeeping table (`migrations.name`):
 *
 * 1. Electron on main: `MigrationRunner` applies `001.js`–`028.js`, then
 *    `bootstrapDatabase` applies this array.
 * 2. Web / empty DB: snapshot of `001`–`028`, then this array.
 *
 * Do not add `src/main/migrations/*.js`. Append here, next unused `name`
 * (`041_…`), list it in `CORE_MIGRATION_NAMES`. Both platforms pick it up
 * via `bootstrapDatabase`.
 *
 * Desktop `024.js`–`028.js` and CORE `029_…`–`040_…` do not share prefixes.
 * Compare the full `name` string anyway — that is the identity.
 */
export interface CoreMigration {
  name: string;
  up(driver: DatabaseDriver): Promise<void>;
}

export const CORE_MIGRATIONS: CoreMigration[] = [
  migration029,
  migration030,
  migration031,
  migration032,
  migration033,
  migration034,
  migration035,
  migration036,
  migration037,
  migration038,
  migration039,
  migration040,
];
