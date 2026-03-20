import { useState, useEffect, useMemo } from 'react';
import { isNil } from 'lodash';
import { defaultSortingFunctions } from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { InventoryItem, ItemType } from 'types';
import { Button } from '@/renderer/shad/ui/button';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { toast } from '@/renderer/shad/ui/use-toast';
import { EditInventoryItem } from './editInventoryItem';
import { AdjustStock } from './AdjustStock';
import { StockHistoryDialog } from './StockHistoryDialog';

const NO_ITEM_TYPE_OPTION = { id: 0, name: 'No type' };

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

  const itemTypeOptions = useMemo(
    () => [NO_ITEM_TYPE_OPTION, ...itemTypes],
    [itemTypes],
  );

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
      accessorKey: 'name',
      header: 'Name',
    },
    {
      accessorKey: 'description',
      header: 'Description',
    },
    {
      accessorKey: 'itemTypeName',
      header: 'Type',
      // eslint-disable-next-line react/no-unstable-nested-components
      cell: ({ row }) => (
        <div className="min-w-[160px]">
          <VirtualSelect
            options={itemTypeOptions}
            value={row.original.itemTypeId ?? 0}
            onChange={(value) => {
              updateItemType(row.original, value);
            }}
            placeholder="Select type"
            searchPlaceholder="Search types..."
          />
        </div>
      ),
    },
    {
      accessorKey: 'price',
      header: 'Price',
    },
    {
      accessorKey: 'quantity',
      header: 'Quantity',
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
        sortingFns={defaultSortingFunctions}
        virtual
        searchPlaceholder="Search inventory..."
        searchFields={[
          'name',
          'description',
          'itemTypeName',
          'price',
          'quantity',
        ]}
      />
      <StockHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        item={historyItem}
      />
    </div>
  );
};
