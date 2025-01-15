import { useState, useEffect, useCallback } from 'react';
import { defaultSortingFunctions } from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { InventoryItem } from 'types';
import { EditInventoryItem } from './editInventoryItem';

interface InventoryTableProps {
  options: { refresh?: boolean; hideZeroQuantity?: boolean };
}
export const InventoryTable: React.FC<InventoryTableProps> = ({
  options,
}: InventoryTableProps) => {
  // eslint-disable-next-line no-console
  console.log('InventoryTable');
  const [inventory, setInventory] = useState<InventoryItem[]>();

  const fetchInventory = useCallback(async () => {
    setInventory(await window.electron.getInventory());
  }, []);
  console.log('InventoryTable', inventory);

  useEffect(() => {
    fetchInventory();
  }, [options?.refresh, fetchInventory]);

  const getInventory = () =>
    (options?.hideZeroQuantity
      ? inventory?.filter((i) => i.quantity > 0)
      : inventory) || [];

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
    },
    {
      header: 'Edit',
      // eslint-disable-next-line react/no-unstable-nested-components
      cell: ({ row }) => (
        <EditInventoryItem row={row} refetchInventory={fetchInventory} />
      ),
    },
  ];

  return (
    <div className="py-10">
      <DataTable
        columns={columns}
        data={getInventory()}
        sortingFns={defaultSortingFunctions}
      />
    </div>
  );
};
