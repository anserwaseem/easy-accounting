import type { PriceListSummary } from '@/renderer/hooks/usePublishSettings';
import { Input } from 'renderer/shad/ui/input';
import { Label } from 'renderer/shad/ui/label';

/**
 * Per-item price-list prices, inside the edit dialog.
 *
 * These were previously reachable only through Bulk edit, which is the right
 * tool for repricing a shelf and the wrong one for a single item: the answer to
 * "this one product has no Retail price" should be in the dialog you opened to
 * fix that product.
 *
 * Purely presentational, and deliberately so. An earlier version saved each
 * price when the box lost focus, which left no way to change your mind: type a
 * price, realise you have forgotten the old one, and closing the dialog keeps
 * the new one anyway. The only escape was quitting the app. Now the values live
 * with the form above and go in on Submit, so closing the dialog discards them
 * like every other field.
 */

interface ItemPriceListsProps {
  priceLists: PriceListSummary[];
  /** current text per price list id, owned by the dialog */
  values: Record<number, string>;
  onChange: (priceListId: number, value: string) => void;
  disabled?: boolean;
}

export const ItemPriceLists: React.FC<ItemPriceListsProps> = ({
  priceLists,
  values,
  onChange,
  disabled = false,
}: ItemPriceListsProps) => {
  if (!priceLists.length) return null;

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <span className="text-sm font-medium">Price lists</span>
      {priceLists.map((list) => (
        <div key={list.id} className="flex items-center gap-2">
          <Label
            htmlFor={`price-list-${list.id}`}
            className="w-1/2 text-sm font-normal"
          >
            {list.name}
          </Label>
          <Input
            id={`price-list-${list.id}`}
            type="number"
            className="h-8"
            disabled={disabled}
            value={values[list.id] ?? ''}
            onChange={(e) => onChange(list.id, e.target.value)}
          />
        </div>
      ))}
      <span className="text-xs text-muted-foreground">
        An empty price means the item is not sold on that list, which is not the
        same as a price of zero.
      </span>
    </div>
  );
};

export default ItemPriceLists;
