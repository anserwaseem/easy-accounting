import { Filter } from 'lucide-react';
import type { AttributeDefinition, InventoryItem, ItemType } from 'types';
import { Button } from '@/renderer/shad/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/renderer/shad/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/shad/ui/select';
import {
  countActiveInventoryFilters,
  distinctAttributeValues,
  emptyInventoryFilters,
  type AttributeFilter,
  type DisplayTitleFilter,
  type FamilyFilter,
  type InventoryFilters,
  type PublishFilter,
} from './inventoryQuery';

/** sentinels, kept distinct from real values by a leading space */
const ANY = ' any';
const UNSET = ' unset';

interface InventoryFilterMenuProps {
  /** every active definition, not only the ones with a column shown: an
   * attribute is worth filtering on whether or not it earns grid width */
  attributeDefs: AttributeDefinition[];
  /** the unfiltered rows, so the choices offered are the values that exist */
  items: InventoryItem[];
  itemTypes: ItemType[];
  filters: InventoryFilters;
  onChange: (filters: InventoryFilters) => void;
  /** publish choices are pointless when publishing is not configured */
  publishEnabled?: boolean;
  disabled?: boolean;
}

const Row = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)] items-center gap-2">
    <span className="truncate text-sm" title={label}>
      {label}
    </span>
    {children}
  </div>
);

/**
 * Filters for the inventory grid.
 *
 * Search answers "where does this text appear". It cannot answer "which
 * 16-line items have no binding set", because that is a conjunction of an
 * equality and an absence. Choices combine with AND, and **absence is
 * selectable** rather than merely un-typeable.
 *
 * Publish state and display title live here rather than as sortable columns:
 * both have a few states rather than an order, so "show me the ones that are X"
 * is the real question. Sorting would only float them to the top and leave the
 * user counting rows.
 */
export const InventoryFilterMenu: React.FC<InventoryFilterMenuProps> = ({
  attributeDefs,
  items,
  itemTypes,
  filters,
  onChange,
  publishEnabled = false,
  disabled = false,
}: InventoryFilterMenuProps) => {
  const activeCount = countActiveInventoryFilters(filters);

  const setAttribute = (key: string, filter: AttributeFilter) =>
    onChange({
      ...filters,
      attributes: { ...filters.attributes, [key]: filter },
    });

  const toSelectValue = (filter: AttributeFilter | undefined): string => {
    if (!filter || filter.mode === 'any') return ANY;
    if (filter.mode === 'unset') return UNSET;
    return filter.value;
  };

  const fromSelectValue = (value: string): AttributeFilter => {
    if (value === ANY) return { mode: 'any' };
    if (value === UNSET) return { mode: 'unset' };
    return { mode: 'value', value };
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2" disabled={disabled}>
          <Filter size={16} />
          Filters
          {activeCount > 0 ? (
            <span className="rounded bg-muted px-1.5 text-xs tabular-nums">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Filters
          </span>
          <Button
            variant="ghost"
            className="h-auto px-2 py-0 text-xs"
            disabled={activeCount === 0}
            onClick={() => onChange(emptyInventoryFilters)}
          >
            Clear all
          </Button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          <div className="flex flex-col gap-2.5 border-b p-3">
            <Row label="Family">
              <Select
                value={filters.family ?? 'any'}
                onValueChange={(v: string) =>
                  onChange({ ...filters, family: v as FamilyFilter })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="heads">Heads with variants</SelectItem>
                  <SelectItem value="variants">Variants</SelectItem>
                  <SelectItem value="standalone">
                    Own heads (no variants)
                  </SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Type">
              <Select
                value={String(filters.itemTypeId ?? 'any')}
                onValueChange={(value) =>
                  onChange({
                    ...filters,
                    itemTypeId:
                      value === 'any' || value === 'none'
                        ? value
                        : Number(value),
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="none">No type</SelectItem>
                  {itemTypes.map((itemType) => (
                    <SelectItem key={itemType.id} value={String(itemType.id)}>
                      {itemType.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            {publishEnabled ? (
              <>
                <Row label="Publish">
                  <Select
                    value={filters.publish}
                    onValueChange={(v: string) =>
                      onChange({ ...filters, publish: v as PublishFilter })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="not ready">Not ready</SelectItem>
                      <SelectItem value="held back">Held back</SelectItem>
                      <SelectItem value="ready">Ready</SelectItem>
                      <SelectItem value="not a candidate">
                        Not a candidate
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Row>
                <Row label="Display title">
                  <Select
                    value={filters.displayTitle}
                    onValueChange={(v: string) =>
                      onChange({
                        ...filters,
                        displayTitle: v as DisplayTitleFilter,
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="set">Set</SelectItem>
                      <SelectItem value="unset">From item name</SelectItem>
                    </SelectContent>
                  </Select>
                </Row>
              </>
            ) : null}
          </div>

          {attributeDefs.length ? (
            <div className="flex flex-col gap-2.5 p-3">
              {attributeDefs.map((def) => {
                const values = distinctAttributeValues(items, def);
                return (
                  <Row key={def.key} label={def.label}>
                    <Select
                      value={toSelectValue(filters.attributes[def.key])}
                      onValueChange={(v: string) =>
                        setAttribute(def.key, fromSelectValue(v))
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        <SelectItem value={ANY}>Any</SelectItem>
                        <SelectItem value={UNSET}>(not set)</SelectItem>
                        {values.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Row>
                );
              })}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default InventoryFilterMenu;
