import type { DatabaseDriver } from '../driver';
import { migration029 } from './029_create_sync_tables';
import { migration030 } from './030_create_sync_apply_conflicts';
import { migration031 } from './031_replicate_blob_columns';
import { migration032 } from './032_redate_import_baselines';
import { migration033 } from './033_sync_settings';
import { migration034 } from './034_suppress_timestamp_triggers_during_apply';
import { migration035 } from './035_insert_timestamps_fill_only';

/**
 * Platform-free migration for schemas already bootstrapped from
 * src/core/db/schemaSnapshot.ts (see src/core/db/bootstrap.ts).
 *
 * The 27 historical migrations (src/main/migrations/001.js..027.js) used
 * better-sqlite3's synchronous API directly and are frozen forever into the
 * schema snapshot — they will never run again and nothing new is ever added
 * there. Starting at 028, all schema changes are written here instead:
 * async, against the platform-free `DatabaseDriver`, so the same migration
 * runs unchanged on desktop (better-sqlite3) and web (SQLite-wasm).
 *
 * To add a migration:
 *   1. Give it the next number, e.g. `028_add_something.ts` in this
 *      directory (or inline below, for very small ones — either is fine,
 *      there is no dynamic file loading here since core cannot use `fs`).
 *   2. Export a `{ name, up }` pair matching {@link CoreMigration} and
 *      append it to `CORE_MIGRATIONS`, in order.
 *   3. `up` must only use `driver` (no direct better-sqlite3 / node APIs).
 *
 * bootstrapDatabase() applies these in array order, skipping any whose
 * `name` already has a row in the `migrations` table, and records each one
 * it runs the same way — so this array is safe to append to indefinitely.
 */
export interface CoreMigration {
  name: string;
  up(driver: DatabaseDriver): Promise<void>;
}

/**
 * Migration 028 — business settings move off device-local storage
 * (electron-store on desktop, localStorage/web_kv on web) and into the
 * database itself, so they ride multi-device sync later and ship in
 * backups/exports today. See src/core/services/SettingsService.ts.
 *
 * `value` is JSON-encoded (so the column can hold a string, number, boolean,
 * or object uniformly) and `updatedAt` is set by SettingsService on write,
 * not by a SQL default, since the driver interface has no portable "now"
 * expression guaranteed identical across better-sqlite3 and SQLite-wasm.
 *
 * IMPORTANT — kept in sync by hand with src/main/migrations/028.js:
 * this is the one core migration with a desktop-side twin. Every other
 * migration in this array reaches desktop databases for free, because
 * bootstrapDatabase() (which applies CORE_MIGRATIONS) runs for the web
 * build and any fresh database bootstrapped from the frozen schema
 * snapshot — but the *existing* Electron install path still runs schema
 * changes exclusively through the old synchronous MigrationRunner
 * (src/main/migrations/*.js, see that directory's own doc comment), which
 * never calls bootstrapDatabase or looks at this array. Until desktop
 * switches over, a schema change meant to land on every platform has to be
 * expressed twice: once here (async, DatabaseDriver, for web + fresh
 * bootstraps) and once as a plain src/main/migrations/NNN.js file (sync,
 * better-sqlite3, for existing desktop installs). Both migrations share the
 * exact same `name` — '028_create_settings_table' — so they share one row
 * in the `migrations` bookkeeping table: whichever runner gets there first
 * marks it applied, and the schema-equivalence test harnesses that build a
 * reference database by discovering every src/main/migrations/*.js file by
 * filename (scripts/generate-schema-snapshot.ts, src/core/db/__tests__/
 * bootstrap.test.ts, src/core/services/__tests__/*.test.ts) automatically
 * pick 028.js up too, so the "does the platform-free bootstrap produce the
 * same schema as the historical migration chain" tests keep passing without
 * needing to know this table exists twice.
 *
 * The DDL text below and in 028.js must stay word-for-word identical
 * (whitespace aside) for that schema-equivalence comparison to hold.
 */
export const CORE_MIGRATIONS: CoreMigration[] = [
  {
    name: '028_create_settings_table',
    async up(driver) {
      await driver.exec(
        `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updatedAt DATETIME)`,
      );
    },
  },
  // Migration 029 — client half of multi-device sync: sync_outbox/
  // sync_state/sync_rejected plus per-table capture triggers. See
  // src/core/db/migrations/029_create_sync_tables.ts's doc comment and
  // src/core/sync/*. Has a desktop-side twin (src/main/migrations/029.js),
  // same as 028 — see that migration's doc comment just above for why. No
  // app-level wiring rides on this migration yet (no UI, no worker/service
  // usage of the tables/triggers it creates) — only the schema groundwork,
  // same category as migration 024's uuid rollout. The real transport +
  // UI/worker wiring is a later increment.
  migration029,
  // Migration 030 — the local audit trail for a row SyncEngine.applyRow
  // could not apply (a natural-key UNIQUE conflict a uuid-keyed upsert
  // can't detect, most notably two independently-seeded devices sharing a
  // username/account-code/etc). See
  // src/core/db/migrations/030_create_sync_apply_conflicts.ts's doc
  // comment for the real incident this guards against and the
  // "advance the cursor past it anyway" trade-off it encodes. Has a
  // desktop-side twin (src/main/migrations/030.js), same as 028/029.
  migration030,
  // Migration 031 — fixes a field bug in migration 029's capture triggers:
  // a declared-BLOB column (today, only users.password_hash) was excluded
  // from every captured row image entirely, so `users` replicated across
  // devices with no credential material and a second device could never log
  // in. See src/core/db/migrations/031_replicate_blob_columns.ts's doc
  // comment for the fix (029's trigger builder now captures a declared-blob
  // column as a `<col>`/`<col>__hex` typed pair) and why this migration
  // additionally has to re-emit corrective `users` row images, not just fix
  // the triggers going forward. Has a desktop-side twin
  // (src/main/migrations/031.js), same as 028/029/030.
  migration031,
  // Migration 032 — re-dates/renames the import-baseline `stock_adjustments`
  // rows `inventoryBaselineBackfill.ts`'s `backfillInventoryBaseline` wrote
  // before this change: they represent each item's opening stock from
  // before recorded history began, not an import-day event, so a row dated
  // import-day (the old behavior) read as false to the owner. See
  // src/core/db/migrations/032_redate_import_baselines.ts's doc comment for
  // the full investigation and why the old reason literal is intentionally
  // frozen there rather than imported. Has a desktop-side twin
  // (src/main/migrations/032.js), same as 028-031.
  migration032,
  // Migration 033 — rebuilds `settings` (migration 028) to the standard
  // replicated-table shape (INTEGER id + uuid) and installs the same
  // capture triggers every other business table has, so business settings
  // (company profile, invoice print settings, publish's non-secret fields)
  // ride multi-device sync too. Also seeds corrective sync_outbox rows for
  // whatever a device already had saved, excluding secret setting keys. See
  // src/core/db/migrations/033_sync_settings.ts's doc comment for the full
  // design (per-key last-writer-wins, not per-row — the apply-side half of
  // that lives in SyncEngine, not here) and
  // src/core/services/settingsSecrets.ts for why secrets can never be among
  // the seeded rows. Has a desktop-side twin (src/main/migrations/033.js),
  // same as 028-032.
  migration033,
  // Migration 034 — the sync-apply timestamp-fidelity fix: the schema's
  // pre-existing (pre-sync) `after_insert_<table>_add_timestamp` /
  // `after_update_<table>_add_timestamp` triggers were unconditionally
  // stamping `createdAt`/`updatedAt` to THIS device's local clock even when
  // the write was `SyncEngine.applyRow` writing a pulled row, clobbering the
  // origin device's true timestamps and making the "Edited" pill
  // (`updatedAt > createdAt`) light up on every synced row — a real field
  // bug caught on a device that had just joined a sync project. Prepends the
  // same `APPLYING_GUARD` migration 029's own capture triggers use, so a
  // sync apply no longer touches these two columns at all and `applyRow`'s
  // own write (which already carries the row image's real values) is what
  // sticks. See src/core/db/migrations/034_suppress_timestamp_triggers_during_apply.ts's
  // doc comment for the full incident, why every trigger body is
  // regenerated from its own name rather than parsed out of
  // `sqlite_master`, and why local/user-initiated writes are entirely
  // unaffected. Has a desktop-side twin (src/main/migrations/034.js), same
  // as 028-033.
  migration034,
  // Migration 035 — the third wave of the timestamp-fidelity saga: a plain
  // "bring your database" import (src/core/db/import.ts's copyTable) INSERTs
  // each row with its TRUE createdAt/updatedAt in the INSERT's own explicit
  // column list, but after_insert_<table>_add_timestamp — even after 034,
  // whose APPLYING_GUARD only covers sync apply, not import — still
  // unconditionally stomped both columns to this device's local clock on
  // every ordinary (non-apply) INSERT, clobbering an imported business's
  // real history and lighting up the "Edited" pill on every imported row.
  // Rebuilds the insert trigger's UPDATE to use
  // COALESCE(column, datetime(...)) instead of an unconditional datetime(...)
  // — it now only FILLS a column the triggering INSERT left NULL, never
  // overwrites one the INSERT explicitly supplied — while keeping 034's
  // APPLYING_GUARD WHEN clause exactly as it was and leaving
  // after_update_<table>_add_timestamp untouched (a genuine local edit must
  // still bump updatedAt). See
  // src/core/db/migrations/035_insert_timestamps_fill_only.ts's doc comment
  // for the full incident, why sync apply's own APPLYING_GUARD doesn't
  // already cover import, and the historic uuid-backfill UPDATE sweep this
  // migration deliberately does NOT fix (a known, documented cost for future
  // data-sweeping migrations to handle themselves). Has a desktop-side twin
  // (src/main/migrations/035.js), same as 028-034.
  migration035,
];
