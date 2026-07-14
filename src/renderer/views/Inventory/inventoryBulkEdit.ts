import type { BulkPriceListPositionPatch, InventoryItem } from 'types';

export type InventoryBulkEditCol = 'price' | 'listPosition';

export interface InventoryBulkEditDraftFields {
  price?: string;
  listPosition?: string;
}

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
  return draft?.listPosition !== undefined
    ? draft.listPosition
    : formatListPositionDisplay(row.listPosition);
};

/** empty list # → null; otherwise must be finite integer */
export const parseListPositionInput = (
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: string } => {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, value: null };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: 'List # must be an integer' };
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

    patches.push({ id, price, listPosition });
  }

  return { ok: true, patches };
};

export const focusInventoryBulkEditCell = (
  inventoryId: number,
  col: InventoryBulkEditCol,
): boolean => {
  const el = document.querySelector<HTMLInputElement>(
    `input[data-inventory-id="${inventoryId}"][data-col="${col}"]`,
  );
  if (!el) return false;
  el.focus();
  el.select();
  return true;
};

export const scheduleFocusInventoryBulkEditCell = (
  inventoryId: number,
  col: InventoryBulkEditCol,
  attempts = 8,
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
