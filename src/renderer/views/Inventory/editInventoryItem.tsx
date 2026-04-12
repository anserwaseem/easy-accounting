import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from 'renderer/shad/ui/dialog';
import { EditActionButton } from '@/renderer/components/EditActionButton';
import { toast } from 'renderer/shad/ui/use-toast';
import type { UpdateInventoryItem, ItemType } from '@/types';
import { useEffect, useState } from 'react';
import { editInventorySchema } from './inventorySchemas';
import { InventoryForm } from './InventoryForm';

interface EditInventoryItemProps {
  row: {
    original: UpdateInventoryItem;
  };
  refetchInventory: () => void;
}

export const EditInventoryItem: React.FC<EditInventoryItemProps> = ({
  row,
  refetchInventory,
}: EditInventoryItemProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const defaultValues: UpdateInventoryItem = {
    id: row.original.id,
    name: row.original.name,
    quantity: row.original.quantity,
    price: row.original.price,
    description: row.original.description,
    itemTypeId: row.original.itemTypeId,
    listPosition: row.original.listPosition ?? null,
  };

  // load active item types each time edit dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const rows = await window.electron.getItemTypes();
      setItemTypes(rows.filter((itemType) => itemType.isActive));
    })();
  }, [isOpen]);

  const onEdit = async (values: UpdateInventoryItem) => {
    const res = await window.electron.updateInventoryItem({ ...values });

    if (res) {
      refetchInventory();
      setIsOpen(false);
      toast({
        description: 'Inventory Item updated successfully',
        variant: 'success',
      });
    } else {
      toast({
        description: 'Inventory Item not updated',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <EditActionButton aria-label="Edit inventory item" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Inventory Item</DialogTitle>
        </DialogHeader>
        <InventoryForm
          schema={editInventorySchema}
          defaultValues={defaultValues}
          onSubmit={onEdit}
          disabledFields={['name', 'quantity']}
          itemTypes={itemTypes}
        />
      </DialogContent>
    </Dialog>
  );
};
