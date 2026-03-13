import { useEffect, useMemo, useState } from 'react';
import { Plus, Settings } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/renderer/shad/ui/dialog';
import { Input } from '@/renderer/shad/ui/input';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { toast } from '@/renderer/shad/ui/use-toast';
import type { ItemType } from '@/types';

interface ManageItemTypesProps {
  onUpdated?: () => void;
}

export const ManageItemTypes: React.FC<ManageItemTypesProps> = ({
  onUpdated,
}: ManageItemTypesProps) => {
  const [open, setOpen] = useState(false);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [newTypeName, setNewTypeName] = useState('');
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});

  const loadItemTypes = async () => {
    const result = await window.electron.getItemTypes();
    setItemTypes(result);
    setNameDrafts(
      result.reduce(
        (acc, itemType) => ({
          ...acc,
          [itemType.id]: itemType.name,
        }),
        {},
      ),
    );
  };

  // fetch item types whenever modal opens so list stays fresh.
  useEffect(() => {
    if (!open) return;
    loadItemTypes();
  }, [open]);

  const activeCount = useMemo(
    () => itemTypes.filter((itemType) => itemType.isActive).length,
    [itemTypes],
  );

  const handleAddType = async () => {
    const name = newTypeName.trim();
    if (!name) return;

    const created = await window.electron.insertItemType(name);
    if (!created) {
      toast({
        description: 'Failed to add item type',
        variant: 'destructive',
      });
      return;
    }

    setNewTypeName('');
    await loadItemTypes();
    onUpdated?.();
    toast({
      description: 'Item type created',
      variant: 'success',
    });
  };

  const handleRenameType = async (itemType: ItemType) => {
    const nextName = nameDrafts[itemType.id]?.trim() ?? '';
    if (!nextName || nextName === itemType.name) return;

    const updated = await window.electron.updateItemTypeName(
      itemType.id,
      nextName,
    );
    if (!updated) {
      toast({
        description: 'Failed to rename item type',
        variant: 'destructive',
      });
      return;
    }

    await loadItemTypes();
    onUpdated?.();
    toast({
      description: 'Item type updated',
      variant: 'success',
    });
  };

  const handleToggleType = async (itemType: ItemType, isActive: boolean) => {
    const updated = await window.electron.toggleItemTypeActive(
      itemType.id,
      isActive,
    );
    if (!updated) {
      toast({
        description: 'Failed to update item type status',
        variant: 'destructive',
      });
      return;
    }

    await loadItemTypes();
    onUpdated?.();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings size={16} className="mr-1.5" />
          Manage Item Types
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>{`Item Types (${activeCount} active)`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              placeholder="New item type name"
            />
            <Button type="button" onClick={handleAddType}>
              <Plus size={16} className="mr-1.5" />
              Add
            </Button>
          </div>

          <div className="max-h-[420px] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="px-3 py-2">Type Name</th>
                  <th className="px-3 py-2 w-24">Active</th>
                  <th className="px-3 py-2 w-24 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {itemTypes.map((itemType) => (
                  <tr key={itemType.id} className="border-t">
                    <td className="px-3 py-2">
                      <Input
                        value={nameDrafts[itemType.id] ?? itemType.name}
                        onChange={(e) =>
                          setNameDrafts((prev) => ({
                            ...prev,
                            [itemType.id]: e.target.value,
                          }))
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={!!itemType.isActive}
                        onCheckedChange={(checked) =>
                          handleToggleType(itemType, checked === true)
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleRenameType(itemType)}
                      >
                        Save
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
