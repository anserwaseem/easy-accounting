import { debounce, toString } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { TableVirtuoso } from 'react-virtuoso';
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
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchValue, options]);

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
    () => debounce((search: string) => setSearchValue(search), 100),
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

  return (
    <Select value={value?.toString()} onValueChange={(val) => onChange(val)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder}>
          {options.find((opt) => opt.id?.toString() === value?.toString())
            ?.name || placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="center" className="max-h-[300px] w-full">
        <div className="p-2">
          <Input
            ref={searchInputRef}
            value={searchValue}
            onChange={(e) => debounceSearch(e.target.value)}
            placeholder={searchPlaceholder || 'Search...'}
            className="w-full"
          />
        </div>
        <TableVirtuoso
          data={filteredOptions}
          style={{ height: '300px' }}
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
