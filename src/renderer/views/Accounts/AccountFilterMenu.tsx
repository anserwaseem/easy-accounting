import { Filter } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Label } from '@/renderer/shad/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/renderer/shad/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/shad/ui/select';
import { AccountType, type Chart } from 'types';

export type AccountTypeFilter = 'All' | AccountType;
export type AccountHeadFilter = 'All' | string;

interface AccountFilterMenuProps {
  charts: Chart[];
  typeSelected: AccountTypeFilter;
  onTypeChange: (type: AccountTypeFilter) => void;
  headSelected: AccountHeadFilter;
  onHeadChange: (head: AccountHeadFilter) => void;
  showInactive: boolean;
  onShowInactiveChange: (show: boolean) => void;
}

const HEAD_ITEM_STYLES =
  'my-1 cursor-pointer flex items-center data-[highlighted]:bg-accent/50 hover:bg-accent/50';

const countActiveAccountFilters = (
  typeSelected: AccountTypeFilter,
  headSelected: AccountHeadFilter,
  showInactive: boolean,
): number =>
  (typeSelected !== AccountType.Asset ? 1 : 0) +
  (headSelected !== 'All' ? 1 : 0) +
  (showInactive ? 1 : 0);

/** type + head + inactive — matches Inventory Filters popover pattern */
export const AccountFilterMenu: React.FC<AccountFilterMenuProps> = ({
  charts,
  typeSelected,
  onTypeChange,
  headSelected,
  onHeadChange,
  showInactive,
  onShowInactiveChange,
}: AccountFilterMenuProps) => {
  const activeCount = countActiveAccountFilters(
    typeSelected,
    headSelected,
    showInactive,
  );

  const chartsForType = charts.filter(
    (chart) => typeSelected === 'All' || chart.type === typeSelected,
  );
  const parentCharts = chartsForType.filter((chart) => !chart.parentId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter size={16} />
          Filters
          {activeCount > 0 ? (
            <span className="rounded bg-muted px-1.5 text-xs tabular-nums">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Filters
          </span>
          <Button
            variant="ghost"
            className="h-auto px-2 py-0 text-xs"
            disabled={activeCount === 0}
            onClick={() => {
              onTypeChange(AccountType.Asset);
              onHeadChange('All');
              onShowInactiveChange(false);
            }}
          >
            Reset
          </Button>
        </div>
        <div className="space-y-3 p-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Account type
            </Label>
            <Select
              value={typeSelected}
              onValueChange={(value) =>
                onTypeChange(value as AccountTypeFilter)
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All</SelectItem>
                {Object.values(AccountType).map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Head</Label>
            <Select
              value={headSelected}
              onValueChange={(value) =>
                onHeadChange(value as AccountHeadFilter)
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All heads" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All heads</SelectItem>
                {parentCharts.map((mainChart) => (
                  <SelectGroup key={mainChart.id} className="[&_svg]:hidden">
                    <SelectItem
                      value={mainChart.name}
                      className={`${HEAD_ITEM_STYLES} pl-4 py-2 font-semibold bg-muted/50`}
                    >
                      {mainChart.name}
                    </SelectItem>
                    {chartsForType
                      .filter((c) => c.parentId === mainChart.id)
                      .map((customHead) => (
                        <SelectItem
                          key={customHead.id}
                          value={customHead.name}
                          className={`${HEAD_ITEM_STYLES} pl-8 border-l-2 border-muted ml-4`}
                        >
                          {customHead.name}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Label
            htmlFor="account-filter-show-inactive"
            className="flex cursor-pointer items-center gap-2 text-sm font-normal"
          >
            <Checkbox
              id="account-filter-show-inactive"
              checked={showInactive}
              onCheckedChange={(checked) =>
                onShowInactiveChange(checked === true)
              }
            />
            Show inactive accounts
          </Label>
        </div>
      </PopoverContent>
    </Popover>
  );
};
