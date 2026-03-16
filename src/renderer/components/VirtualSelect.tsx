import { debounce, sortBy, toString } from 'lodash';
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
import { cn } from '@/renderer/lib/utils';
import type { Account } from 'types';

type SectionOrItem<T> =
  | { type: 'header'; label: string }
  | { type: 'item'; item: T };

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
  disabled?: boolean;
  searchFields?: (keyof T)[];
  searchPlaceholder?: string;
  triggerClassName?: string;
  /** when provided, options are shown in sections with sticky section headers (e.g. group by itemTypeName) */
  groupBy?: (item: T) => string;
  renderSelectItem?: (item: T) => ReactNode;
};

const VirtualSelect = <T extends BaseOption = Account>({
  options,
  value,
  onChange,
  placeholder = 'Select an option',
  disabled = false,
  searchFields = ['name', 'code'] as (keyof T)[],
  searchPlaceholder = 'Search...',
  triggerClassName,
  groupBy,
  renderSelectItem,
}: VirtualSelectProps<T>) => {
  const [searchInputValue, setSearchInputValue] = useState('');
  const [filteredSearchValue, setFilteredSearchValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [stickySectionLabel, setStickySectionLabel] = useState<string | null>(
    null,
  );
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

  // when groupBy is provided: build flat list of section headers + items (single Virtuoso, reliable in portal)
  const listWithSections = useMemo((): SectionOrItem<T>[] | null => {
    if (!groupBy || !filteredOptions.length) return null;
    const byKey = new Map<string, T[]>();
    for (const opt of filteredOptions) {
      const key = groupBy(opt);
      const list = byKey.get(key) ?? [];
      list.push(opt);
      byKey.set(key, list);
    }
    const keys = Array.from(byKey.keys());
    const otherKey = keys.find((k) => k.toLowerCase() === 'other');
    const rest = keys.filter((k) => k.toLowerCase() !== 'other');
    const sortedKeys = [
      ...sortBy(rest, (k) => k),
      ...(otherKey ? [otherKey] : []),
    ];
    const flat: SectionOrItem<T>[] = [];
    for (const key of sortedKeys) {
      flat.push({ type: 'header', label: key });
      for (const item of byKey.get(key)!) {
        flat.push({ type: 'item', item });
      }
    }
    return flat;
  }, [filteredOptions, groupBy]);

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
      setSearchInputValue('');
      setFilteredSearchValue('');
      setStickySectionLabel(null);
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

  const sectionHeaderRenderer = useCallback(
    (label: string) => (
      <div
        className={cn(
          'sticky top-0 z-10 border-b bg-muted/90 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-sm',
        )}
        role="presentation"
      >
        {label}
      </div>
    ),
    [],
  );

  const listContentRenderer = useCallback(
    (index: number, entry: SectionOrItem<T> | T) => {
      if (listWithSections) {
        const row = entry as SectionOrItem<T>;
        if (row.type === 'header') {
          return sectionHeaderRenderer(row.label);
        }
        return itemRenderer(index, row.item);
      }
      return itemRenderer(index, entry as T);
    },
    [itemRenderer, listWithSections, sectionHeaderRenderer],
  );

  const virtuosoData = listWithSections ?? filteredOptions;
  const hasOptions = virtuosoData.length > 0;

  // set initial sticky section when list with sections is shown
  useEffect(() => {
    if (!listWithSections?.length || !isOpen) return;
    const first = listWithSections[0];
    if (first.type === 'header') {
      setStickySectionLabel(first.label);
    }
  }, [listWithSections, isOpen]);

  // update sticky section label from visible range (section at top of viewport)
  const handleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }) => {
      if (!listWithSections?.length) return;
      const { startIndex } = range;
      for (let i = startIndex; i >= 0; i -= 1) {
        const row = listWithSections[i];
        if (row.type === 'header') {
          setStickySectionLabel(row.label);
          return;
        }
      }
      setStickySectionLabel(null);
    },
    [listWithSections],
  );

  return (
    <Select
      value={value?.toString()}
      onValueChange={(val) => onChange(val)}
      onOpenChange={handleOpenChange}
      open={isOpen}
      disabled={disabled}
    >
      <SelectTrigger className={triggerClassName}>
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
        <div
          className="transition-opacity duration-150 ease-in-out min-h-[320px] relative"
          style={{ height: hasOptions ? 400 : undefined }}
        >
          {listWithSections && stickySectionLabel && hasOptions && (
            <div
              className={cn(
                'sticky top-0 z-10 border-b bg-muted/95 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-sm',
              )}
              role="presentation"
            >
              {stickySectionLabel}
            </div>
          )}
          {hasOptions ? (
            <Virtuoso
              data={virtuosoData}
              style={{ height: listWithSections ? 368 : 400 }}
              itemContent={listContentRenderer}
              rangeChanged={handleRangeChanged}
            />
          ) : (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              {filteredSearchValue
                ? 'No matching items'
                : 'No options available'}
            </div>
          )}
        </div>
      </SelectContent>
    </Select>
  );
};

export default VirtualSelect;
