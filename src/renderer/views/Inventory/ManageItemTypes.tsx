import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Settings, Trash2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/renderer/shad/ui/alert';
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
import { Label } from '@/renderer/shad/ui/label';
import { RadioGroup, RadioGroupItem } from '@/renderer/shad/ui/radio-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/renderer/shad/ui/tooltip';
import { toast } from '@/renderer/shad/ui/use-toast';
import type { ItemType } from '@/types';

interface ManageItemTypesProps {
  onUpdated?: () => void;
  /** when true on first mount, opens the dialog (e.g. deep-link from New Sale Invoice) */
  initialOpen?: boolean;
}

export const ManageItemTypes: React.FC<ManageItemTypesProps> = ({
  onUpdated,
  initialOpen = false,
}: ManageItemTypesProps) => {
  const [open, setOpen] = useState(initialOpen);
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

  const getUsage = (itemType: ItemType): number =>
    Number(itemType.inventoryCount ?? 0);

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

  const handleDeleteType = async (itemType: ItemType) => {
    const usage = getUsage(itemType);
    if (usage > 0) {
      toast({
        description:
          'Cannot delete item type while inventory items are using it',
        variant: 'destructive',
      });
      return;
    }

    const deleted = await window.electron.deleteItemType(itemType.id);
    if (!deleted) {
      toast({
        description: 'Failed to delete item type',
        variant: 'destructive',
      });
      return;
    }

    await loadItemTypes();
    onUpdated?.();
    toast({
      description: 'Item type deleted',
      variant: 'success',
    });
  };

  const primaryId = useMemo(
    () => itemTypes.find((t) => t.isPrimary)?.id,
    [itemTypes],
  );
  const primaryValue = primaryId === undefined ? 'none' : String(primaryId);

  const handlePrimaryChange = async (value: string) => {
    if (value === 'none') {
      const updated = await window.electron.clearPrimaryItemType();
      if (!updated) {
        toast({
          description: 'Failed to clear primary item type',
          variant: 'destructive',
        });
        return;
      }
      await loadItemTypes();
      onUpdated?.();
      toast({
        description: 'Primary cleared; all rows will be dealt as primary',
        variant: 'success',
      });
      return;
    }
    const id = Number(value);
    if (id === primaryId) return;
    const updated = await window.electron.setPrimaryItemType(id);
    if (!updated) {
      toast({
        description: 'Failed to set primary item type',
        variant: 'destructive',
      });
      return;
    }
    await loadItemTypes();
    onUpdated?.();
    const name = itemTypes.find((t) => t.id === id)?.name ?? 'Item type';
    toast({
      description: `${name} is now the primary item type`,
      variant: 'success',
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings size={16} className="mr-1.5" />
          Manage Item Types
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Item types</DialogTitle>
        </DialogHeader>

        <TooltipProvider>
          <div className="space-y-5">
            {/* Primary type: single choice with None */}
            <section className="rounded-lg border bg-muted/40 p-3">
              <Label className="text-muted-foreground mb-2 block text-xs font-medium">
                Primary type (for sale invoice split-by-type)
              </Label>
              <RadioGroup
                value={primaryValue}
                onValueChange={handlePrimaryChange}
                className="flex flex-wrap gap-x-4 gap-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="none" id="primary-none" />
                  <Label htmlFor="primary-none" className="font-normal">
                    None
                  </Label>
                </div>
                {itemTypes
                  .filter((t) => t.isActive)
                  .map((itemType) => (
                    <div
                      key={itemType.id}
                      className="flex items-center space-x-2"
                    >
                      <RadioGroupItem
                        value={String(itemType.id)}
                        id={`primary-${itemType.id}`}
                      />
                      <Label
                        htmlFor={`primary-${itemType.id}`}
                        className="font-normal"
                      >
                        {itemType.name}
                      </Label>
                    </div>
                  ))}
              </RadioGroup>
              {primaryValue === 'none' && (
                <Alert variant="warning" className="mt-2 items-start py-2">
                  <AlertTriangle aria-hidden />
                  <div className="min-w-0">
                    <AlertTitle className="text-xs">
                      primary item type is not set
                    </AlertTitle>
                    <AlertDescription className="text-xs text-amber-900/80 dark:text-amber-100/80">
                      Sale invoice split-by-item-type will not be able to post
                      to typed ledgers.
                    </AlertDescription>
                  </div>
                </Alert>
              )}
            </section>

            {/* Add new type */}
            <section>
              <Label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                Add type
              </Label>
              <div className="flex gap-2 items-center">
                <Input
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  placeholder="Type name"
                  className="flex-1"
                />
                <Button type="button" onClick={handleAddType}>
                  <Plus size={16} className="mr-1.5" />
                  Add
                </Button>
              </div>
            </section>

            {/* List of types */}
            <section>
              <div className="text-muted-foreground mb-2 flex items-center justify-between text-xs">
                <span className="font-medium">
                  Types ({activeCount} active)
                </span>
              </div>
              <div className="max-h-[320px] overflow-y-auto rounded-lg border">
                {itemTypes.length === 0 ? (
                  <div className="text-muted-foreground py-8 text-center text-sm">
                    No item types yet. Add one above.
                  </div>
                ) : (
                  <ul className="divide-y">
                    {itemTypes.map((itemType) => {
                      const usage = getUsage(itemType);
                      const currentName =
                        nameDrafts[itemType.id] ?? itemType.name;
                      return (
                        <li
                          key={itemType.id}
                          className="flex flex-wrap items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/30"
                        >
                          <Input
                            value={currentName}
                            onChange={(e) =>
                              setNameDrafts((prev) => ({
                                ...prev,
                                [itemType.id]: e.target.value,
                              }))
                            }
                            className="h-8 w-[140px]"
                          />
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {usage} item{usage !== 1 ? 's' : ''}
                          </span>
                          <div className="flex shrink-0 items-center gap-2">
                            <Checkbox
                              id={`active-${itemType.id}`}
                              checked={!!itemType.isActive}
                              onCheckedChange={(checked) =>
                                handleToggleType(itemType, checked === true)
                              }
                            />
                            <Label
                              htmlFor={`active-${itemType.id}`}
                              className="text-muted-foreground cursor-pointer text-xs"
                            >
                              Active
                            </Label>
                          </div>
                          <div className="ml-auto flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => handleRenameType(itemType)}
                            >
                              Save
                            </Button>
                            {usage > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground"
                                      disabled
                                      aria-label="Delete (disabled: in use)"
                                    >
                                      <Trash2 size={14} />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {usage} item{usage !== 1 ? 's' : ''} in use.
                                  Remove from items first to delete.
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => handleDeleteType(itemType)}
                                aria-label={`Delete ${itemType.name}`}
                              >
                                <Trash2 size={14} />
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
};
