import { pick, toNumber } from 'lodash';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect } from 'react';
import type { InventoryItem } from 'types';
import { InvoiceType } from 'types';

const INVENTORY_PICK = [
  'id',
  'name',
  'price',
  'quantity',
  'description',
  'itemTypeId',
  'itemTypeName',
] as const;

function filterInventoryForInvoice(
  items: InventoryItem[],
  invoiceType: InvoiceType,
): InventoryItem[] {
  const picked = items.map((item) => pick(item, [...INVENTORY_PICK]));
  if (invoiceType === InvoiceType.Purchase) {
    // purchase: any qty (including 0); still require a positive price for line defaults
    return picked.filter((item) => item.price > 0);
  }
  // sale: only in-stock, priced items
  return picked.filter((item) => item.quantity > 0 && item.price > 0);
}

/**
 * default pick for selectors + validation, plus any inventory rows referenced by
 * current invoice lines (so sold-out / 0-qty lines still resolve item type + show label on edit).
 */
export function mergeInventoryForInvoice(
  raw: InventoryItem[],
  invoiceType: InvoiceType,
  lineInventoryIds: readonly number[],
): InventoryItem[] {
  const filtered = filterInventoryForInvoice(raw, invoiceType);
  const byId = new Map<number, InventoryItem>();
  filtered.forEach((i) => {
    byId.set(i.id, i);
  });
  const needed = new Set(lineInventoryIds.filter((id) => id > 0));
  raw.forEach((row) => {
    if (needed.has(row.id) && !byId.has(row.id)) {
      byId.set(row.id, pick(row, INVENTORY_PICK));
    }
  });
  return Array.from(byId.values());
}

/** stable key for effect deps when line ids set changes */
export function lineInventoryIdsKeyFromIds(
  lineInventoryIds: readonly number[],
): string {
  return [...new Set(lineInventoryIds.filter((id) => id > 0))]
    .sort((a, b) => a - b)
    .join(',');
}

/** parse key from lineInventoryIdsKeyFromIds (empty string -> []) */
export function parseLineInventoryIdsKey(key: string): number[] {
  if (!key.trim()) return [];
  return key
    .split(',')
    .map((s) => toNumber(s))
    .filter((id) => id > 0);
}

/**
 * loads merged inventory when invoice type or the set of line inventory ids changes.
 * pass lineInventoryIdsKey (string), not a number[] — rhf gives new array refs every render
 * and would retrigger this effect every time (setInventory loop).
 */
export function useInvoiceInventoryLoader(
  invoiceType: InvoiceType,
  lineInventoryIdsKey: string,
  setInventory: Dispatch<SetStateAction<InventoryItem[] | undefined>>,
): void {
  useEffect(() => {
    let cancelled = false;
    const lineInventoryIds = parseLineInventoryIdsKey(lineInventoryIdsKey);
    (async () => {
      const raw: InventoryItem[] = await window.electron.getInventory();
      if (cancelled) return;
      setInventory(
        mergeInventoryForInvoice(raw, invoiceType, lineInventoryIds),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceType, lineInventoryIdsKey, setInventory]);
}
