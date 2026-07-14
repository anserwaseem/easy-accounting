import { useCallback, useRef, useState, type MutableRefObject } from 'react';
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
  writeDraftField: (
    inventoryId: number,
    col: InventoryBulkEditCol,
    raw: string,
  ) => void;
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
}

const scheduleDirtyCount = (
  draftRef: MutableRefObject<Map<number, InventoryBulkEditDraftFields>>,
  originalsRef: MutableRefObject<Map<number, InventoryItem>>,
  setDirtyCount: (n: number) => void,
  rafRef: MutableRefObject<number | null>,
) => {
  if (rafRef.current != null) return;
  rafRef.current = window.requestAnimationFrame(() => {
    rafRef.current = null;
    setDirtyCount(countDirtyDraftRows(originalsRef.current, draftRef.current));
  });
};

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
    const dirtyRafRef = useRef<number | null>(null);

    const syncOriginals = useCallback((inventory: InventoryItem[]) => {
      const next = new Map<number, InventoryItem>();
      inventory.forEach((row) => {
        next.set(row.id, row);
      });
      originalsRef.current = next;
    }, []);

    const enterEditMode = useCallback(
      (inventoryRows: InventoryItem[]) => {
        syncOriginals(inventoryRows);
        draftRef.current = new Map();
        setDirtyCount(0);
        setEditSessionKey((k) => k + 1);
        setEditMode(true);
      },
      [syncOriginals],
    );

    const exitEditMode = useCallback(() => {
      draftRef.current = new Map();
      setDirtyCount(0);
      setEditMode(false);
      setEditSessionKey((k) => k + 1);
    }, []);

    const discardDraft = useCallback(() => {
      draftRef.current = new Map();
      setDirtyCount(0);
      setEditSessionKey((k) => k + 1);
    }, []);

    const writeDraftField = useCallback(
      (inventoryId: number, col: InventoryBulkEditCol, raw: string) => {
        const prev = draftRef.current.get(inventoryId) ?? {};
        const next: InventoryBulkEditDraftFields = {
          ...prev,
          [col]: raw,
        };
        draftRef.current.set(inventoryId, next);
        scheduleDirtyCount(draftRef, originalsRef, setDirtyCount, dirtyRafRef);
      },
      [],
    );

    const getCellDefaultValue = useCallback(
      (row: InventoryItem, col: InventoryBulkEditCol) => {
        // keep originals map warm for dirty checks when rows first render in edit mode
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
      getCellDefaultValue,
      buildPatches,
      applyPatchesLocally,
    };
  };
