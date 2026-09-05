import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from 'renderer/shad/ui/dialog';
import { EditActionButton } from '@/renderer/components/EditActionButton';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Label } from '@/renderer/shad/ui/label';
import { toast } from 'renderer/shad/ui/use-toast';
import type { UpdateInventoryItem, ItemType, InventoryItem } from '@/types';
import { useEffect, useMemo, useState } from 'react';
import type { PriceListSummary } from '@/renderer/hooks/usePublishSettings';
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
    // only the badges are refreshed here. Refetching the inventory would swap
    // the row data beneath this dialog, which is what closed it mid-click; the
    // rows are reconciled when the dialog closes instead.
    setNeedsRefetch(true);
    refreshPublishStatuses?.();
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

  return (
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
        <EditActionButton aria-label="Edit inventory item" />
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[425px]">
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
        />
        <ItemPriceLists
          priceLists={priceLists}
          values={listPrices}
          onChange={(id, value) =>
            setListPrices((prev) => ({ ...prev, [id]: value }))
          }
        />
        {showPublishControls ? (
          <div className="flex items-start gap-2 border-t pt-3">
            <Checkbox
              id={`exclude-${row.original.id}`}
              checked={excluded}
              onCheckedChange={(checked) => onToggleExcluded(checked === true)}
            />
            <div className="flex flex-col gap-0.5">
              <Label
                htmlFor={`exclude-${row.original.id}`}
                className="text-sm font-normal"
              >
                Keep out of the published catalog
              </Label>
              <span className="text-xs text-muted-foreground">
                Applies immediately. The item stays in your inventory and
                invoices; it just never goes on sale online, even with a price
                and a photo.
              </span>
            </div>
          </div>
        ) : null}
        <div className="space-y-1.5 border-t pt-3">
          <Label className="text-sm font-normal">Family head</Label>
          {canSetFamilyHead ? (
            <FamilyHeadPicker
              key={isOpen ? `open-${row.original.id}` : 'closed'}
              options={familyHeadOptions}
              value={parentId}
              onChange={onParentChange}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              This item is head of {variantChildCount} variant
              {variantChildCount === 1 ? '' : 's'} — cannot nest under another.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
