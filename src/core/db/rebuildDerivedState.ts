import type { DatabaseDriver } from './driver';

async function tableExists(db: DatabaseDriver, name: string): Promise<boolean> {
  const row = await db.get(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [name],
  );
  return row !== undefined;
}

async function viewExists(db: DatabaseDriver, name: string): Promise<boolean> {
  const row = await db.get(
    `SELECT 1 FROM sqlite_master WHERE type = 'view' AND name = ?`,
    [name],
  );
  return row !== undefined;
}

/**
 * Recompute running-quantity caches from replicated facts.
 *
 * `vendor_stock` and `inventory.quantity` are derived the same way `ledger`
 * already is (`ledger_view`). Movements / invoices replicate; the balance
 * tables do not. After sync apply or import, rebuild them so a second
 * device does not show empty/stale on-hand.
 *
 * Must run while sync apply's echo-suppression guard is on (or before
 * capture triggers exist), otherwise the inventory UPDATE would re-queue
 * itself into `sync_outbox`.
 */
export async function rebuildDerivedState(db: DatabaseDriver): Promise<void> {
  await rebuildVendorStockFromMovements(db);
  await rebuildInventoryQuantityFromView(db);
}

export async function rebuildVendorStockFromMovements(
  db: DatabaseDriver,
): Promise<void> {
  if (!(await tableExists(db, 'vendor_stock'))) return;
  if (!(await tableExists(db, 'vendor_stock_movements'))) return;

  await db.run(`DELETE FROM vendor_stock`);
  await db.run(`
    INSERT INTO vendor_stock (vendorAccountId, inventoryId, quantity)
    SELECT vendorAccountId, inventoryId, SUM(quantityDelta)
    FROM vendor_stock_movements
    GROUP BY vendorAccountId, inventoryId
    HAVING SUM(quantityDelta) != 0
  `);
}

export async function rebuildInventoryQuantityFromView(
  db: DatabaseDriver,
): Promise<void> {
  if (!(await tableExists(db, 'inventory'))) return;
  if (!(await viewExists(db, 'inventory_quantity_view'))) return;

  await db.run(`
    UPDATE inventory SET quantity = COALESCE(
      (SELECT quantity FROM inventory_quantity_view WHERE inventoryId = inventory.id),
      0
    )
  `);
}
