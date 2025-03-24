import { debounce, toString } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Input } from '@/renderer/shad/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/renderer/shad/ui/select';
import type { Account } from 'types';

type BaseOption = {
  id?: unknown;
  name?: string;
  code?: string | number;
};

type VirtualSelectProps<T extends BaseOption> = {
  options: T[];
  value: string | number | null | undefined;
  onChange: (value: string | number) => void;
  placeholder?: string;
  searchFields?: (keyof T)[];
  searchPlaceholder?: string;
  renderSelectItem?: (item: T) => ReactNode;
};

const VirtualSelect = <T extends BaseOption = Account>({
  options,
  value,
  onChange,
  placeholder = 'Select an option',
  searchFields = ['name', 'code'] as (keyof T)[],
  searchPlaceholder = 'Search...',
  renderSelectItem,
}: VirtualSelectProps<T>) => {
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

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      // reset search values when dropdown is closed
      setSearchInputValue('');
      setFilteredSearchValue('');
      isTypingRef.current = false;
    }
  }, []);

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

  // memoize item renderer to prevent re-renders
  const itemRenderer = useCallback(
    (_: number, item: T) => (
      <SelectItem
        value={item?.id?.toString() || crypto.randomUUID()}
        key={item?.id?.toString() || crypto.randomUUID()}
        onMouseDown={(e) => {
          // prevent mousedown from stealing focus from input
          if (isTypingRef.current) {
            e.preventDefault();
          }
        }}
        className="transition-colors duration-150 ease-in-out"
      >
        {renderSelectItem
          ? renderSelectItem(item)
          : defaultRenderSelectItem(item)}
      </SelectItem>
    ),
    [renderSelectItem, defaultRenderSelectItem],
  );

  return (
    <Select
      value={value?.toString()}
      onValueChange={(val) => onChange(val)}
      onOpenChange={handleOpenChange}
      open={isOpen}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder}>
          {options.find((opt) => opt.id?.toString() === value?.toString())
            ?.name || placeholder}
        </SelectValue>
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
            style={{ height: 600 }}
            itemContent={itemRenderer}
          />
        </div>
      </SelectContent>
    </Select>
  );
};

export default VirtualSelect;
