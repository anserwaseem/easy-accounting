import type { DatabaseDriver } from '../driver';

/**
 * Migration 048 — Heal duplicate invoice line items and duplicate journals.
 *
 * ## The Problem
 *
 * When an invoice was edited or re-delivered across multi-device sync, child rows
 * (invoice_items, journal, journal_entry) were occasionally duplicated under the same
 * invoiceId due to random UUID re-generation on updates.
 *
 * For example, on invoice #10338, 343 units of inventory item S-23-Z were duplicated,
 * deducting 686 units instead of 343 and resulting in negative stock (-6), while
 * the customer ledger was debited twice (Rs 170,402 × 2).
 *
 * ## The Fix
 *
 * 1. Find and delete identical duplicate `invoice_items` rows on the same invoice
 *    (matching invoiceId, inventoryId, quantity, price, discount), keeping the primary row.
 * 2. Re-synchronize `inventory.quantity` counter to `inventory_quantity_view.quantity`
 *    for any affected inventory items.
 * 3. Find and delete duplicate `journal` rows on the same invoice with identical
 *    billNumber and discountPercentage, along with their `journal_entry` rows.
 *
 * Idempotent by construction: if no duplicates exist, no rows are touched.
 */
export const migration048 = {
  name: '048_heal_duplicate_invoice_lines',
  async up(driver: DatabaseDriver): Promise<void> {
    // 1. Find duplicate invoice_items
    const duplicateItems = await driver.all<{
      invoiceId: number;
      inventoryId: number;
      deleteId: number;
    }>(`
      SELECT a.invoiceId, a.inventoryId, MAX(b.id) AS deleteId
      FROM invoice_items a
      JOIN invoice_items b ON a.invoiceId = b.invoiceId
                          AND a.inventoryId = b.inventoryId
                          AND a.quantity = b.quantity
                          AND a.price = b.price
                          AND a.discount = b.discount
                          AND a.id < b.id
      GROUP BY a.invoiceId, a.inventoryId
    `);

    const affectedInventoryIds = new Set<number>();

    for (const dup of duplicateItems) {
      // eslint-disable-next-line no-await-in-loop
      await driver.run(`DELETE FROM invoice_items WHERE id = ?`, [
        dup.deleteId,
      ]);
      affectedInventoryIds.add(dup.inventoryId);
    }

    // Re-synchronize stored inventory.quantity against inventory_quantity_view
    for (const inventoryId of affectedInventoryIds) {
      // eslint-disable-next-line no-await-in-loop
      await driver.run(
        `UPDATE inventory
         SET quantity = (SELECT quantity FROM inventory_quantity_view WHERE inventoryId = ?)
         WHERE id = ?`,
        [inventoryId, inventoryId],
      );
    }

    // 2. Find duplicate journals linked to the same invoice
    const duplicateJournals = await driver.all<{
      invoiceId: number;
      deleteId: number;
    }>(`
      SELECT a.invoiceId, MAX(b.id) AS deleteId
      FROM journal a
      JOIN journal b ON a.invoiceId = b.invoiceId
                    AND a.billNumber = b.billNumber
                    AND COALESCE(a.discountPercentage, -1) = COALESCE(b.discountPercentage, -1)
                    AND a.id < b.id
      WHERE a.invoiceId IS NOT NULL
      GROUP BY a.invoiceId, a.billNumber
    `);

    for (const dup of duplicateJournals) {
      // eslint-disable-next-line no-await-in-loop
      await driver.run(`DELETE FROM journal_entry WHERE journalId = ?`, [
        dup.deleteId,
      ]);
      // eslint-disable-next-line no-await-in-loop
      await driver.run(`DELETE FROM journal WHERE id = ?`, [dup.deleteId]);
    }
  },
};
