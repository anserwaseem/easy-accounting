import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type MutableRefObject,
} from 'react';
import { isNil, toString } from 'lodash';
import {
  createListPositionSortingFn,
  defaultSortingFunctions,
} from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { InventoryItem, ItemType } from 'types';
import { Button } from '@/renderer/shad/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/shad/ui/select';
import { toast } from '@/renderer/shad/ui/use-toast';
import { Loader2, Pencil, Save, X } from 'lucide-react';
import { ConfirmDialog } from '@/renderer/components/ConfirmDialog';
import { EditInventoryItem } from './editInventoryItem';
import { AdjustStock } from './AdjustStock';
import { StockHistoryDialog } from './StockHistoryDialog';
import { InventoryBulkEditCell } from './InventoryBulkEditCell';
import {
  resolveNextBulkEditTarget,
  scheduleFocusInventoryBulkEditCell,
  type InventoryBulkEditCol,
} from './inventoryBulkEdit';
import { useInventoryBulkEditDraft } from './useInventoryBulkEditDraft';

const listPositionSortingFn = createListPositionSortingFn<InventoryItem>(
  (r) => r.id,
);

interface InventoryTableProps {
  refetchInventory: () => void;
  options: {
    refresh?: boolean;
    hideZeroQuantity?: boolean;
    hideZeroPrice?: boolean;
    hideNegativeQuantity?: boolean;
    hideNoType?: boolean;
  };
  /** notify parent so filters can lock during edit / dirty */
  onBulkEditActiveChange?: (active: boolean) => void;
}

export const InventoryTable: React.FC<InventoryTableProps> = ({
  options,
  refetchInventory,
  onBulkEditActiveChange,
}: InventoryTableProps) => {
  // eslint-disable-next-line no-console
  const [inventory, setInventory] = useState<InventoryItem[]>();
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [itemsWithHistory, setItemsWithHistory] = useState<number[]>([]);
  const [virtualScrollToIndex, setVirtualScrollToIndex] = useState<
    number | null
  >(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const viewRowsRef = useRef<InventoryItem[]>([]);
  const inventoryRef = useRef<InventoryItem[] | undefined>(inventory);
  inventoryRef.current = inventory;

  const bulkEdit = useInventoryBulkEditDraft();
  const {
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
  } = bulkEdit;

  console.log('InventoryTable', inventory);

  useEffect(() => {
    onBulkEditActiveChange?.(editMode || dirtyCount > 0);
  }, [editMode, dirtyCount, onBulkEditActiveChange]);

  useEffect(() => {
    const fetchInventory = async () => {
      const [fetchedInventory, idsWithHistory, fetchedItemTypes] =
        await Promise.all([
          window.electron.getInventory(),
          window.electron.getInventoryIdsWithHistory(),
          window.electron.getItemTypes(),
        ]);

      setInventory(fetchedInventory);
      setItemsWithHistory(idsWithHistory);
      setItemTypes(fetchedItemTypes);
    };
    fetchInventory();
  }, [options?.refresh]);

  const updateItemType = async (
    row: InventoryItem,
    selectedTypeId: string | number,
  ) => {
    if (editMode) return;

    const nextItemTypeId =
      Number(selectedTypeId) > 0 ? Number(selectedTypeId) : undefined;

    const updated = await window.electron.updateInventoryItem({
      id: row.id,
      price: row.price,
      description: row.description,
      itemTypeId: nextItemTypeId,
      listPosition: row.listPosition ?? null,
    });

    if (!updated) {
      toast({
        description: 'Failed to update item type',
        variant: 'destructive',
      });
      return;
    }

    setInventory((prev) => {
      return prev?.map((item) => {
        if (item.id !== row.id) return item;
        return {
          ...item,
          itemTypeId: nextItemTypeId,
          itemTypeName:
            itemTypes.find((itemType) => itemType.id === nextItemTypeId)
              ?.name ?? null,
        };
      });
    });
  };

  const getInventory = useCallback(() => {
    const filteredInventory = inventory?.filter((i) => {
      if (options?.hideNegativeQuantity && i.quantity < 0) {
        return false;
      }
      if (options?.hideZeroQuantity && i.quantity === 0) {
        return false;
      }
      if (options?.hideZeroPrice && i.price === 0) {
        return false;
      }
      if (options?.hideNoType) {
        const hasItemType = !isNil(i.itemTypeId) && Number(i.itemTypeId) > 0;
        if (!hasItemType) return false;
      }
      return true;
    });
    return filteredInventory || [];
  }, [
    inventory,
    options?.hideNegativeQuantity,
    options?.hideZeroQuantity,
    options?.hideZeroPrice,
    options?.hideNoType,
  ]);

  const writeDraftFieldRef = useRef(writeDraftField);
  writeDraftFieldRef.current = writeDraftField;

  const stableWriteDraft = useCallback(
    (inventoryId: number, col: InventoryBulkEditCol, raw: string) => {
      writeDraftFieldRef.current(inventoryId, col, raw);
    },
    [],
  );

  const navigateRef: MutableRefObject<
    (
      inventoryId: number,
      col: InventoryBulkEditCol,
      key: string,
      raw: string,
      shiftKey: boolean,
    ) => void
  > = useRef(() => undefined);

  const stableNavigate = useCallback(
    (
      inventoryId: number,
      col: InventoryBulkEditCol,
      key: string,
      raw: string,
      shiftKey: boolean,
    ) => {
      navigateRef.current(inventoryId, col, key, raw, shiftKey);
    },
    [],
  );

  navigateRef.current = (inventoryId, col, key, raw, shiftKey) => {
    writeDraftField(inventoryId, col, raw);
    const target = resolveNextBulkEditTarget(
      viewRowsRef.current,
      inventoryId,
      col,
      key,
      shiftKey,
    );
    if (!target) return;

    const mounted = document.querySelector(
      `input[data-inventory-id="${target.inventoryId}"][data-col="${target.col}"]`,
    );
    if (!mounted) {
      setVirtualScrollToIndex(target.rowIndex);
      window.setTimeout(() => setVirtualScrollToIndex(null), 0);
    }
    scheduleFocusInventoryBulkEditCell(target.inventoryId, target.col);
  };

  const handleViewModelChange = useCallback((rows: InventoryItem[]) => {
    viewRowsRef.current = rows;
  }, []);

  const handleEnterEdit = useCallback(() => {
    enterEditMode(inventoryRef.current ?? []);
  }, [enterEditMode]);

  const performDiscard = useCallback(() => {
    discardDraft();
    exitEditMode();
  }, [discardDraft, exitEditMode]);

  const handleDiscard = useCallback(() => {
    if (dirtyCount > 0) {
      setShowDiscardConfirm(true);
      return;
    }
    performDiscard();
  }, [dirtyCount, performDiscard]);

  const handleSave = useCallback(async () => {
    const { current } = inventoryRef;
    if (!current) return;

    const built = buildPatches(current);
    if (!built.ok) {
      toast({
        description: built.error,
        variant: 'destructive',
      });
      return;
    }
    if (built.patches.length === 0) {
      exitEditMode();
      return;
    }

    setSaving(true);
    try {
      const result =
        await window.electron.bulkUpdateInventoryPricesAndListPositions(
          built.patches,
        );
      setInventory((prev) =>
        prev ? applyPatchesLocally(prev, built.patches) : prev,
      );
      discardDraft();
      exitEditMode();
      toast({
        description: `Updated ${result.updated} item${
          result.updated === 1 ? '' : 's'
        }`,
        variant: 'success',
      });
    } catch (error) {
      toast({
        description: toString(error),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [
    applyPatchesLocally,
    buildPatches,
    discardDraft,
    exitEditMode,
    setSaving,
  ]);

  const columns: ColumnDef<InventoryItem>[] = useMemo(() => {
    return [
      {
        accessorKey: 'listPosition',
        header: 'List #',
        headerTooltip: 'Catalog list order (nulls sort last).',
        size: 72,
        sortingFn: listPositionSortingFn,
        enableSorting: !editMode,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => {
          if (!editMode) {
            return (
              <span className="text-xs text-muted-foreground">
                {row.original.listPosition != null
                  ? row.original.listPosition
                  : '—'}
              </span>
            );
          }
          return (
            <InventoryBulkEditCell
              inventoryId={row.original.id}
              col="listPosition"
              defaultValue={getCellDefaultValue(row.original, 'listPosition')}
              editSessionKey={editSessionKey}
              onWrite={stableWriteDraft}
              onNavigate={stableNavigate}
            />
          );
        },
      },
      {
        accessorKey: 'name',
        header: 'Name',
        size: 102,
        enableSorting: !editMode,
      },
      {
        accessorKey: 'description',
        header: 'Description',
        size: 240,
        enableSorting: !editMode,
      },
      {
        accessorKey: 'itemTypeName',
        header: 'Type',
        size: 92,
        enableSorting: !editMode,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => {
          const typeId = row.original.itemTypeId ?? 0;
          const hasOrphanType =
            typeId > 0 && !itemTypes.some((t) => t.id === typeId);

          if (editMode) {
            return (
              <span className="text-sm text-muted-foreground">
                {row.original.itemTypeName ?? 'No type'}
              </span>
            );
          }

          return (
            <Select
              value={String(typeId)}
              onValueChange={(v) => updateItemType(row.original, v)}
            >
              <SelectTrigger className="h-9 w-[180px] max-w-full">
                <SelectValue placeholder="No type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">No type</SelectItem>
                {hasOrphanType ? (
                  <SelectItem value={String(typeId)}>
                    {row.original.itemTypeName ?? `Type #${typeId}`}
                  </SelectItem>
                ) : null}
                {itemTypes.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        },
      },
      {
        accessorKey: 'price',
        header: 'Price',
        size: 88,
        enableSorting: !editMode,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => {
          if (!editMode) {
            return <span className="tabular-nums">{row.original.price}</span>;
          }
          return (
            <InventoryBulkEditCell
              inventoryId={row.original.id}
              col="price"
              defaultValue={getCellDefaultValue(row.original, 'price')}
              editSessionKey={editSessionKey}
              onWrite={stableWriteDraft}
              onNavigate={stableNavigate}
            />
          );
        },
      },
      {
        accessorKey: 'quantity',
        header: 'Quantity',
        size: 80,
        enableSorting: !editMode,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => {
          const hasHistory = itemsWithHistory.includes(row.original.id);

          return (
            <div className="flex items-center gap-1">
              {hasHistory ? (
                <Button
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => {
                    setHistoryItem(row.original);
                    setHistoryOpen(true);
                  }}
                  title="View stock history"
                  disabled={editMode}
                >
                  {row.original.quantity}
                </Button>
              ) : (
                <span>{row.original.quantity}</span>
              )}
              {hasHistory && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-amber-500"
                  aria-label="Has stock history"
                />
              )}
            </div>
          );
        },
      },
      {
        header: 'Actions',
        enableSorting: false,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {editMode ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              <>
                <AdjustStock
                  item={row.original}
                  refetchInventory={refetchInventory}
                />
                <EditInventoryItem
                  row={row}
                  refetchInventory={refetchInventory}
                />
              </>
            )}
          </div>
        ),
        size: 1,
      },
    ];
    // updateItemType closes over itemTypes/editMode; columns rebuild when those change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editMode,
    editSessionKey,
    getCellDefaultValue,
    itemTypes,
    itemsWithHistory,
    refetchInventory,
    stableNavigate,
    stableWriteDraft,
  ]);

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        {!editMode ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleEnterEdit}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit prices
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving || dirtyCount === 0}
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              Save{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDiscard}
              disabled={saving}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Discard
            </Button>
            <span className="text-xs text-muted-foreground">
              Arrow keys move cells. Changes stay until Save.
            </span>
          </>
        )}
      </div>
      <DataTable
        columns={columns}
        data={getInventory()}
        sortingFns={{
          ...defaultSortingFunctions,
          listPosition: listPositionSortingFn,
        }}
        enableSorting={!editMode}
        virtual
        virtualHeightMode="fill"
        compact
        defaultSortField="listPosition"
        searchPersistenceKey="datatable:inventory:search"
        searchPlaceholder="Search inventory..."
        searchFields={[
          'name',
          'description',
          'itemTypeName',
          'listPosition',
          'price',
          'quantity',
        ]}
        searchDisabled={editMode && dirtyCount > 0}
        autoFocusSearch={!editMode}
        virtualScrollToIndex={virtualScrollToIndex}
        onViewModelChange={handleViewModelChange}
      />
      <StockHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        item={historyItem}
      />
      <ConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
        title="Discard unsaved edits?"
        description={
          dirtyCount === 1
            ? '1 item has unsaved changes. Discarding restores previous values.'
            : `${dirtyCount} items have unsaved changes. Discarding restores previous values.`
        }
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        confirmVariant="destructive"
        onConfirm={performDiscard}
      />
    </div>
  );
};
