import type { DatabaseDriver } from '../driver';

/**
 * Migration 044 — Heal causality sync cursor and re-pull dropped rows.
 *
 * ## The Problem
 *
 * When initial outbox seeding occurred on the origin device, self-referential
 * tables (specifically `inventory` where child variant SKUs have `parentId`)
 * queried rows in default SQLite rowid order. In cases where a child variant
 * had a lower `id` than its parent (e.g. child id 49, parent id 525), the child
 * row was pushed to the sync log before the parent row.
 *
 * Secondary devices pulling this log encountered the child before the parent.
 * Because `inventory.parentId_uuid` could not be resolved yet, the error was
 * misidentified as a duplicate-seed collision and dropped. Consequently,
 * child inventory items and all dependent downstream rows (invoice items,
 * price list items, stock adjustments) were silently skipped on those devices.
 *
 * ## The Fix
 *
 * 1. `SyncEngine` now supports self-referential foreign keys arriving out of
 *    causal order (inserting with parentId = null and fixing up once the parent
 *    arrives).
 * 2. This migration resets `sync_state.cursor` to 0 on any synced device with
 *    cursor > 0, and purges `sync_apply_conflicts`.
 * 3. On the next sync cycle, the device re-pulls the sync log from sequence 0,
 *    upserting existing rows and cleanly applying all previously-dropped rows.
 */
export const migration044 = {
  name: '044_heal_causality_sync_cursor',
  async up(driver: DatabaseDriver): Promise<void> {
    // Reset cursor to 0 if a sync cursor was established
    await driver.run(
      `UPDATE sync_state
       SET value = '0'
       WHERE key = 'cursor' AND CAST(value AS INTEGER) > 0`,
    );

    // Clear stale apply conflicts so previously-quarantined rows can cleanly re-apply
    const tableExists = await driver.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_apply_conflicts'`,
    );
    if (tableExists) {
      await driver.run(`DELETE FROM sync_apply_conflicts`);
    }
  },
};
