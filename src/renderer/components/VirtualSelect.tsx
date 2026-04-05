import { debounce, sortBy, toString } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
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
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({});
  const [stickySectionLabel, setStickySectionLabel] = useState<string | null>(
    null,
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isTypingRef = useRef(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const scrollVirtuosoToTop = useCallback(() => {
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: 0, align: 'start' });
      });
    });
  }, []);

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

  const isSearching = filteredSearchValue.trim().length > 0;

  const toggleSectionCollapsed = useCallback(
    (label: string) => {
      setCollapsedSections((prev) => ({
        ...prev,
        [label]: !prev[label],
      }));
      // list height changes; reset scroll so user is not stuck mid-list after collapse/expand
      scrollVirtuosoToTop();
    },
    [scrollVirtuosoToTop],
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
    if (!open) {
      setSearchInputValue('');
      setFilteredSearchValue('');
      setCollapsedSections({});
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

  const groupCountsByLabel = useMemo(() => {
    if (!groupBy) return null;
    const totalByLabel: Record<string, number> = {};
    for (const opt of options) {
      const label = groupBy(opt);
      totalByLabel[label] = (totalByLabel[label] ?? 0) + 1;
    }
    const matchByLabel: Record<string, number> = {};
    for (const opt of filteredOptions) {
      const label = groupBy(opt);
      matchByLabel[label] = (matchByLabel[label] ?? 0) + 1;
    }
    return { totalByLabel, matchByLabel };
  }, [filteredOptions, groupBy, options]);

  // when user starts searching, auto-expand groups that contain matches
  // but preserve any manual collapses the user has applied during this search session.
  useEffect(() => {
    if (!groupBy || !isSearching || !groupCountsByLabel) return;
    setCollapsedSections((prev) => {
      const next = { ...prev };
      for (const label of Object.keys(groupCountsByLabel.matchByLabel)) {
        const matches = groupCountsByLabel.matchByLabel[label] ?? 0;
        if (matches <= 0) continue;
        // if user explicitly collapsed this label, keep it collapsed
        if (next[label] === true) continue;
        next[label] = false;
      }
      return next;
    });
  }, [groupBy, groupCountsByLabel, isSearching]);

  const sortedGroupLabels = useMemo(() => {
    const keys = Object.keys(groupCountsByLabel?.totalByLabel ?? {});
    const otherKey = keys.find((k) => k.toLowerCase() === 'other');
    const rest = keys.filter((k) => k.toLowerCase() !== 'other');
    return [...sortBy(rest, (k) => k), ...(otherKey ? [otherKey] : [])];
  }, [groupCountsByLabel]);

  const handleExpandAllSections = useCallback(() => {
    setCollapsedSections({});
    scrollVirtuosoToTop();
  }, [scrollVirtuosoToTop]);

  const handleCollapseAllSections = useCallback(() => {
    if (!sortedGroupLabels.length) return;
    setCollapsedSections(
      sortedGroupLabels.reduce<Record<string, boolean>>((acc, label) => {
        acc[label] = true;
        return acc;
      }, {}),
    );
    scrollVirtuosoToTop();
  }, [scrollVirtuosoToTop, sortedGroupLabels]);

  const sectionHeaderClassName = useMemo(
    () =>
      cn(
        'flex w-full items-center justify-between gap-2 border-b bg-muted/90 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-sm',
        'transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      ),
    [],
  );

  const sectionHeaderRenderer = useCallback(
    (label: string) => {
      const isCollapsed = collapsedSections[label] === true;
      const totalCount = groupCountsByLabel?.totalByLabel[label] ?? 0;
      const matchCount = groupCountsByLabel?.matchByLabel[label] ?? 0;
      const countLabel = isSearching
        ? `${matchCount}/${totalCount}`
        : `${totalCount}`;
      return (
        <button
          type="button"
          className={sectionHeaderClassName}
          onClick={() => toggleSectionCollapsed(label)}
          aria-expanded={!isCollapsed}
        >
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'inline-block transition-transform duration-150 ease-in-out',
                isCollapsed ? '-rotate-90' : 'rotate-0',
              )}
              aria-hidden
            >
              ▾
            </span>
            <span className="flex items-baseline gap-2">
              <span>{label}</span>
              <span className="text-[10px] font-medium normal-case opacity-70">
                ({countLabel})
              </span>
            </span>
          </span>
          <span className="text-[10px] font-medium normal-case opacity-70">
            {isCollapsed ? 'collapsed' : 'expanded'}
          </span>
        </button>
      );
    },
    [
      collapsedSections,
      groupCountsByLabel,
      isSearching,
      sectionHeaderClassName,
      toggleSectionCollapsed,
    ],
  );

  const sectionHeaderSpacerRenderer = useCallback(
    (label: string) => {
      const isCollapsed = collapsedSections[label] === true;
      const totalCount = groupCountsByLabel?.totalByLabel[label] ?? 0;
      const matchCount = groupCountsByLabel?.matchByLabel[label] ?? 0;
      const countLabel = isSearching
        ? `${matchCount}/${totalCount}`
        : `${totalCount}`;
      return (
        <div
          className={cn(
            sectionHeaderClassName,
            'opacity-0 select-none pointer-events-none',
          )}
          aria-hidden
        >
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'inline-block transition-transform duration-150 ease-in-out',
                isCollapsed ? '-rotate-90' : 'rotate-0',
              )}
              aria-hidden
            >
              ▾
            </span>
            <span className="flex items-baseline gap-2">
              <span>{label}</span>
              <span className="text-[10px] font-medium normal-case opacity-70">
                ({countLabel})
              </span>
            </span>
          </span>
          <span className="text-[10px] font-medium normal-case opacity-70">
            {isCollapsed ? 'collapsed' : 'expanded'}
          </span>
        </div>
      );
    },
    [
      collapsedSections,
      groupCountsByLabel,
      isSearching,
      sectionHeaderClassName,
    ],
  );

  const listContentRenderer = useCallback(
    (index: number, entry: SectionOrItem<T> | T) => {
      if (!groupBy) {
        return itemRenderer(index, entry as T);
      }
      const row = entry as SectionOrItem<T>;
      if (row.type === 'item') {
        return itemRenderer(index, row.item);
      }
      // when this header is the one shown sticky above, render same-height spacer to avoid duplicate label
      if (row.label === stickySectionLabel) {
        return sectionHeaderSpacerRenderer(row.label);
      }
      return sectionHeaderRenderer(row.label);
    },
    [
      groupBy,
      itemRenderer,
      sectionHeaderRenderer,
      sectionHeaderSpacerRenderer,
      stickySectionLabel,
    ],
  );

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
      if (collapsedSections[key] === true) continue;
      for (const item of byKey.get(key)!) {
        flat.push({ type: 'item', item });
      }
    }
    return flat;
  }, [collapsedSections, filteredOptions, groupBy]);

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
      <SelectTrigger className={cn(triggerClassName)}>
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
        {groupBy && !isSearching && sortedGroupLabels.length > 0 && (
          <div className="px-2 pb-2">
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2 py-1">
              <span className="text-xs text-muted-foreground">Sections</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                  onClick={handleExpandAllSections}
                >
                  Expand all
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                  onClick={handleCollapseAllSections}
                >
                  Collapse all
                </button>
              </div>
            </div>
          </div>
        )}
        <div
          className="transition-opacity duration-150 ease-in-out min-h-[320px] relative"
          style={{ height: hasOptions ? 400 : undefined }}
        >
          {listWithSections && stickySectionLabel && hasOptions && (
            <div className="absolute left-0 right-0 top-0 z-20">
              {sectionHeaderRenderer(stickySectionLabel)}
            </div>
          )}
          {hasOptions ? (
            <Virtuoso
              ref={virtuosoRef}
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
