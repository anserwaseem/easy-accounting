import type { BulkPriceListPositionPatch, InventoryItem } from 'types';

/**
 * Editable columns. Beyond the base price and list #, each active price list
 * contributes a column identified as `list:<priceListId>` so a business can
 * maintain several named prices per item without a code change.
 */
export type InventoryBulkEditCol = 'price' | 'listPosition' | `list:${number}`;

export interface InventoryBulkEditDraftFields {
  price?: string;
  listPosition?: string;
  /** keyed by price list id, as typed */
  listPrices?: Record<number, string>;
}

/** Builds the column id for a price list. */
export const priceListCol = (priceListId: number): InventoryBulkEditCol =>
  `list:${priceListId}`;

/** Extracts the price list id from a column id, or null for base columns. */
export const priceListIdOfCol = (col: InventoryBulkEditCol): number | null => {
  if (!col.startsWith('list:')) return null;
  const id = Number(col.slice('list:'.length));
  return Number.isFinite(id) ? id : null;
};

/** A list price as stored, or null when the item is not priced on that list. */
export const getRowListPrice = (
  row: InventoryItem,
  priceListId: number,
): number | null => {
  const value = row.listPrices?.[priceListId];
  return typeof value === 'number' ? value : null;
};

export const formatListPriceDisplay = (value: number | null): string =>
  value == null ? '' : String(value);

/** empty clears the price on that list; otherwise a number ≥ 0 */
export const parseListPriceInput = (
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: string } => {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'Price must be a number ≥ 0' };
  }
  return { ok: true, value: n };
};

export const INVENTORY_BULK_EDIT_COLS: InventoryBulkEditCol[] = [
  'listPosition',
  'price',
];

export const formatListPositionDisplay = (
  value: number | null | undefined,
): string => (value == null ? '' : String(value));

export const formatPriceDisplay = (value: number): string => String(value);

export const getDraftDisplayValue = (
  row: InventoryItem,
  col: InventoryBulkEditCol,
  draft: InventoryBulkEditDraftFields | undefined,
): string => {
  if (col === 'price') {
    return draft?.price !== undefined
      ? draft.price
      : formatPriceDisplay(row.price);
  }
  const priceListId = priceListIdOfCol(col);
  if (priceListId !== null) {
    const typed = draft?.listPrices?.[priceListId];
    return typed !== undefined
      ? typed
      : formatListPriceDisplay(getRowListPrice(row, priceListId));
  }
  return draft?.listPosition !== undefined
    ? draft.listPosition
    : formatListPositionDisplay(row.listPosition);
};

/** empty list # → null; otherwise non-negative whole number (matches inventorySchemas) */
export const parseListPositionInput = (
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: string } => {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return {
      ok: false,
      error: 'List # must be a non-negative whole number',
    };
  }
  return { ok: true, value: n };
};

export const parsePriceInput = (
  raw: string,
): { ok: true; value: number } | { ok: false; error: string } => {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, error: 'Price is required' };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'Price must be a number ≥ 0' };
  }
  return { ok: true, value: n };
};

export const isDraftRowDirty = (
  row: InventoryItem,
  draft: InventoryBulkEditDraftFields | undefined,
): boolean => {
  if (!draft) return false;
  if (draft.price !== undefined) {
    const parsed = parsePriceInput(draft.price);
    if (!parsed.ok || parsed.value !== row.price) return true;
  }
  if (draft.listPosition !== undefined) {
    const parsed = parseListPositionInput(draft.listPosition);
    const original = row.listPosition ?? null;
    if (!parsed.ok || parsed.value !== original) return true;
  }
  if (draft.listPrices) {
    for (const [key, raw] of Object.entries(draft.listPrices)) {
      const parsed = parseListPriceInput(raw);
      const original = getRowListPrice(row, Number(key));
      if (!parsed.ok || parsed.value !== original) return true;
    }
  }
  return false;
};

export const countDirtyDraftRows = (
  originalsById: Map<number, InventoryItem>,
  draftById: Map<number, InventoryBulkEditDraftFields>,
): number => {
  let count = 0;
  draftById.forEach((draft, id) => {
    const row = originalsById.get(id);
    if (row && isDraftRowDirty(row, draft)) {
      count += 1;
    }
  });
  return count;
};

/**
 * builds save payload from draft overlay. returns error if any dirty cell is invalid.
 */
export const buildBulkPriceListPatches = (
  originalsById: Map<number, InventoryItem>,
  draftById: Map<number, InventoryBulkEditDraftFields>,
):
  | { ok: true; patches: BulkPriceListPositionPatch[] }
  | { ok: false; error: string } => {
  const patches: BulkPriceListPositionPatch[] = [];

  const ids = Array.from(draftById.keys());
  for (const id of ids) {
    const draft = draftById.get(id);
    const row = originalsById.get(id);
    if (!draft || !row || !isDraftRowDirty(row, draft)) continue;

    let { price } = row;
    if (draft.price !== undefined) {
      const parsed = parsePriceInput(draft.price);
      if (!parsed.ok) {
        return { ok: false, error: `${row.name}: ${parsed.error}` };
      }
      price = parsed.value;
    }

    let listPosition = row.listPosition ?? null;
    if (draft.listPosition !== undefined) {
      const parsed = parseListPositionInput(draft.listPosition);
      if (!parsed.ok) {
        return { ok: false, error: `${row.name}: ${parsed.error}` };
      }
      listPosition = parsed.value;
    }

    const listPrices: Array<{ priceListId: number; price: number | null }> = [];
    if (draft.listPrices) {
      for (const [key, raw] of Object.entries(draft.listPrices)) {
        const priceListId = Number(key);
        const parsed = parseListPriceInput(raw);
        if (!parsed.ok) {
          return { ok: false, error: `${row.name}: ${parsed.error}` };
        }
        if (parsed.value !== getRowListPrice(row, priceListId)) {
          listPrices.push({ priceListId, price: parsed.value });
        }
      }
    }

    patches.push({
      id,
      price,
      listPosition,
      ...(listPrices.length > 0 ? { listPrices } : {}),
    });
  }

  return { ok: true, patches };
};

export interface BulkEditChangeRow {
  id: number;
  name: string;
  /** set only when price changed */
  priceFrom?: number;
  priceTo?: number;
  /** set only when list # changed */
  listFrom?: number | null;
  listTo?: number | null;
  /** one entry per changed price list */
  priceListChanges?: Array<{
    priceListId: number;
    from: number | null;
    to: number | null;
  }>;
}

export interface BulkEditChangeSummary {
  rows: BulkEditChangeRow[];
  /** how many item rows were omitted after maxRows */
  truncatedCount: number;
  /** distinct inventory rows in the patch set */
  itemCount: number;
  /** true if any row has a price change (for table column) */
  hasPriceChanges: boolean;
  /** true if any row has a list # change */
  hasListChanges: boolean;
  /** true if any row changed a named price list */
  hasPriceListChanges: boolean;
}

const formatListPosLabel = (value: number | null): string =>
  value == null ? '—' : String(value);

/**
 * one row per item with only changed fields filled. call only on Save click.
 * omit maxRows to show every item (dialog scrolls); pass maxRows to truncate.
 */
export const buildBulkEditChangeSummary = (
  originalsById: Map<number, InventoryItem>,
  patches: BulkPriceListPositionPatch[],
  maxRows?: number,
): BulkEditChangeSummary => {
  const rows: BulkEditChangeRow[] = [];
  let hasPriceChanges = false;
  let hasListChanges = false;
  let hasPriceListChanges = false;

  for (const patch of patches) {
    const original = originalsById.get(patch.id);
    if (!original) continue;

    const row: BulkEditChangeRow = {
      id: patch.id,
      name: original.name,
    };

    if (patch.price !== original.price) {
      row.priceFrom = original.price;
      row.priceTo = patch.price;
      hasPriceChanges = true;
    }

    const oldList = original.listPosition ?? null;
    if (patch.listPosition !== oldList) {
      row.listFrom = oldList;
      row.listTo = patch.listPosition;
      hasListChanges = true;
    }

    if (patch.listPrices?.length) {
      row.priceListChanges = patch.listPrices.map((entry) => ({
        priceListId: entry.priceListId,
        from: getRowListPrice(original, entry.priceListId),
        to: entry.price,
      }));
      hasPriceListChanges = true;
    }

    if (
      row.priceTo !== undefined ||
      row.listTo !== undefined ||
      row.priceListChanges?.length
    ) {
      rows.push(row);
    }
  }

  const limit = maxRows ?? rows.length;
  const truncatedCount = Math.max(0, rows.length - limit);
  return {
    rows: rows.slice(0, limit),
    truncatedCount,
    itemCount: patches.length,
    hasPriceChanges,
    hasListChanges,
    hasPriceListChanges,
  };
};

export { formatListPosLabel };

export const focusInventoryBulkEditCell = (
  inventoryId: number,
  col: InventoryBulkEditCol,
): boolean => {
  const el = document.querySelector<HTMLInputElement>(
    `input[data-inventory-id="${inventoryId}"][data-col="${col}"]`,
  );
  if (!el) return false;
  el.focus({ preventScroll: true });
  el.select();
  return true;
};

export const scheduleFocusInventoryBulkEditCell = (
  inventoryId: number,
  col: InventoryBulkEditCol,
  attempts = 24,
): void => {
  let left = attempts;
  const tryFocus = () => {
    if (focusInventoryBulkEditCell(inventoryId, col)) return;
    left -= 1;
    if (left <= 0) return;
    requestAnimationFrame(tryFocus);
  };
  requestAnimationFrame(tryFocus);
};

export const resolveNextBulkEditTarget = (
  viewRows: InventoryItem[],
  currentId: number,
  currentCol: InventoryBulkEditCol,
  key: string,
  shiftKey: boolean,
): {
  inventoryId: number;
  col: InventoryBulkEditCol;
  rowIndex: number;
} | null => {
  const rowIndex = viewRows.findIndex((r) => r.id === currentId);
  if (rowIndex < 0) return null;

  const colIndex = INVENTORY_BULK_EDIT_COLS.indexOf(currentCol);
  if (colIndex < 0) return null;

  if (key === 'ArrowLeft') {
    const nextCol = INVENTORY_BULK_EDIT_COLS[Math.max(0, colIndex - 1)];
    return { inventoryId: currentId, col: nextCol, rowIndex };
  }
  if (key === 'ArrowRight') {
    const nextCol =
      INVENTORY_BULK_EDIT_COLS[
        Math.min(INVENTORY_BULK_EDIT_COLS.length - 1, colIndex + 1)
      ];
    return { inventoryId: currentId, col: nextCol, rowIndex };
  }
  if (key === 'ArrowUp' || (key === 'Enter' && shiftKey)) {
    const nextRow = rowIndex - 1;
    if (nextRow < 0) return null;
    return {
      inventoryId: viewRows[nextRow].id,
      col: currentCol,
      rowIndex: nextRow,
    };
  }
  if (key === 'ArrowDown' || key === 'Enter') {
    const nextRow = rowIndex + 1;
    if (nextRow >= viewRows.length) return null;
    return {
      inventoryId: viewRows[nextRow].id,
      col: currentCol,
      rowIndex: nextRow,
    };
  }
  if (key === 'Tab') {
    if (shiftKey) {
      if (colIndex > 0) {
        return {
          inventoryId: currentId,
          col: INVENTORY_BULK_EDIT_COLS[colIndex - 1],
          rowIndex,
        };
      }
      const nextRow = rowIndex - 1;
      if (nextRow < 0) return null;
      return {
        inventoryId: viewRows[nextRow].id,
        col: INVENTORY_BULK_EDIT_COLS[INVENTORY_BULK_EDIT_COLS.length - 1],
        rowIndex: nextRow,
      };
    }
    if (colIndex < INVENTORY_BULK_EDIT_COLS.length - 1) {
      return {
        inventoryId: currentId,
        col: INVENTORY_BULK_EDIT_COLS[colIndex + 1],
        rowIndex,
      };
    }
    const nextRow = rowIndex + 1;
    if (nextRow >= viewRows.length) return null;
    return {
      inventoryId: viewRows[nextRow].id,
      col: INVENTORY_BULK_EDIT_COLS[0],
      rowIndex: nextRow,
    };
  }
  return null;
};
