import type { DatabaseDriver } from '../driver';
import {
  INVENTORY_BASELINE_DATE,
  INVENTORY_BASELINE_REASON,
} from '../inventoryBaselineBackfill';

/**
 * Migration 032 — re-dates and renames the import-baseline `stock_adjustments`
 * rows {@link import('../inventoryBaselineBackfill').backfillInventoryBaseline}
 * already wrote to devices that imported a desktop database before this
 * change. Has a desktop-side twin, `src/main/migrations/032.js` — same
 * reason migrations 028-031 do (see `030_create_sync_apply_conflicts.ts`'s
 * doc comment): the existing Electron install path runs schema changes
 * exclusively through the old synchronous `MigrationRunner`, which never
 * calls `bootstrapDatabase`, so a schema change meant to reach it has to be
 * expressed twice.
 *
 * ## Why this exists — same investigation as `inventoryBaselineBackfill.ts`
 *
 * Investigation against a real owner database proved the baseline rows
 * `backfillInventoryBaseline` inserts represent each item's OPENING STOCK
 * from before any recorded history began (11,290 invoices bulk-loaded
 * 2025-03 with business dates back to 2008 predate the desktop's stock-
 * counter feature) — not an event that happened on import day. The owner
 * correctly objected that a row dated import-day (2026-08) describing
 * pre-history stock reads as a false event. `inventoryBaselineBackfill.ts`
 * fixes this going forward (new rows use `INVENTORY_BASELINE_REASON`'s new
 * value and `INVENTORY_BASELINE_DATE`); this migration carries that fix to
 * every row the OLD code already wrote and that is already sitting on the
 * owner's devices (and already pushed to any sync project they're on).
 *
 * ## The old literal is intentionally frozen here, not imported
 *
 * `'Import baseline: carried from desktop stored quantity'` below is the
 * OLD value of `INVENTORY_BASELINE_REASON` before this change — hardcoded
 * as a historical constant rather than referencing any export, because a
 * migration's `WHERE` clause must keep matching exactly the rows a past
 * version of the code produced regardless of what the constant's value
 * becomes in some future release. If `INVENTORY_BASELINE_REASON` changes
 * again later, this migration must still target rows written under THIS
 * specific old string, not whatever the current export happens to hold.
 *
 * ## Idempotent by construction
 *
 * The `UPDATE` only matches rows whose `reason` is still the old literal.
 * After the first run every matching row's `reason` becomes the new value,
 * so a second run's `WHERE` clause matches nothing — no explicit guard
 * needed, same discipline as `verifyInventoryReconciliation`'s "don't write
 * a no-op fact" pattern elsewhere in this file's sibling module.
 *
 * ## Sync: rides the existing capture trigger, and converges across devices
 *
 * `stock_adjustments` is one of migration 029's `SYNC_TABLES` (`BUSINESS_TABLES`
 * minus `ledger`) — this `UPDATE`, run through the normal `driver.run`
 * statement (not a raw/bulk write), fires migration 029's
 * `trg_sync_capture_stock_adjustments_update` trigger exactly like any other
 * application-level update to this table, and the corrected row image is
 * captured into `sync_outbox` and replicates to every other device on the
 * owner's sync project the same way any other stock adjustment edit would.
 * The update is also fully deterministic (same old reason -> same new
 * reason/date, unconditionally) so two devices independently running this
 * migration converge on identical row content — whichever one's corrective
 * `put` lands last in the server's log wins, and it is the same content
 * either way.
 */
export const migration032 = {
  name: '032_redate_import_baselines',
  async up(driver: DatabaseDriver): Promise<void> {
    // Frozen historical value — see this migration's doc comment for why it
    // is not `INVENTORY_BASELINE_REASON` itself.
    const OLD_BASELINE_REASON =
      'Import baseline: carried from desktop stored quantity';

    await driver.run(
      `UPDATE stock_adjustments SET date = ?, reason = ? WHERE reason = ?`,
      [INVENTORY_BASELINE_DATE, INVENTORY_BASELINE_REASON, OLD_BASELINE_REASON],
    );
  },
};
