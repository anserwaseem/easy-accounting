import { useState, useEffect } from 'react';
import { defaultSortingFunctions } from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { InventoryItem } from 'types';
import { Button } from '@/renderer/shad/ui/button';
import { EditInventoryItem } from './editInventoryItem';
import { AdjustStock } from './AdjustStock';
import { StockHistoryDialog } from './StockHistoryDialog';

interface InventoryTableProps {
  refetchInventory: () => void;
  options: {
    refresh?: boolean;
    hideZeroQuantity?: boolean;
    hideZeroPrice?: boolean;
    hideNegativeQuantity?: boolean;
  };
}
export const InventoryTable: React.FC<InventoryTableProps> = ({
  options,
  refetchInventory,
}: InventoryTableProps) => {
  // eslint-disable-next-line no-console
  const [inventory, setInventory] = useState<InventoryItem[]>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [itemsWithHistory, setItemsWithHistory] = useState<number[]>([]);
  console.log('InventoryTable', inventory);

  useEffect(() => {
    const fetchInventory = async () => {
      const [fetchedInventory, idsWithHistory] = await Promise.all([
        window.electron.getInventory(),
        window.electron.getInventoryIdsWithHistory(),
      ]);

      setInventory(fetchedInventory);
      setItemsWithHistory(idsWithHistory);
    };
    fetchInventory();
  }, [options?.refresh]);

  const getInventory = () => {
    const filteredInventory = inventory?.filter((i) => {
      if (options?.hideZeroQuantity && options?.hideZeroPrice) {
        return i.quantity > 0 && i.price > 0;
      }
      if (options?.hideZeroQuantity) {
        return i.quantity > 0;
      }
      if (options?.hideZeroPrice) {
        return i.price > 0;
      }
      if (options?.hideNegativeQuantity) {
        return i.quantity >= 0;
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
        searchFields={['name', 'description', 'price', 'quantity']}
      />
      <StockHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        item={historyItem}
      />
    </div>
  );
};
