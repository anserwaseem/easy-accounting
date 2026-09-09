import { orderBy, pick, toNumber } from 'lodash';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef } from 'react';
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
  'listPosition',
] as const;

function filterInventoryForInvoice(
  items: InventoryItem[],
  invoiceType: InvoiceType,
): InventoryItem[] {
  const picked = items.map((item) => pick(item, [...INVENTORY_PICK]));
  if (invoiceType === InvoiceType.Purchase) {
    // restock path: include qty 0 and price 0. new items and opening-stock
    // rows default to both; sale-gated `price > 0` hid them while recently
    // sold-out rows (must have had a selling price) still appeared.
    return picked;
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
  return orderBy(
    Array.from(byId.values()),
    [
      (i) =>
        i.listPosition == null ? Number.POSITIVE_INFINITY : i.listPosition,
      'id',
    ],
    ['asc', 'asc'],
  );
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
 * raw cache intentionally skips network until refreshInventory() clears it.
 */
export function useInvoiceInventoryLoader(
  invoiceType: InvoiceType,
  lineInventoryIdsKey: string,
  setInventory: Dispatch<SetStateAction<InventoryItem[] | undefined>>,
): {
  refreshInventory: () => Promise<void>;
} {
  const rawInventoryRef = useRef<InventoryItem[] | null>(null);
  // bumps on every network fetch so a stale in-flight load cannot overwrite a newer refresh
  const fetchGenerationRef = useRef(0);
  const invoiceTypeRef = useRef(invoiceType);
  const lineInventoryIdsKeyRef = useRef(lineInventoryIdsKey);
  invoiceTypeRef.current = invoiceType;
  lineInventoryIdsKeyRef.current = lineInventoryIdsKey;

  const refreshInventory = useCallback(async () => {
    const generation = ++fetchGenerationRef.current;
    const raw: InventoryItem[] = await window.electron.getInventory();
    if (generation !== fetchGenerationRef.current) return;
    rawInventoryRef.current = raw;
    setInventory(
      mergeInventoryForInvoice(
        raw,
        invoiceTypeRef.current,
        parseLineInventoryIdsKey(lineInventoryIdsKeyRef.current),
      ),
    );
  }, [setInventory]);

  useEffect(() => {
    let cancelled = false;
    const lineInventoryIds = parseLineInventoryIdsKey(lineInventoryIdsKey);

    const applyMergedInventory = (raw: InventoryItem[]) => {
      if (cancelled) return;
      setInventory(
        mergeInventoryForInvoice(raw, invoiceType, lineInventoryIds),
      );
    };

    (async () => {
      if (rawInventoryRef.current) {
        applyMergedInventory(rawInventoryRef.current);
        return;
      }

      const generation = ++fetchGenerationRef.current;
      const raw: InventoryItem[] = await window.electron.getInventory();
      if (cancelled || generation !== fetchGenerationRef.current) return;
      rawInventoryRef.current = raw;
      applyMergedInventory(raw);
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceType, lineInventoryIdsKey, setInventory]);

  return { refreshInventory };
}
