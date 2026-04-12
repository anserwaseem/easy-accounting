import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from 'renderer/shad/ui/dialog';
import { Button } from 'renderer/shad/ui/button';
import { toast } from 'renderer/shad/ui/use-toast';
import { useEffect, useState } from 'react';
import type { InsertInventoryItem, ItemType } from '@/types';
import { addInventorySchema } from './inventorySchemas';
import { InventoryForm } from './InventoryForm';

interface AddInventoryItemProps {
  refetchInventory: () => void;
}

export const AddInventoryItem: React.FC<AddInventoryItemProps> = ({
  refetchInventory,
}: AddInventoryItemProps) => {
  const [openCreateForm, setOpenCreateForm] = useState(false);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);

  const defaultValues = {
    name: '',
    description: undefined,
    price: 0,
    itemTypeId: undefined,
    listPosition: undefined as number | undefined,
  };

  // load active item types each time create dialog opens.
  useEffect(() => {
    if (!openCreateForm) return;
    (async () => {
      const rows = await window.electron.getItemTypes();
      setItemTypes(rows.filter((row) => row.isActive));
    })();
  }, [openCreateForm]);

  const onSubmit = async (values: InsertInventoryItem) => {
    const res = await window.electron.insertInventoryItem({ ...values });

    if (res) {
      setOpenCreateForm(false);
      refetchInventory();
      toast({
        description: 'Inventory Item created successfully',
        variant: 'success',
      });
    } else {
      toast({
        description: 'Inventory Item not created',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={openCreateForm} onOpenChange={setOpenCreateForm}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-fit">
          <Plus size={16} className="mr-1.5" />
          New Inventory Item
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Inventory Item</DialogTitle>
        </DialogHeader>
        <InventoryForm
          schema={addInventorySchema}
          defaultValues={defaultValues}
          onSubmit={onSubmit}
          itemTypes={itemTypes}
        />
      </DialogContent>
    </Dialog>
  );
};
