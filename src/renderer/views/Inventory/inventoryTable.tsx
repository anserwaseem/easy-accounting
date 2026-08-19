import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  memo,
  type MutableRefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { isNil, toString } from 'lodash';
import {
  cn,
  createListPositionSortingFn,
  defaultSortingFunctions,
} from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type {
  InventoryItem,
  ItemType,
  BulkPriceListPositionPatch,
  AttributeDefinition,
} from 'types';
import { Button } from '@/renderer/shad/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/shad/ui/select';
import { toast } from '@/renderer/shad/ui/use-toast';
import { ConfirmDialog } from '@/renderer/components/ConfirmDialog';
import { useCmdOrCtrlShortcut } from '@/renderer/hooks/useCmdOrCtrlShortcut';
import { useEscapeKey } from '@/renderer/hooks/useEscapeKey';
import type { PriceListSummary } from '@/renderer/hooks/usePublishSettings';
import { usePublishEnabled } from '@/renderer/hooks/usePublishEnabled';
import { SHOW_PUBLISH_COLUMN_KEY } from '@/renderer/hooks/usePublishColumnVisible';
import { ItemDetailPanel } from './ItemDetailPanel';
import {
  byListPosition,
  createAttributeSortingFn,
  createPriceListSortingFn,
  emptyInventoryFilters,
  formatAttributeValue,
  matchesInventoryFilters,
  type InventoryFilters,
} from './inventoryQuery';
import { InventoryFilterMenu } from './InventoryFilterMenu';
import { ColumnVisibilityMenu } from './ColumnVisibilityMenu';
import {
  PublishStatusBadge,
  PublishStatusProvider,
  usePublishStatuses,
} from './PublishStatus';
import { EditItemAttributes } from './EditItemAttributes';
import { EditInventoryItem } from './editInventoryItem';
import { AdjustStock } from './AdjustStock';
import { StockHistoryDialog } from './StockHistoryDialog';
import { InventoryBulkEditCell } from './InventoryBulkEditCell';
import { InventoryBulkEditToolbar } from './InventoryBulkEditToolbar';
import { InventoryBulkEditSaveSummary } from './InventoryBulkEditSaveSummary';
import {
  buildBulkEditChangeSummary,
  focusInventoryBulkEditCell,
  resolveNextBulkEditTarget,
  scheduleFocusInventoryBulkEditCell,
  getRowListPrice,
  priceListCol,
  type BulkEditChangeSummary,
  type InventoryBulkEditCol,
} from './inventoryBulkEdit';
import { useInventoryBulkEditDraft } from './useInventoryBulkEditDraft';

/** persisted visible price-list columns (mirrors the Accounts page approach) */
const VISIBLE_PRICE_LIST_COLUMNS_KEY = 'inventoryVisiblePriceListColumns';
const VISIBLE_ATTRIBUTE_COLUMNS_KEY = 'inventoryVisibleAttributeColumns';

const listPositionSortingFn = createListPositionSortingFn<InventoryItem>(
  (r) => r.id,
);

interface InventoryVirtualGridProps {
  columns: ColumnDef<InventoryItem>[];
  data: InventoryItem[];
  editMode: boolean;
  virtualScrollToIndex: number | null;
  onViewModelChange: (rows: InventoryItem[]) => void;
  /** includes attribute paths so search covers custom attribute values */
  searchFields: string[];
  /**
   * omitted during bulk edit: detail rows are extra Virtuoso items, which would
   * shift virtualScrollToIndex away from the row the editor means to reveal
   */
  renderRowDetail?: (item: InventoryItem) => React.ReactNode;
  isRowExpanded?: (item: InventoryItem) => boolean;
}

/** memoized so dirtyCount/saving toolbar updates do not remount Virtuoso cells */
const InventoryVirtualGrid = memo(
  ({
    columns,
    data,
    editMode,
    virtualScrollToIndex,
    onViewModelChange,
    searchFields,
    renderRowDetail,
    isRowExpanded,
  }: InventoryVirtualGridProps) => (
    <DataTable
      columns={columns}
      data={data}
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
      searchFields={searchFields}
      searchDisabled={editMode}
      autoFocusSearch={!editMode}
      virtualScrollToIndex={virtualScrollToIndex}
      onViewModelChange={onViewModelChange}
      renderRowDetail={renderRowDetail}
      isRowExpanded={isRowExpanded}
    />
  ),
);
InventoryVirtualGrid.displayName = 'InventoryVirtualGrid';

interface InventoryTableProps {
  refetchInventory: () => void;
  options: {
    refresh?: boolean;
    hideZeroQuantity?: boolean;
    hideZeroPrice?: boolean;
    hideNegativeQuantity?: boolean;
    hideNoType?: boolean;
  };
  /** DOM node in page header — toolbar portals here (no chrome state lift) */
  toolbarHost?: HTMLElement | null;
  /** notify parent so filters can lock during edit session */
  onBulkEditActiveChange?: (active: boolean) => void;
  /** notify parent which items survive the filters (scope for bulk price ops) */
  onFilteredIdsChange?: (ids: number[]) => void;
}

export const InventoryTable: React.FC<InventoryTableProps> = ({
  options,
  refetchInventory,
  toolbarHost = null,
  onBulkEditActiveChange,
  onFilteredIdsChange,
}: InventoryTableProps) => {
  // eslint-disable-next-line no-console
  const [inventory, setInventory] = useState<InventoryItem[]>();
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [priceLists, setPriceLists] = useState<PriceListSummary[]>([]);
  const [attributeDefs, setAttributeDefs] = useState<AttributeDefinition[]>([]);
  const [showPublishColumn, setShowPublishColumn] = useState<boolean>(() =>
    Boolean(window.electron.store.get(SHOW_PUBLISH_COLUMN_KEY)),
  );

  // attribute filters are view state, not a preference: they answer a question
  // being asked now, and a filter still applied next session reads as data loss
  const [inventoryFilters, setInventoryFilters] = useState<InventoryFilters>(
    emptyInventoryFilters,
  );

  // rows whose detail panel is open. Deliberately not persisted: an expanded
  // row is a "look at this one now" gesture, not a preference.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const toggleExpanded = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // publishing is optional; when it is not configured these controls describe
  // a feature this installation does not have
  const publishEnabled = usePublishEnabled() === true;
  const { statuses: publishStatuses, refresh: refreshPublishStatuses } =
    usePublishStatuses(publishEnabled && showPublishColumn);

  // publish state is derived from price, attributes, image and the hold-back
  // flag, so anything that edits a row can invalidate it
  const refetchAll = useCallback(() => {
    refetchInventory();
    refreshPublishStatuses();
  }, [refetchInventory, refreshPublishStatuses]);
  const [visibleAttributeKeys, setVisibleAttributeKeys] = useState<string[]>(
    () => {
      const stored = window.electron.store.get(VISIBLE_ATTRIBUTE_COLUMNS_KEY);
      return Array.isArray(stored) ? (stored as string[]) : [];
    },
  );
  // which price-list columns are shown; persisted like the Accounts page does
  const [visiblePriceListIds, setVisiblePriceListIds] = useState<number[]>(
    () => {
      const stored = window.electron.store.get(VISIBLE_PRICE_LIST_COLUMNS_KEY);
      return Array.isArray(stored) ? (stored as number[]) : [];
    },
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [itemsWithHistory, setItemsWithHistory] = useState<number[]>([]);
  const [virtualScrollToIndex, setVirtualScrollToIndex] = useState<
    number | null
  >(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [saveSummary, setSaveSummary] = useState<BulkEditChangeSummary | null>(
    null,
  );
  const pendingSavePatchesRef = useRef<BulkPriceListPositionPatch[]>([]);

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
    flushDirtyCount,
    getCellDefaultValue,
    buildPatches,
    applyPatchesLocally,
  } = bulkEdit;

  console.log('InventoryTable', inventory);

  useEffect(() => {
    // lock filters for whole edit session (not only after first dirty flush)
    onBulkEditActiveChange?.(editMode);
  }, [editMode, onBulkEditActiveChange]);

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

  // stable reference unless inventory/filters change — new array each render remounts Virtuoso cells
  const filteredInventory = useMemo(() => {
    const rows = inventory?.filter((i) => {
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
      if (
        !matchesInventoryFilters(
          i,
          inventoryFilters,
          (item) => publishStatuses.byId[item.id]?.state,
        )
      )
        return false;
      return true;
    });
    return byListPosition(rows || []);
  }, [
    inventory,
    options?.hideNegativeQuantity,
    options?.hideZeroQuantity,
    options?.hideZeroPrice,
    options?.hideNoType,
    inventoryFilters,
    publishStatuses,
  ]);

  // active price lists drive the optional price columns
  useEffect(() => {
    let cancelled = false;
    window.electron
      .getPriceLists()
      .then((lists) => {
        if (!cancelled) setPriceLists(lists.filter((l) => l.isActive));
        return lists;
      })
      .catch(() => {
        // price columns are optional; a failure here must not break the table
        if (!cancelled) setPriceLists([]);
      });
    return () => {
      cancelled = true;
    };
  }, [options?.refresh]);

  useEffect(() => {
    window.electron.store.set(
      VISIBLE_PRICE_LIST_COLUMNS_KEY,
      visiblePriceListIds,
    );
  }, [visiblePriceListIds]);

  // active attribute definitions drive the optional attribute columns
  useEffect(() => {
    let cancelled = false;
    window.electron
      .getAttributeDefinitions()
      .then((defs) => {
        if (!cancelled) setAttributeDefs(defs.filter((d) => d.isActive));
        return defs;
      })
      .catch(() => {
        if (!cancelled) setAttributeDefs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [options?.refresh]);

  useEffect(() => {
    window.electron.store.set(
      VISIBLE_ATTRIBUTE_COLUMNS_KEY,
      visibleAttributeKeys,
    );
  }, [visibleAttributeKeys]);

  useEffect(() => {
    window.electron.store.set(SHOW_PUBLISH_COLUMN_KEY, showPublishColumn);
  }, [showPublishColumn]);

  const toggleAttributeColumn = useCallback((key: string) => {
    setVisibleAttributeKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  const shownAttributeDefs = useMemo(
    () => attributeDefs.filter((d) => visibleAttributeKeys.includes(d.key)),
    [attributeDefs, visibleAttributeKeys],
  );

  // search covers every active attribute, whether or not its column is shown
  const searchFields = useMemo(
    () => [
      'name',
      'description',
      'itemTypeName',
      'listPosition',
      'price',
      'quantity',
      ...attributeDefs.map((def) => `attributes.${def.key}`),
    ],
    [attributeDefs],
  );

  const togglePriceListColumn = useCallback((priceListId: number) => {
    setVisiblePriceListIds((prev) =>
      prev.includes(priceListId)
        ? prev.filter((id) => id !== priceListId)
        : [...prev, priceListId],
    );
  }, []);

  // only show columns for lists that still exist and are active
  const priceListNamesById = useMemo(
    () =>
      priceLists.reduce<Record<number, string>>(
        (acc, l) => ({ ...acc, [l.id]: l.name }),
        {},
      ),
    [priceLists],
  );

  const shownPriceLists = useMemo(
    () => priceLists.filter((l) => visiblePriceListIds.includes(l.id)),
    [priceLists, visiblePriceListIds],
  );

  // report the filtered id set upward; derived from the memoized rows so this
  // fires only when filtering actually changes, not on every render
  useEffect(() => {
    onFilteredIdsChange?.(filteredInventory.map((item) => item.id));
  }, [filteredInventory, onFilteredIdsChange]);

  const writeDraftFieldRef = useRef(writeDraftField);
  writeDraftFieldRef.current = writeDraftField;

  const stableWriteDraft = useCallback(
    (inventoryId: number, col: InventoryBulkEditCol, raw: string) => {
      writeDraftFieldRef.current(inventoryId, col, raw);
    },
    [],
  );

  const flushDirtyCountRef = useRef(flushDirtyCount);
  flushDirtyCountRef.current = flushDirtyCount;

  /** true while arrow/tab navigation is moving focus — blur must not setState */
  const gridNavLockRef = useRef(false);

  const isBulkEditInput = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    target.matches('input[data-inventory-id][data-col]');

  const stableBlurCommit = useCallback(
    (
      inventoryId: number,
      col: InventoryBulkEditCol,
      raw: string,
      relatedTarget: EventTarget | null,
    ) => {
      writeDraftFieldRef.current(inventoryId, col, raw);
      // navigating to another cell: blur fires with null/body before focus lands —
      // setState here remounts Virtuoso and kills the next focus.
      if (gridNavLockRef.current) return;
      if (isBulkEditInput(relatedTarget)) return;
      flushDirtyCountRef.current();
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
    // do NOT flushDirtyCount here — setState remounts rows and steals focus
    const target = resolveNextBulkEditTarget(
      viewRowsRef.current,
      inventoryId,
      col,
      key,
      shiftKey,
    );
    if (!target) return;

    gridNavLockRef.current = true;
    const clearNavLock = () => {
      window.setTimeout(() => {
        gridNavLockRef.current = false;
      }, 0);
    };

    const mounted = document.querySelector(
      `input[data-inventory-id="${target.inventoryId}"][data-col="${target.col}"]`,
    );

    if (mounted) {
      focusInventoryBulkEditCell(target.inventoryId, target.col);
      clearNavLock();
      return;
    }

    setVirtualScrollToIndex(target.rowIndex);
    scheduleFocusInventoryBulkEditCell(target.inventoryId, target.col, 32);
    // clear scroll token after focus attempts — not in the same tick as scroll
    window.setTimeout(() => {
      setVirtualScrollToIndex(null);
      clearNavLock();
    }, 120);
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
    if (flushDirtyCount() > 0) {
      setShowDiscardConfirm(true);
      return;
    }
    performDiscard();
  }, [flushDirtyCount, performDiscard]);

  const performSave = useCallback(async () => {
    const patches = pendingSavePatchesRef.current;
    if (patches.length === 0) {
      exitEditMode();
      return;
    }

    setSaving(true);
    try {
      const result =
        await window.electron.bulkUpdateInventoryPricesAndListPositions(
          patches,
        );
      setInventory((prev) =>
        prev ? applyPatchesLocally(prev, patches) : prev,
      );
      // a price edit can add or remove the public price, which is one of the
      // conditions the publish badge reports
      refreshPublishStatuses();
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
      pendingSavePatchesRef.current = [];
      setSaveSummary(null);
    }
  }, [
    applyPatchesLocally,
    discardDraft,
    exitEditMode,
    refreshPublishStatuses,
    setSaving,
  ]);

  const handleSave = useCallback(() => {
    const { current } = inventoryRef;
    if (!current) return;

    flushDirtyCount();
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

    // summary only on Save click — O(dirty), never during typing/nav
    const originalsById = new Map(current.map((row) => [row.id, row]));
    const summary = buildBulkEditChangeSummary(originalsById, built.patches);
    pendingSavePatchesRef.current = built.patches;
    setSaveSummary(summary);
    setShowSaveConfirm(true);
  }, [buildPatches, exitEditMode, flushDirtyCount]);

  const handleShortcutSave = useCallback(() => {
    if (!editMode || saving || showSaveConfirm || showDiscardConfirm) return;
    handleSave();
  }, [editMode, handleSave, saving, showDiscardConfirm, showSaveConfirm]);

  const handleShortcutDiscard = useCallback(() => {
    if (!editMode || saving || showSaveConfirm || showDiscardConfirm) return;
    handleDiscard();
  }, [editMode, handleDiscard, saving, showDiscardConfirm, showSaveConfirm]);

  useCmdOrCtrlShortcut('s', handleShortcutSave);
  useEscapeKey(handleShortcutDiscard, editMode);

  const columns: ColumnDef<InventoryItem>[] = useMemo(() => {
    return [
      {
        id: 'expander',
        header: '',
        size: 28,
        enableSorting: false,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => {
          const isOpen = expandedIds.has(row.original.id);
          return (
            <button
              type="button"
              onClick={() => toggleExpanded(row.original.id)}
              aria-expanded={isOpen}
              aria-label={
                isOpen
                  ? `Hide details for ${row.original.name}`
                  : `Show details for ${row.original.name}`
              }
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronRight
                size={14}
                className={cn('transition-transform', isOpen && 'rotate-90')}
              />
            </button>
          );
        },
      },
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
              onBlurCommit={stableBlurCommit}
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
              onBlurCommit={stableBlurCommit}
              onNavigate={stableNavigate}
            />
          );
        },
      },
      ...shownPriceLists.map<ColumnDef<InventoryItem>>((list) => {
        const col = priceListCol(list.id);
        return {
          id: col,
          header: list.name,
          headerTooltip: `Price on the "${list.name}" price list. Blank means this item is not priced on it.`,
          size: 96,
          enableSorting: !editMode,
          sortingFn: createPriceListSortingFn((item) =>
            getRowListPrice(item, list.id),
          ),
          accessorFn: (item) => getRowListPrice(item, list.id) ?? undefined,
          // eslint-disable-next-line react/no-unstable-nested-components
          cell: ({ row }) => {
            const stored = getRowListPrice(row.original, list.id);
            if (!editMode) {
              return (
                <span className="tabular-nums">
                  {stored == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    stored
                  )}
                </span>
              );
            }
            return (
              <InventoryBulkEditCell
                inventoryId={row.original.id}
                col={col}
                defaultValue={getCellDefaultValue(row.original, col)}
                editSessionKey={editSessionKey}
                onWrite={stableWriteDraft}
                onBlurCommit={stableBlurCommit}
                onNavigate={stableNavigate}
              />
            );
          },
        };
      }),
      ...shownAttributeDefs.map<ColumnDef<InventoryItem>>((def) => ({
        id: `attr:${def.key}`,
        header: def.unit ? `${def.label} (${def.unit})` : def.label,
        size: 110,
        enableSorting: !editMode,
        sortingFn: createAttributeSortingFn(def),
        accessorFn: (item) => formatAttributeValue(item.attributes?.[def.key]),
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => {
          const text = formatAttributeValue(row.original.attributes?.[def.key]);
          return text ? (
            <span className="text-xs">{text}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        },
      })),
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
      ...(publishEnabled && showPublishColumn
        ? [
            {
              id: 'displayTitle',
              header: 'Display title',
              size: 220,
              enableSorting: false,
              // eslint-disable-next-line react/no-unstable-nested-components, react/no-unused-prop-types
              cell: ({
                row,
                column,
              }: {
                row: { original: InventoryItem };
                // eslint-disable-next-line react/no-unused-prop-types
                column: { getSize: () => number };
              }) =>
                row.original.title ? (
                  <span
                    className="block whitespace-normal break-words"
                    style={{ maxWidth: column.getSize() }}
                  >
                    {row.original.title}
                  </span>
                ) : (
                  // an empty cell would read as missing data; this is the
                  // ordinary state, and says what happens instead
                  <span className="text-xs italic text-muted-foreground">
                    from item name
                  </span>
                ),
            },
            {
              id: 'publishState',
              header: 'Publish',
              size: 150,
              enableSorting: false,
              headerTooltip:
                'Filter by publish state using the Filters button.',
              // eslint-disable-next-line react/no-unstable-nested-components, react/no-unused-prop-types
              cell: ({ row }: { row: { original: InventoryItem } }) => (
                <PublishStatusBadge itemId={row.original.id} />
              ),
            },
          ]
        : []),
      {
        header: 'Actions',
        enableSorting: false,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          // -ml-2 cancels the icon buttons' internal padding so the first
          // glyph lines up with the "Actions" header text rather than sitting
          // 8px inside it
          <div className="-ml-2 flex items-center gap-0.5 whitespace-nowrap">
            {editMode ? (
              <span className="ml-2 text-xs text-muted-foreground">—</span>
            ) : (
              <>
                <AdjustStock
                  item={row.original}
                  refetchInventory={refetchInventory}
                />
                <EditItemAttributes
                  item={row.original}
                  onUpdated={refetchAll}
                />
                <EditInventoryItem
                  row={row}
                  refetchInventory={refetchAll}
                  refreshPublishStatuses={refreshPublishStatuses}
                  showPublishControls={publishEnabled && showPublishColumn}
                  priceLists={priceLists}
                />
              </>
            )}
          </div>
        ),
        // three 32px icon buttons + gaps; a shrink-to-fit width made the third
        // button overflow the column
        size: 112,
      },
    ];
    // updateItemType closes over itemTypes/editMode; columns rebuild when those
    // change. This list is maintained by hand (exhaustive-deps is off below),
    // so anything a column definition reads MUST be added here — a cell that
    // closes over state missing from this list silently renders the value from
    // whenever the memo last ran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editMode,
    editSessionKey,
    getCellDefaultValue,
    itemTypes,
    itemsWithHistory,
    refetchInventory,
    refetchAll,
    refreshPublishStatuses,
    stableBlurCommit,
    stableNavigate,
    stableWriteDraft,
    shownPriceLists,
    // the edit dialog offers every active list, not only the shown columns
    priceLists,
    shownAttributeDefs,
    publishEnabled,
    showPublishColumn,
    publishStatuses,
    expandedIds,
    toggleExpanded,
  ]);

  // the panel lists every active attribute and price list the item has a value
  // for, so it stays useful even while those columns are hidden from the grid
  const renderRowDetail = useCallback(
    (item: InventoryItem) => (
      <ItemDetailPanel item={item} attributeDefs={attributeDefs} />
    ),
    [attributeDefs],
  );

  const isRowExpanded = useCallback(
    (item: InventoryItem) => expandedIds.has(item.id),
    [expandedIds],
  );

  // one picker for every optional column, rendered in the page header so the
  // grid keeps its vertical space regardless of how many lists/attributes exist
  const columnGroups = useMemo(
    () => [
      {
        title: 'Price lists',
        options: priceLists.map((l) => ({ id: String(l.id), label: l.name })),
        selectedIds: visiblePriceListIds.map(String),
        onToggle: (id: string) => togglePriceListColumn(Number(id)),
        onSetAll: (ids: string[]) => setVisiblePriceListIds(ids.map(Number)),
      },
      {
        title: 'Attributes',
        options: attributeDefs.map((d) => ({ id: d.key, label: d.label })),
        selectedIds: visibleAttributeKeys,
        onToggle: toggleAttributeColumn,
        onSetAll: setVisibleAttributeKeys,
      },
      ...(publishEnabled
        ? [
            {
              title: 'Publishing',
              // one switch, not two: the display title is publishing work, so
              // it appears and disappears with the publish state rather than
              // being a third thing to discover and manage
              options: [{ id: 'publishState', label: 'Publish status' }],
              selectedIds: showPublishColumn ? ['publishState'] : [],
              onToggle: () => setShowPublishColumn((prev) => !prev),
              onSetAll: (ids: string[]) => setShowPublishColumn(ids.length > 0),
            },
          ]
        : []),
    ],
    [
      priceLists,
      visiblePriceListIds,
      togglePriceListColumn,
      attributeDefs,
      visibleAttributeKeys,
      toggleAttributeColumn,
      publishEnabled,
      showPublishColumn,
    ],
  );

  const toolbar = (
    <>
      {!editMode ? (
        <>
          <ColumnVisibilityMenu groups={columnGroups} disabled={editMode} />
          <InventoryFilterMenu
            attributeDefs={attributeDefs}
            items={inventory ?? []}
            filters={inventoryFilters}
            onChange={setInventoryFilters}
            publishEnabled={publishEnabled && showPublishColumn}
            disabled={editMode}
          />
        </>
      ) : null}
      <InventoryBulkEditToolbar
        editMode={editMode}
        dirtyCount={dirtyCount}
        saving={saving}
        onEnterEdit={handleEnterEdit}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </>
  );

  return (
    <div className="pt-1">
      {toolbarHost ? createPortal(toolbar, toolbarHost) : null}
      {/* statuses flow through context so a refresh re-renders only the badges;
          putting them in the column definitions remounted every cell, which
          destroyed any dialog a user had open inside one */}
      <PublishStatusProvider value={publishStatuses}>
        <InventoryVirtualGrid
          columns={columns}
          data={filteredInventory}
          editMode={editMode}
          virtualScrollToIndex={virtualScrollToIndex}
          onViewModelChange={handleViewModelChange}
          searchFields={searchFields}
          renderRowDetail={editMode ? undefined : renderRowDetail}
          isRowExpanded={editMode ? undefined : isRowExpanded}
        />
      </PublishStatusProvider>
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
      <ConfirmDialog
        open={showSaveConfirm}
        onOpenChange={(open) => {
          setShowSaveConfirm(open);
          if (!open) {
            pendingSavePatchesRef.current = [];
            setSaveSummary(null);
          }
        }}
        title={
          saveSummary && saveSummary.itemCount === 1
            ? 'Save changes to 1 item?'
            : `Save changes to ${saveSummary?.itemCount ?? 0} items?`
        }
        description={
          saveSummary ? (
            <InventoryBulkEditSaveSummary
              summary={saveSummary}
              priceListNames={priceListNamesById}
            />
          ) : (
            'Save price and list # changes?'
          )
        }
        contentClassName="flex max-h-[80vh] w-[min(48rem,80vw)] max-w-[80vw] flex-col gap-4 overflow-hidden sm:max-w-[80vw]"
        confirmLabel="Save"
        cancelLabel="Keep editing"
        onConfirm={() => {
          performSave().catch(() => undefined);
        }}
      />
    </div>
  );
};
