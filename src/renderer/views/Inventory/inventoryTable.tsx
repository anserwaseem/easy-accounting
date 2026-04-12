import { useState, useEffect } from 'react';
import { isNil } from 'lodash';
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
import { EditInventoryItem } from './editInventoryItem';
import { AdjustStock } from './AdjustStock';
import { StockHistoryDialog } from './StockHistoryDialog';

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
}
export const InventoryTable: React.FC<InventoryTableProps> = ({
  options,
  refetchInventory,
}: InventoryTableProps) => {
  // eslint-disable-next-line no-console
  const [inventory, setInventory] = useState<InventoryItem[]>();
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [itemsWithHistory, setItemsWithHistory] = useState<number[]>([]);
  console.log('InventoryTable', inventory);

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

  const getInventory = () => {
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
        // hide items that don't have an associated type
        const hasItemType = !isNil(i.itemTypeId) && Number(i.itemTypeId) > 0;
        if (!hasItemType) return false;
      }
      return true;
    });
    return filteredInventory || [];
  };

  const columns: ColumnDef<InventoryItem>[] = [
    {
      accessorKey: 'listPosition',
      header: 'List #',
      headerTooltip: 'Catalog list order (nulls sort last).',
      size: 40,
      sortingFn: listPositionSortingFn,
      // eslint-disable-next-line react/no-unstable-nested-components
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.listPosition != null ? row.original.listPosition : '—'}
        </span>
      ),
    },
    {
      accessorKey: 'name',
      header: 'Name',
      size: 102,
    },
    {
      accessorKey: 'description',
      header: 'Description',
      size: 240,
    },
    {
      accessorKey: 'itemTypeName',
      header: 'Type',
      size: 92,
      // eslint-disable-next-line react/no-unstable-nested-components
      cell: ({ row }) => {
        const typeId = row.original.itemTypeId ?? 0;
        const hasOrphanType =
          typeId > 0 && !itemTypes.some((t) => t.id === typeId);

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
      size: 72,
    },
    {
      accessorKey: 'quantity',
      header: 'Quantity',
      size: 80,
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
      // eslint-disable-next-line react/no-unstable-nested-components
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <AdjustStock
            item={row.original}
            refetchInventory={refetchInventory}
          />
          <EditInventoryItem row={row} refetchInventory={refetchInventory} />
        </div>
      ),
      size: 1,
    },
  ];

  return (
    <div className="pt-1">
      <DataTable
        columns={columns}
        data={getInventory()}
        sortingFns={{
          ...defaultSortingFunctions,
          listPosition: listPositionSortingFn,
        }}
        virtual
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
        autoFocusSearch
      />
      <StockHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        item={historyItem}
      />
    </div>
  );
};
