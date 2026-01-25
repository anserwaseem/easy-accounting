import { debounce, toString } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Input } from '@/renderer/shad/ui/input';
import {
  Select,
  SelectTrigger,
  SelectContent,
} from '@/renderer/shad/ui/select';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
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
  const [filteredSearchValue, setFilteredSearchValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isTypingRef = useRef(false);

  // auto focus the search input when the select dropdown is opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      // use a small timeout to ensure the input is in the DOM
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // maintain focus on input while typing
  useEffect(() => {
    if (!isOpen) return undefined;

    // function to refocus the input if it loses focus while typing
    const handleFocusOut = () => {
      if (isTypingRef.current) {
        if (document.activeElement !== searchInputRef.current) {
          setTimeout(() => {
            searchInputRef.current?.focus();
          }, 0);
        }
      }
    };

    document.addEventListener('focusin', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusOut);
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

    const lowerSearch = filteredSearchValue.toLowerCase();
    return options.filter((opt) =>
      searchFields.some((field) => {
        const fieldValue = opt[field];
        return (
          fieldValue !== undefined &&
          toString(fieldValue).toLowerCase().includes(lowerSearch)
        );
      }),
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
    <Select open={isOpen} onOpenChange={handleOpenChange} disabled={disabled}>
      <SelectTrigger className="w-[260px]" disabled={disabled}>
        <span className="truncate">{displayText}</span>
      </SelectTrigger>
      <SelectContent className="overflow-hidden">
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
        <div className="transition-opacity duration-150 ease-in-out">
          <Virtuoso
            data={filteredOptions}
            style={{ height: 400 }}
            itemContent={itemRenderer}
          />
        </div>
      </SelectContent>
    </Select>
  );
};

export default VirtualMultiSelect;
