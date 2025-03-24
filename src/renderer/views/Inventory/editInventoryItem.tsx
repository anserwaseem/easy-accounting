import { PenBox } from 'lucide-react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from 'renderer/shad/ui/dialog';
import { toast } from 'renderer/shad/ui/use-toast';
import type { UpdateInventoryItem } from '@/types';
import { useState } from 'react';
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
  const defaultValues = row.original;

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
        <PenBox
          size={16}
          onClick={() => setIsOpen(true)}
          cursor="pointer"
          className="py-0"
        />
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
        />
      </DialogContent>
    </Dialog>
  );
};
