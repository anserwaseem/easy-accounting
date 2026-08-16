import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';

import { cn } from 'renderer/lib/utils';
import { Badge } from 'renderer/shad/ui/badge';
import { Button } from 'renderer/shad/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from 'renderer/shad/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'renderer/shad/ui/popover';

export interface MultiSelectOption {
  /** Stored value — what the caller persists. */
  value: string;
  /** What the user reads. Always shown; `value` may be an internal identifier. */
  label: string;
  /** Optional secondary text, e.g. the identifier behind the label. */
  hint?: string;
  /**
   * Offered but not choosable. Shown rather than hidden so the option is
   * visibly unavailable — hiding it just raises "where did it go?".
   *
   * An already-selected option stays removable even when disabled, or a value
   * that becomes ineligible later can never be cleared.
   */
  disabled?: boolean;
  /** Why it is disabled. Worth saying, since the answer is rarely guessable. */
  disabledReason?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  /** Shown when there are no options at all, rather than an empty popover. */
  emptyText?: string;
  searchPlaceholder?: string;
  className?: string;
}

/**
 * Pick several values from a list that keeps growing.
 *
 * A column of checkboxes is fine for five options and unusable at fifty — it
 * pushes everything below it off the screen and offers no way to find anything.
 * This keeps the closed size constant, and searching is how you find an option
 * rather than scrolling.
 *
 * `label` is what a user matches against; `value` is what gets stored and may be
 * an identifier they never see elsewhere. Both are searchable, so someone who
 * knows only the stored name can still find the row.
 */
export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  selected,
  onChange,
  placeholder = 'Select…',
  emptyText = 'Nothing to choose from.',
  searchPlaceholder = 'Search…',
  className,
}: MultiSelectProps) => {
  const [open, setOpen] = useState(false);

  const chosen = useMemo(
    () => options.filter((o) => selected.includes(o.value)),
    [options, selected],
  );
  // "all" means all *choosable* — a select-all that could never reach a full
  // state would sit permanently unticked
  const selectable = useMemo(
    () => options.filter((o) => !o.disabled),
    [options],
  );
  const allSelected =
    selectable.length > 0 &&
    selectable.every((o) => selected.includes(o.value));

  const toggle = (value: string) => {
    const isSelected = selected.includes(value);
    // disabled blocks *adding*, never removing — otherwise an option that
    // becomes ineligible after being chosen is stuck on for ever
    if (!isSelected && options.find((o) => o.value === value)?.disabled) return;
    onChange(
      isSelected ? selected.filter((v) => v !== value) : [...selected, value],
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          // eslint-disable-next-line jsx-a11y/role-has-required-aria-props
          role="combobox"
          aria-expanded={open}
          className={cn(
            'h-auto min-h-10 w-full justify-between px-3 py-2 font-normal',
            className,
          )}
        >
          <span className="flex flex-wrap items-center gap-1">
            {chosen.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              chosen.map((option) => (
                <Badge
                  key={option.value}
                  variant="secondary"
                  className="gap-1 font-normal"
                >
                  {option.label}
                  {/* a span, not a button: this trigger is already a button and
                      nesting one inside it is invalid HTML that React will warn
                      about and the browser may re-parent */}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove ${option.label}`}
                    className="rounded-sm hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(option.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      e.stopPropagation();
                      toggle(option.value);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </Badge>
              ))
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command
          filter={(value, search) =>
            // `value` here is the CommandItem's value, which we set to
            // "label␟stored" so a search matches either — someone who only knows
            // the stored identifier can still find the row
            value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={`${option.label}␟${option.value}`}
                    onSelect={() => toggle(option.value)}
                    disabled={option.disabled && !isSelected}
                    title={option.disabled ? option.disabledReason : undefined}
                    className="cursor-pointer gap-2"
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50',
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span>{option.label}</span>
                    <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                      {option.disabled && option.disabledReason && (
                        <span className="italic">{option.disabledReason}</span>
                      )}
                      {option.hint}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {options.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() =>
                      onChange(
                        allSelected ? [] : selectable.map((o) => o.value),
                      )
                    }
                    className="cursor-pointer justify-center text-sm"
                  >
                    {allSelected ? 'Clear all' : 'Select all'}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default MultiSelect;
