import { debounce, toString } from 'lodash';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TableVirtuoso } from 'react-virtuoso';
import { Input } from '@/renderer/shad/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/renderer/shad/ui/select';

type Option = {
  id: number | string;
} & Record<string, string | number | undefined>;

type VirtualSelectProps = {
  options: Option[];
  value: string | number | null | undefined;
  onChange: (value: string | number) => void;
  placeholder?: string;
  searchFields?: (keyof Option)[];
  searchPlaceholder?: string;
};

const VirtualSelect = ({
  options,
  value,
  onChange,
  placeholder = 'Select an option',
  searchFields = ['name', 'code'],
  searchPlaceholder = 'Search...',
}: VirtualSelectProps) => {
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
      searchFields.some((field) =>
        toString(opt[field]).toLowerCase().includes(lowerSearch),
      ),
    );
  }, [searchValue, options, searchFields]);

  const debounceSearch = useMemo(
    () => debounce((search: string) => setSearchValue(search), 100),
    [],
  );

  return (
    <Select value={value?.toString()} onValueChange={(val) => onChange(val)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder}>
          {options.find((opt) => opt.id.toString() === value?.toString())
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
            <SelectItem value={item.id.toString()} key={item.id}>
              <div>
                <h2>{item.name}</h2>
                {item.code && (
                  <p className="text-xs text-slate-400">{item.code}</p>
                )}
              </div>
            </SelectItem>
          )}
        />
      </SelectContent>
    </Select>
  );
};

export default VirtualSelect;
