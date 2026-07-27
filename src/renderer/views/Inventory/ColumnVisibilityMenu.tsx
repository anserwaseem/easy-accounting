import { Columns3 } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Label } from '@/renderer/shad/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/renderer/shad/ui/popover';

export interface ColumnOption {
  /** stable id used for the toggle callback */
  id: string;
  label: string;
}

export interface ColumnGroup {
  title: string;
  options: ColumnOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onSetAll: (ids: string[]) => void;
}

interface ColumnVisibilityMenuProps {
  groups: ColumnGroup[];
  /** toggles are disabled mid-edit so columns cannot change under a draft */
  disabled?: boolean;
}

/**
 * Optional-column picker for the inventory grid.
 *
 * Price-list and attribute columns are open-ended — a business can define many
 * — so listing them inline pushed the table below a wall of checkboxes. Keeping
 * them behind one button holds the page steady no matter how many exist, and
 * the trigger shows the count so nothing is hidden silently.
 */
export const ColumnVisibilityMenu: React.FC<ColumnVisibilityMenuProps> = ({
  groups,
  disabled = false,
}: ColumnVisibilityMenuProps) => {
  const total = groups.reduce((sum, g) => sum + g.selectedIds.length, 0);
  const available = groups.reduce((sum, g) => sum + g.options.length, 0);

  if (available === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2" disabled={disabled}>
          <Columns3 size={16} />
          Columns
          {total > 0 ? (
            <span className="rounded bg-muted px-1.5 text-xs tabular-nums">
              {total}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="max-h-[60vh] overflow-y-auto">
          {groups
            .filter((group) => group.options.length > 0)
            .map((group) => {
              const allSelected =
                group.selectedIds.length === group.options.length;
              return (
                <div key={group.title} className="border-b last:border-b-0">
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {group.title}
                    </span>
                    <Button
                      variant="ghost"
                      className="h-auto px-2 py-0 text-xs"
                      onClick={() =>
                        group.onSetAll(
                          allSelected ? [] : group.options.map((o) => o.id),
                        )
                      }
                    >
                      {allSelected ? 'Clear all' : 'Select all'}
                    </Button>
                  </div>
                  <div className="flex flex-col pb-1">
                    {group.options.map((option) => (
                      <Label
                        key={option.id}
                        htmlFor={`column-toggle-${option.id}`}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm font-normal hover:bg-muted/60"
                      >
                        <Checkbox
                          id={`column-toggle-${option.id}`}
                          checked={group.selectedIds.includes(option.id)}
                          onCheckedChange={() => group.onToggle(option.id)}
                        />
                        <span className="truncate">{option.label}</span>
                      </Label>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ColumnVisibilityMenu;
