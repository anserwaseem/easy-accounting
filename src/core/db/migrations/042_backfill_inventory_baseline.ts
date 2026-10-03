import type { DatabaseDriver } from '../driver';
import { backfillInventoryBaseline } from '../inventoryBaselineBackfill';

/**
 * Migration 042 — backfills baseline `stock_adjustments` for legacy desktop
 * databases where `inventory.quantity` counter diverged from `inventory_quantity_view`.
 *
 * In legacy desktop versions, `inventory.quantity` was a stored counter that was
 * directly edited or initialized without backing fact rows (such as opening stock
 * or purchase invoices). Migration 032 introduced `inventory_quantity_view` to
 * derive quantity from facts, but without baseline adjustments, items with historical
 * sales and missing historical purchases showed negative quantities.
 *
 * Delegates to {@link backfillInventoryBaseline} to insert compensating
 * `stock_adjustments` rows so that `inventory_quantity_view` matches the stored
 * `inventory.quantity`. Idempotent: does nothing if gap is already 0.
 */
export const migration042 = {
  name: '042_backfill_inventory_baseline',
  async up(driver: DatabaseDriver): Promise<void> {
    await backfillInventoryBaseline(driver);
  },
};
