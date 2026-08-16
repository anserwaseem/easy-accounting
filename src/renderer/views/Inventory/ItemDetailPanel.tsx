import { useMemo } from 'react';
import type { AttributeDefinition, InventoryItem } from 'types';
import { formatAttributeValue } from './inventoryQuery';

/**
 * The per-row detail panel behind the inventory table's accordion.
 *
 * The table shows the columns every item has. Attributes are the opposite
 * shape: each item fills a minority of them, so as columns they are mostly
 * empty cells that push the identifying columns off-screen. Here they are
 * listed per item, and **only where a value is actually set**, which is what
 * makes the panel short enough to be worth opening.
 *
 * The pairs flow into as many columns as the width allows rather than one list
 * down the left edge. On a wide table that single column is mostly empty space,
 * and it pushes the following row off the screen for no reason.
 */

interface DetailEntry {
  label: string;
  value: string;
}

interface ItemDetailPanelProps {
  item: InventoryItem;
  attributeDefs: AttributeDefinition[];
}

export const ItemDetailPanel = ({
  item,
  attributeDefs,
}: ItemDetailPanelProps) => {
  const entries = useMemo<DetailEntry[]>(
    () =>
      attributeDefs
        .map((def) => ({
          label: def.unit ? `${def.label} (${def.unit})` : def.label,
          value: formatAttributeValue(item.attributes?.[def.key]),
        }))
        .filter((entry) => entry.value !== ''),
    [attributeDefs, item.attributes],
  );

  return (
    <div className="border-l-2 border-primary/40 px-4 py-2.5">
      {entries.length ? (
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-8 gap-y-1">
          {entries.map((entry) => (
            <div
              key={entry.label}
              className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3"
            >
              <dt className="truncate text-xs text-muted-foreground">
                {entry.label}
              </dt>
              <dd className="min-w-0 break-words text-xs font-medium">
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">
          No attributes set for this item.
        </p>
      )}
    </div>
  );
};

export default ItemDetailPanel;
