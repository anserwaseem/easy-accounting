/* eslint-disable react/prop-types -- props fully typed via HideItemsMenuProps interface */
import { MoreVertical } from 'lucide-react';
import { Button } from 'renderer/shad/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'renderer/shad/ui/dropdown-menu';
import { cn } from 'renderer/lib/utils';

export interface HideItemsOption {
  /** stable id, used as the checkbox's identity */
  id: string;
  /** what the option hides, in the reader's words */
  label: string;
  /** whether the option is on */
  checked: boolean;
  /** called with the option's new state */
  onCheckedChange: (checked: boolean) => void;
}

interface HideItemsMenuProps {
  /** the kinds of item that can be hidden */
  options: HideItemsOption[];
  /** an "All" item that turns every option on or off at once */
  onAllCheckedChange?: (checked: boolean) => void;
  /** whether every option is on, for the "All" item */
  allChecked?: boolean;
  /** the trigger's accessible name */
  label?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The "hide items" filters, behind a ⋮ in the header.
 *
 * They were a strip of six checkboxes under the title, and on a phone
 * that strip was three ragged rows of its own — more screen than the
 * list it was filtering. A header menu says the same thing in one
 * control, and the count on the trigger says how much is being hidden
 * without opening it.
 */
export const HideItemsMenu: React.FC<HideItemsMenuProps> = ({
  options,
  onAllCheckedChange,
  allChecked,
  label = 'Hide items',
  disabled = false,
  className,
}) => {
  const activeCount = options.filter((option) => option.checked).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          className={cn('relative', className)}
          title={label}
          aria-label={activeCount > 0 ? `${label} (${activeCount} on)` : label}
        >
          <MoreVertical className="h-4 w-4" />
          {activeCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {label}
        </DropdownMenuLabel>
        {onAllCheckedChange ? (
          <DropdownMenuCheckboxItem
            checked={Boolean(allChecked)}
            onSelect={(event) => {
              // the menu stays open: these are filters, and a person
              // setting four of them should not reopen the menu each time
              event.preventDefault();
              onAllCheckedChange(!allChecked);
            }}
          >
            All
          </DropdownMenuCheckboxItem>
        ) : null}
        {onAllCheckedChange ? <DropdownMenuSeparator className="my-1" /> : null}
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={option.checked}
            disabled={disabled}
            onSelect={(event) => {
              event.preventDefault();
              option.onCheckedChange(!option.checked);
            }}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
