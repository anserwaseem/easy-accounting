import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogDescription,
  DialogFooter,
} from 'renderer/shad/ui/dialog';
import { Button } from '@/renderer/shad/ui/button';
import { EditActionButton } from '@/renderer/components/EditActionButton';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Label } from '@/renderer/shad/ui/label';
import { toast } from 'renderer/shad/ui/use-toast';
import type { UpdateInventoryItem, ItemType, InventoryItem } from '@/types';
import { useEffect, useMemo, useState } from 'react';
import {
  Trash2,
  Ban,
  Power,
  Info,
  MoreHorizontal,
  Tag,
  SlidersHorizontal,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/shad/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/renderer/shad/ui/tooltip';
import type { PriceListSummary } from '@/renderer/hooks/usePublishSettings';
import { AdjustStock } from './AdjustStock';
import { EditItemAttributes } from './EditItemAttributes';
import { editInventorySchema } from './inventorySchemas';
import { InventoryForm } from './InventoryForm';
import { ItemPriceLists } from './ItemPriceLists';
import { FamilyHeadPicker } from './FamilyHeadPicker';
import { changedListPrices, getRowListPrice } from './inventoryBulkEdit';

interface EditInventoryItemProps {
  row: {
    original: UpdateInventoryItem & {
      excludeFromCatalog?: 0 | 1;
      parentId?: number | null;
      isActive?: boolean | 0 | 1;
    };
  };
  refetchInventory: () => void;
  /** refreshes only the publish badges — safe to call with the dialog open */
  refreshPublishStatuses?: () => void;
  /**
   * Whether to offer the publish hold-back control.
   *
   * Passed in rather than read here: this dialog renders once per row, so
   * asking for the publish config inside it meant one IPC round trip per
   * visible row, repeated on every scroll. It also ties the control to the
   * Publish column — one switch decides whether publishing shows up on this
   * page at all, instead of two things appearing independently.
   */
  showPublishControls?: boolean;
  /**
   * Active price lists, passed in for the same reason as showPublishControls:
   * this dialog renders once per row, so loading them here would be one IPC
   * round trip per visible row on every scroll.
   */
  priceLists?: PriceListSummary[];
  /** all inventory rows — used to pick a family head for orphans */
  inventoryItems?: InventoryItem[];
}

export const EditInventoryItem: React.FC<EditInventoryItemProps> = ({
  row,
  refetchInventory,
  refreshPublishStatuses,
  showPublishControls = false,
  priceLists = [],
  inventoryItems = [],
}: EditInventoryItemProps) => {
  // the hold-back toggle applies immediately, so the rows behind this dialog
  // are stale and reconcile when it closes. Price-list prices do not: they go
  // in with the form on Submit.
  const [needsRefetch, setNeedsRefetch] = useState(false);

  const priceListText = (): Record<number, string> =>
    priceLists.reduce((acc, list) => {
      const price = getRowListPrice(
        row.original as unknown as InventoryItem,
        list.id,
      );
      return { ...acc, [list.id]: price == null ? '' : String(price) };
    }, {});

  const [listPrices, setListPrices] =
    useState<Record<number, string>>(priceListText);
  const [isOpen, setIsOpen] = useState(false);
  const [openAdjustStock, setOpenAdjustStock] = useState(false);
  const [openAttributes, setOpenAttributes] = useState(false);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [excluded, setExcluded] = useState(
    Boolean(row.original.excludeFromCatalog),
  );
  const [parentId, setParentId] = useState<number | null>(
    row.original.parentId ?? null,
  );
  const defaultValues: UpdateInventoryItem = {
    id: row.original.id,
    name: row.original.name,
    quantity: row.original.quantity,
    price: row.original.price,
    title: row.original.title ?? '',
    description: row.original.description,
    descriptionUrdu: row.original.descriptionUrdu ?? '',
    itemTypeId: row.original.itemTypeId,
    listPosition: row.original.listPosition ?? null,
  };

  const familyHeadOptions = useMemo(() => {
    const heads = inventoryItems.filter(
      (item) => item.parentId == null && item.id !== row.original.id,
    );
    return [{ id: 0, name: 'None — this is a head' }, ...heads];
  }, [inventoryItems, row.original.id]);

  const variantChildCount = useMemo(
    () =>
      inventoryItems.filter((item) => item.parentId === row.original.id).length,
    [inventoryItems, row.original.id],
  );
  // heads with variants cannot become children — hide picker, show status only
  const canSetFamilyHead = variantChildCount === 0;

  // load active item types each time edit dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    setParentId(row.original.parentId ?? null);
    (async () => {
      const rows = await window.electron.getItemTypes();
      setItemTypes(rows.filter((itemType) => itemType.isActive));
    })();
  }, [isOpen, row.original.parentId]);

  // applied immediately rather than on submit: it is a publishing decision
  // about the item, not one of its accounting fields, and the rest of this form
  // is disabled for existing items anyway
  const onToggleExcluded = async (next: boolean) => {
    setExcluded(next);
    const ok = await window.electron.setItemExcludedFromCatalog(
      row.original.id,
      next,
    );
    if (!ok) {
      setExcluded(!next);
      toast({
        description: 'Could not change the publishing setting',
        variant: 'destructive',
      });
      return;
    }
    // row data is reconciled when the dialog closes via needsRefetch, avoiding
    // table re-renders that would unmount and close this dialog mid-interaction.
    setNeedsRefetch(true);
    toast({
      description: next
        ? `Item "${row.original.name}" excluded from catalog`
        : `Item "${row.original.name}" included in catalog`,
      variant: next ? 'warning' : 'success',
    });
  };

  const onParentChange = async (next: number | null) => {
    const prev = parentId;
    setParentId(next);
    const result = await window.electron.setInventoryParentId(
      row.original.id,
      next,
    );
    if (!result.success) {
      setParentId(prev);
      toast({
        description: result.error ?? 'Could not set family head',
        variant: 'destructive',
      });
      return;
    }
    setNeedsRefetch(true);
    toast({
      description:
        next == null
          ? 'Cleared family head — item is its own head'
          : 'Linked to family head (at-vendor qty folded if any)',
      variant: 'success',
    });
  };

  const onEdit = async (values: UpdateInventoryItem) => {
    const res = await window.electron.updateInventoryItem({ ...values });

    if (res) {
      const changed = changedListPrices(
        priceLists,
        listPrices,
        row.original as unknown as InventoryItem,
      );

      if (changed.length) {
        await window.electron.bulkUpdateInventoryPricesAndListPositions([
          {
            id: row.original.id,
            price: values.price,
            listPosition: values.listPosition ?? null,
            listPrices: changed,
          },
        ]);
      }

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

  const isActive =
    row.original.isActive !== 0 && row.original.isActive !== false;
  const toggleLabel = isActive ? 'Deactivate item' : 'Activate item';

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleToggleActive = async () => {
    const nextState = !isActive;
    const ok = await window.electron.toggleInventoryActive(
      row.original.id,
      nextState,
    );
    toast({
      description: ok
        ? `Item "${row.original.name}" has been ${
            nextState ? 'activated' : 'deactivated'
          }`
        : `Failed to ${nextState ? 'activate' : 'deactivate'} item`,
      variant: ok ? 'success' : 'destructive',
    });
    if (ok) {
      refetchInventory();
      refreshPublishStatuses?.();
    }
  };

  const handleDeleteClick = async () => {
    try {
      const check = await window.electron.canDeleteInventoryItem(
        row.original.id,
      );
      if (!check.canDelete) {
        toast({
          description: check.reason ?? 'Cannot delete this inventory item',
          variant: 'destructive',
        });
        return;
      }
      setIsDeleteDialogOpen(true);
    } catch (error) {
      toast({
        description: `Error checking item deletion: ${error}`,
        variant: 'destructive',
      });
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await window.electron.deleteInventoryItem(row.original.id);
      if (res.success) {
        toast({
          description: `Item "${row.original.name}" has been deleted`,
          variant: 'success',
        });
        setIsDeleteDialogOpen(false);
        refetchInventory();
        refreshPublishStatuses?.();
      } else {
        toast({
          description: res.error ?? 'Failed to delete item',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        description: `Error deleting item: ${error}`,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(next) => {
          setIsOpen(next);
          // reseed on open rather than in an effect: a dialog closed on a typed
          // but unsaved price must not show that price again next time
          if (next) setListPrices(priceListText());
          if (!next && needsRefetch) {
            setNeedsRefetch(false);
            refetchInventory();
          }
        }}
      >
        <DialogTrigger asChild>
          <EditActionButton
            aria-label="Edit inventory item"
            title="Edit inventory item"
          />
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[480px]">
          <TooltipProvider delayDuration={150}>
            <DialogHeader>
              <DialogTitle>Edit Inventory Item</DialogTitle>
            </DialogHeader>
            <InventoryForm
              schema={editInventorySchema}
              defaultValues={defaultValues}
              onSubmit={onEdit}
              disabledFields={['name', 'quantity']}
              hiddenFields={showPublishControls ? [] : ['title']}
              itemTypes={itemTypes}
              showClear={false}
            >
              <ItemPriceLists
                priceLists={priceLists}
                values={listPrices}
                onChange={(id, value) =>
                  setListPrices((prev) => ({ ...prev, [id]: value }))
                }
              />
            </InventoryForm>
            {showPublishControls ? (
              <div className="flex items-center gap-2 border-t pt-3">
                <Checkbox
                  id={`exclude-${row.original.id}`}
                  checked={excluded}
                  onCheckedChange={(checked) =>
                    onToggleExcluded(checked === true)
                  }
                />
                <div className="flex items-center gap-1.5">
                  <Label
                    htmlFor={`exclude-${row.original.id}`}
                    className="cursor-pointer text-sm font-normal"
                  >
                    Keep out of the published catalog
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-pointer items-center text-muted-foreground hover:text-foreground">
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="start"
                      className="max-w-xs text-xs"
                    >
                      Applies immediately. The item stays in your inventory and
                      invoices; it just never goes on sale online, even with a
                      price and a photo.
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ) : null}
            <div className="space-y-1.5 border-t pt-3">
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-normal">Family head</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-pointer items-center text-muted-foreground hover:text-foreground">
                      <Info className="h-3.5 w-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="start"
                    className="max-w-xs text-xs"
                  >
                    Links this item under a parent family head for catalog
                    grouping and publishing.
                  </TooltipContent>
                </Tooltip>
              </div>
              {canSetFamilyHead ? (
                <FamilyHeadPicker
                  key={isOpen ? `open-${row.original.id}` : 'closed'}
                  options={familyHeadOptions}
                  value={parentId}
                  onChange={onParentChange}
                />
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span>
                    This item is head of {variantChildCount} variant
                    {variantChildCount === 1 ? '' : 's'} — cannot nest under
                    another.
                  </span>
                </div>
              )}
            </div>
          </TooltipProvider>
        </DialogContent>
      </Dialog>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title="More actions"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setOpenAttributes(true)}>
            <Tag className="mr-2 h-4 w-4" />
            Attributes
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpenAdjustStock(true)}>
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Adjust stock
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleToggleActive}>
            {isActive ? (
              <Ban className="mr-2 h-4 w-4" />
            ) : (
              <Power className="mr-2 h-4 w-4" />
            )}
            {toggleLabel}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleDeleteClick}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete item
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AdjustStock
        item={row.original as unknown as InventoryItem}
        refetchInventory={refetchInventory}
        open={openAdjustStock}
        onOpenChange={setOpenAdjustStock}
        trigger={null}
      />
      <EditItemAttributes
        item={row.original as unknown as InventoryItem}
        onUpdated={refetchInventory}
        open={openAttributes}
        onOpenChange={setOpenAttributes}
        trigger={null}
      />

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Inventory Item</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{row.original.name}&quot;?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
