import { memo, useCallback, useState } from 'react';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import type { InventoryBulkEditCol } from './inventoryBulkEdit';

interface FamilyOption {
  id: number;
  name: string;
}

interface InventoryBulkFamilyCellProps {
  inventoryId: number;
  parentId: number | null;
  options: FamilyOption[];
  onWrite: (
    inventoryId: number,
    col: InventoryBulkEditCol,
    raw: string,
  ) => void;
  onCommit: () => void;
}

const InventoryBulkFamilyCellComponent: React.FC<
  InventoryBulkFamilyCellProps
> = ({
  inventoryId,
  parentId,
  options,
  onWrite,
  onCommit,
}: InventoryBulkFamilyCellProps) => {
  const [value, setValue] = useState(parentId ?? 0);

  const handleChange = useCallback(
    (nextValue: string | number) => {
      const nextId = Number(nextValue);
      setValue(nextId);
      onWrite(inventoryId, 'parentId', nextId > 0 ? String(nextId) : '');
      onCommit();
    },
    [inventoryId, onCommit, onWrite],
  );

  return (
    <VirtualSelect
      options={options}
      value={value}
      onChange={handleChange}
      placeholder="No family"
      searchPlaceholder="Search family heads..."
      triggerClassName="h-8"
    />
  );
};

export const InventoryBulkFamilyCell = memo(InventoryBulkFamilyCellComponent);
