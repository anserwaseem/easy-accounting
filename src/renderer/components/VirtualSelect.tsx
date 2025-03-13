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
  const [searchValue, setSearchValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // auto focus the search input when the select dropdown is opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      // use a small timeout to ensure the input is in the DOM
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    }
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    if (!searchValue) return options;

    const lowerSearch = searchValue.toLowerCase();
    return options.filter((opt) =>
      searchFields.some((field) => {
        const fieldValue = opt[field];
        return (
          fieldValue !== undefined &&
          toString(fieldValue).toLowerCase().includes(lowerSearch)
        );
      }),
    );
  }, [searchValue, options, searchFields]);

  const debounceSearch = useMemo(
    () => debounce((search: string) => setSearchValue(search), 50),
    [],
  );

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
    if (!open) setSearchValue(''); // reset search value when dropdown is closed
  }, []);

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
      <SelectContent>
        <div className="p-2">
          <Input
            ref={searchInputRef}
            value={searchValue}
            onChange={(e) => debounceSearch(e.target.value)}
            placeholder={searchPlaceholder || 'Search...'}
          />
        </div>
        <Virtuoso
          data={filteredOptions}
          style={{ height: 600 }}
          // eslint-disable-next-line react/no-unstable-nested-components
          itemContent={(_, item) => (
            <SelectItem
              value={item?.id?.toString() || crypto.randomUUID()}
              key={item?.id?.toString() || crypto.randomUUID()}
            >
              {renderSelectItem
                ? renderSelectItem(item)
                : defaultRenderSelectItem(item)}
            </SelectItem>
          )}
        />
      </SelectContent>
    </Select>
  );
};

export default VirtualSelect;
