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
import { useEffect, useMemo, useState } from 'react';
import type { InsertInventoryItem, ItemType } from '@/types';
import { makeAddInventorySchema } from './inventorySchemas';
import { InventoryForm } from './InventoryForm';

interface AddInventoryItemProps {
  refetchInventory: () => void;
}

export const AddInventoryItem: React.FC<AddInventoryItemProps> = ({
  refetchInventory,
}: AddInventoryItemProps) => {
  const [openCreateForm, setOpenCreateForm] = useState(false);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [reservedNameChars, setReservedNameChars] = useState('');

  const defaultValues = {
    name: '',
    description: undefined,
    price: 0,
    itemTypeId: undefined,
    listPosition: undefined as number | undefined,
  };

  // load active item types each time create dialog opens, plus the characters
  // this installation reserves so the name field can reject them inline
  useEffect(() => {
    if (!openCreateForm) return;
    (async () => {
      const rows = await window.electron.getItemTypes();
      setItemTypes(rows.filter((row) => row.isActive));
      const config = await window.electron.getPublishConfig();
      setReservedNameChars(config.reservedNameChars ?? '');
    })();
  }, [openCreateForm]);

  const schema = useMemo(
    () => makeAddInventorySchema(reservedNameChars),
    [reservedNameChars],
  );

  const onSubmit = async (values: InsertInventoryItem) => {
    try {
      const res = await window.electron.insertInventoryItem({ ...values });
      if (res) {
        setOpenCreateForm(false);
        refetchInventory();
        toast({
          description: 'Inventory Item created successfully',
          variant: 'success',
        });
        return;
      }
      toast({
        description: 'Inventory Item not created',
        variant: 'destructive',
      });
    } catch (error) {
      // the service rejects some names the form cannot know about; show the
      // reason rather than letting it surface as a raw IPC error dialog
      toast({
        description: (error as Error)?.message ?? 'Inventory Item not created',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={openCreateForm} onOpenChange={setOpenCreateForm}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          title="Add inventory item"
        >
          <Plus size={16} className="mr-1.5" />
          New item
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Inventory Item</DialogTitle>
        </DialogHeader>
        <InventoryForm
          schema={schema}
          defaultValues={defaultValues}
          onSubmit={onSubmit}
          itemTypes={itemTypes}
        />
      </DialogContent>
    </Dialog>
  );
};
