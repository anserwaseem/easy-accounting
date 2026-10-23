import { debounce } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Input } from '@/renderer/shad/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/renderer/shad/ui/popover';
import { Button } from '@/renderer/shad/ui/button';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { ChevronDown, X } from 'lucide-react';
import { cn, getSearchTerms, matchesSearchTerms } from '@/renderer/lib/utils';
import type { Account } from 'types';

type BaseOption = {
  id?: unknown;
  name?: string;
  code?: string | number;
};

type VirtualMultiSelectProps<T extends BaseOption> = {
  options: T[];
  value: (string | number)[];
  onChange: (value: (string | number)[]) => void;
  placeholder?: string;
  searchFields?: (keyof T)[];
  searchPlaceholder?: string;
  renderSelectItem?: (item: T) => ReactNode;
  disabled?: boolean;
};

const VirtualMultiSelect = <T extends BaseOption = Account>({
  options,
  value,
  onChange,
  placeholder = 'Select options',
  searchFields = ['name', 'code'] as (keyof T)[],
  searchPlaceholder = 'Search...',
  renderSelectItem,
  disabled = false,
}: VirtualMultiSelectProps<T>) => {
  const [searchInputValue, setSearchInputValue] = useState('');
  // The element the popover is portalled into: the closest dialog or
  // sheet. Portalled to the body it would land outside that dialog's
  // focus scope, and the scope would pull the focus straight back to
  // the trigger — so the search field could not be typed into.
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [filteredSearchValue, setFilteredSearchValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isTypingRef = useRef(false);

  // Focus the search field when the popover opens. Radix focuses the
  // trigger after its own auto-focus runs, so this has to win the race:
  // the field is focused on the open event itself, and the trigger's
  // focus is undone right after.
  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Portalled into the closest dialog or sheet, so the popover lives
  // inside that layer's focus scope (see the note on portalContainer).
  useEffect(() => {
    if (!isOpen || portalContainer) return;
    const dialog = triggerRef.current?.closest<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], [data-radix-dialog-content]',
    );
    if (dialog) setPortalContainer(dialog);
  }, [isOpen, portalContainer]);

  // Keep the focus on the search field while the popover is open.
  //
  // This listens for `focusout` on the FIELD itself rather than for
  // `focusin` on the document: a document-level `focusin` fires when
  // anything takes focus, including the popover's own trigger, and
  // pulling the focus straight back from it fought with the popover's
  // own focus management — the field could never be typed into.
  useEffect(() => {
    if (!isOpen) return undefined;

    const input = searchInputRef.current;
    if (!input) return undefined;

    const handleFocusOut = () => {
      // The popover closing (or the clear button being pressed) is a
      // deliberate focus move, not the user tabbing away.
      if (!isOpen) return;
      if (input.ownerDocument.activeElement === input) return;
      requestAnimationFrame(() => {
        if (isOpen && input.ownerDocument.activeElement !== input) {
          input.focus();
        }
      });
    };

    input.addEventListener('focusout', handleFocusOut);
    return () => {
      input.removeEventListener('focusout', handleFocusOut);
    };
  }, [isOpen]);

  // debounced search handler with timeout
  const debouncedSetFilteredValue = useMemo(
    () =>
      debounce((search: string) => {
        setFilteredSearchValue(search);
        isTypingRef.current = false;
      }, 300),
    [],
  );

  // handle input changes without debounce for immediate input feedback
  const handleSearchInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      isTypingRef.current = true;
      setSearchInputValue(e.target.value);
      debouncedSetFilteredValue(e.target.value);
    },
    [debouncedSetFilteredValue],
  );

  const filteredOptions = useMemo(() => {
    if (!filteredSearchValue) return options;

    // match word by word, so multi-word queries hit regardless of order or extra spacing
    const searchTerms = getSearchTerms(filteredSearchValue);
    return options.filter((opt) =>
      matchesSearchTerms(
        searchFields.map((field) => opt[field]),
        searchTerms,
      ),
    );
  }, [filteredSearchValue, options, searchFields]);

  const defaultRenderSelectItem = useCallback(
    (item: T) => (
      <div>
        <h2>{item.name}</h2>
        {item.code && <p className="text-xs text-slate-400">{item.code}</p>}
      </div>
    ),
    [],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      // prevent opening if disabled
      if (disabled && open) {
        return;
      }
      // only allow closing if explicitly requested (click outside or escape)
      // prevent closing when clicking inside the content
      if (!open) {
        setIsOpen(false);
        // reset search values when dropdown is closed
        setSearchInputValue('');
        setFilteredSearchValue('');
        isTypingRef.current = false;
      } else {
        setIsOpen(true);
      }
    },
    [disabled],
  );

  // handle key down events in the input to prevent focus loss on arrow keys
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // prevent default behavior which might cause focus loss
        e.preventDefault();
      }
    },
    [],
  );

  // handle checkbox toggle
  const handleToggle = useCallback(
    (itemId: string | number, checked: boolean) => {
      const idString = itemId.toString();
      if (checked) {
        // add to selection
        if (!value.includes(idString) && !value.includes(itemId)) {
          onChange([...value, itemId]);
        }
      } else {
        // remove from selection
        onChange(
          value.filter((v) => v.toString() !== idString && v !== itemId),
        );
      }
    },
    [value, onChange],
  );

  // check if item is selected
  const isSelected = useCallback(
    (itemId: string | number | undefined) => {
      if (itemId === undefined) return false;
      const idString = itemId.toString();
      return value.some((v) => v.toString() === idString || v === itemId);
    },
    [value],
  );

  // clear the whole selection (trigger badge + dropdown action)
  const handleClearSelection = useCallback(() => onChange([]), [onChange]);

  // select every option currently matching the search
  const handleSelectAllFiltered = useCallback(() => {
    const selectedIds = new Set(value.map((v) => v.toString()));
    const idsToAdd = filteredOptions
      .map((opt) => opt.id)
      .filter(
        (id): id is string | number =>
          (typeof id === 'string' || typeof id === 'number') &&
          !selectedIds.has(id.toString()),
      );

    if (idsToAdd.length) onChange([...value, ...idsToAdd]);
  }, [filteredOptions, onChange, value]);

  // memoize item renderer to prevent re-renders
  const itemRenderer = useCallback(
    (_: number, item: T) => {
      const itemId = item?.id;
      if (
        itemId === undefined ||
        itemId === null ||
        (typeof itemId !== 'string' && typeof itemId !== 'number')
      ) {
        return null;
      }
      const validId = itemId as string | number;
      const selected = isSelected(validId);
      const idString = validId.toString();

      return (
        <div
          key={idString}
          role="button"
          tabIndex={0}
          className="flex items-center gap-2 px-2 py-1.5 hover:bg-accent cursor-pointer transition-colors duration-150 ease-in-out"
          onMouseDown={(e) => {
            // prevent mousedown from stealing focus from input
            if (isTypingRef.current) {
              e.preventDefault();
            }
          }}
          onClick={() => handleToggle(validId, !selected)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleToggle(validId, !selected);
            }
          }}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) =>
              handleToggle(validId, Boolean(checked))
            }
            onClick={(e) => e.stopPropagation()}
          />
          <div className="flex-1">
            {renderSelectItem
              ? renderSelectItem(item)
              : defaultRenderSelectItem(item)}
          </div>
        </div>
      );
    },
    [renderSelectItem, defaultRenderSelectItem, isSelected, handleToggle],
  );

  const hasSelection = value.length > 0;

  // display text for trigger
  const displayText = useMemo(() => {
    if (value.length === 0) {
      return placeholder;
    }

    // helper to find option by id (handles type mismatches)
    const findOption = (id: string | number) => {
      return options.find(
        (opt) =>
          opt.id?.toString() === id?.toString() ||
          opt.id === id ||
          Number(opt.id) === Number(id),
      );
    };

    if (value.length === 1) {
      const selectedOption = findOption(value[0]);
      return selectedOption?.name || placeholder;
    }

    if (value.length <= 2) {
      // show names when 2 or fewer selected (truncate if too long)
      const selectedNames = value
        .map((id) => findOption(id)?.name)
        .filter(Boolean)
        .join(', ');

      // truncate if total length > 30 chars
      if (selectedNames.length > 30) {
        return `${value.length} selected`;
      }
      return selectedNames || `${value.length} selected`;
    }

    return `${value.length} selected`;
  }, [value, options, placeholder]);

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={isOpen}
          disabled={disabled}
          className="w-full justify-between gap-1 sm:w-[260px]"
        >
          <span className="truncate">{displayText}</span>
          {hasSelection && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear selection"
              title="Clear selection"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:h-5 md:w-5"
              // radix opens the select on pointer down, so stop it before it reaches the trigger
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleClearSelection();
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                handleClearSelection();
              }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden p-0"
        align="start"
        // Radix moves focus to the trigger when the popover opens and
        // restores it there when it closes. Either way the search field
        // could not be typed into, so the focus is placed on the
        // search field explicitly and the trigger's restore is
        // suppressed.
        // Radix's focus scope traps the focus inside the popover, and
        // the trigger is OUTSIDE that scope — so the moment the search
        // field took focus, the scope pulled it straight back to the
        // trigger and the field could not be typed into at all.
        //
        // The scope is not needed here: the popover holds one input
        // and a list, and the list's rows are ordinary buttons.
        trapFocus={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          // Put the focus in the search field ourselves.
          requestAnimationFrame(() => searchInputRef.current?.focus());
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="p-2">
          <Input
            ref={searchInputRef}
            value={searchInputValue}
            onChange={handleSearchInputChange}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder || 'Search...'}
            className="w-full"
          />
        </div>
        <div className="flex items-center justify-between gap-2 border-b px-2 pb-2 text-xs text-muted-foreground">
          <span>
            {hasSelection ? `${value.length} selected` : 'None selected'}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={cn(
                'font-medium text-primary underline-offset-4 hover:underline',
                !filteredOptions.length && 'pointer-events-none opacity-50',
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleSelectAllFiltered}
            >
              {filteredSearchValue ? 'Select matches' : 'Select all'}
            </button>
            <button
              type="button"
              className={cn(
                'font-medium text-primary underline-offset-4 hover:underline',
                !hasSelection && 'pointer-events-none opacity-50',
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClearSelection}
            >
              Clear all
            </button>
          </div>
        </div>
        <div className="transition-opacity duration-150 ease-in-out">
          <Virtuoso
            data={filteredOptions}
            // A fixed 400px list overflowed a short screen and sat under
            // the on-screen keyboard. Bound it to the space available.
            style={{
              height:
                'min(400px, var(--radix-select-content-available-height, 400px))',
            }}
            itemContent={itemRenderer}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default VirtualMultiSelect;
