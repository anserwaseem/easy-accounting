import { useCallback, useRef, useState } from 'react';
import type { BulkPriceListPositionPatch, InventoryItem } from 'types';
import {
  buildBulkPriceListPatches,
  countDirtyDraftRows,
  getDraftDisplayValue,
  type InventoryBulkEditCol,
  type InventoryBulkEditDraftFields,
} from './inventoryBulkEdit';

interface UseInventoryBulkEditDraftResult {
  editMode: boolean;
  editSessionKey: number;
  dirtyCount: number;
  saving: boolean;
  setSaving: (value: boolean) => void;
  enterEditMode: (inventory: InventoryItem[]) => void;
  exitEditMode: () => void;
  discardDraft: () => void;
  /** write draft only — no React state (keeps focus while typing) */
  writeDraftField: (
    inventoryId: number,
    col: InventoryBulkEditCol,
    raw: string,
  ) => void;
  /** push dirtyCount into React state (call on blur / navigate / before save) */
  flushDirtyCount: () => number;
  getCellDefaultValue: (
    row: InventoryItem,
    col: InventoryBulkEditCol,
  ) => string;
  buildPatches: (
    inventory: InventoryItem[],
  ) =>
    | { ok: true; patches: BulkPriceListPositionPatch[] }
    | { ok: false; error: string };
  applyPatchesLocally: (
    inventory: InventoryItem[],
    patches: BulkPriceListPositionPatch[],
  ) => InventoryItem[];
  /** sync check without setState — Save enable before blur flush */
  getDirtyCountSnapshot: () => number;
}

export const useInventoryBulkEditDraft =
  (): UseInventoryBulkEditDraftResult => {
    const [editMode, setEditMode] = useState(false);
    const [editSessionKey, setEditSessionKey] = useState(0);
    const [dirtyCount, setDirtyCount] = useState(0);
    const [saving, setSaving] = useState(false);

    const draftRef = useRef<Map<number, InventoryBulkEditDraftFields>>(
      new Map(),
    );
    const originalsRef = useRef<Map<number, InventoryItem>>(new Map());
    const dirtyCountRef = useRef(0);

    const syncOriginals = useCallback((inventory: InventoryItem[]) => {
      const next = new Map<number, InventoryItem>();
      inventory.forEach((row) => {
        next.set(row.id, row);
      });
      originalsRef.current = next;
    }, []);

    const getDirtyCountSnapshot = useCallback(
      () => countDirtyDraftRows(originalsRef.current, draftRef.current),
      [],
    );

    const flushDirtyCount = useCallback(() => {
      const next = countDirtyDraftRows(originalsRef.current, draftRef.current);
      dirtyCountRef.current = next;
      setDirtyCount((prev) => (prev === next ? prev : next));
      return next;
    }, []);

    const enterEditMode = useCallback(
      (inventoryRows: InventoryItem[]) => {
        syncOriginals(inventoryRows);
        draftRef.current = new Map();
        dirtyCountRef.current = 0;
        setDirtyCount(0);
        setEditSessionKey((k) => k + 1);
        setEditMode(true);
      },
      [syncOriginals],
    );

    const exitEditMode = useCallback(() => {
      draftRef.current = new Map();
      dirtyCountRef.current = 0;
      setDirtyCount(0);
      setEditMode(false);
      setEditSessionKey((k) => k + 1);
    }, []);

    const discardDraft = useCallback(() => {
      draftRef.current = new Map();
      dirtyCountRef.current = 0;
      setDirtyCount(0);
      setEditSessionKey((k) => k + 1);
    }, []);

    const writeDraftField = useCallback(
      (inventoryId: number, col: InventoryBulkEditCol, raw: string) => {
        const prev = draftRef.current.get(inventoryId) ?? {};
        draftRef.current.set(inventoryId, {
          ...prev,
          [col]: raw,
        });
        // intentionally no setState — keystroke must not re-render virtualized rows
        dirtyCountRef.current = countDirtyDraftRows(
          originalsRef.current,
          draftRef.current,
        );
      },
      [],
    );

    const getCellDefaultValue = useCallback(
      (row: InventoryItem, col: InventoryBulkEditCol) => {
        if (!originalsRef.current.has(row.id)) {
          originalsRef.current.set(row.id, row);
        }
        return getDraftDisplayValue(row, col, draftRef.current.get(row.id));
      },
      [],
    );

    const buildPatches = useCallback(
      (inventory: InventoryItem[]) => {
        syncOriginals(inventory);
        return buildBulkPriceListPatches(
          originalsRef.current,
          draftRef.current,
        );
      },
      [syncOriginals],
    );

    const applyPatchesLocally = useCallback(
      (inventory: InventoryItem[], patches: BulkPriceListPositionPatch[]) => {
        if (patches.length === 0) return inventory;
        const byId = new Map(patches.map((p) => [p.id, p]));
        return inventory.map((row) => {
          const patch = byId.get(row.id);
          if (!patch) return row;
          return {
            ...row,
            price: patch.price,
            listPosition: patch.listPosition,
          };
        });
      },
      [],
    );

    return {
      editMode,
      editSessionKey,
      dirtyCount,
      saving,
      setSaving,
      enterEditMode,
      exitEditMode,
      discardDraft,
      writeDraftField,
      flushDirtyCount,
      getCellDefaultValue,
      buildPatches,
      applyPatchesLocally,
      getDirtyCountSnapshot,
    };
  };
