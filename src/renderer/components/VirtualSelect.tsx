import { debounce, sortBy, toString } from 'lodash';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Input } from '@/renderer/shad/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/renderer/shad/ui/popover';
import { cn } from '@/renderer/lib/utils';
import type { Account } from 'types';

const SEARCH_DEBOUNCE_MS = 300;
/** after choosing a value, block radix from refocusing the trigger for a while (onCloseAutoFocus can fire more than once) */
const SUPPRESS_POPOVER_REFOCUS_MS = 550;

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
  /** custom closed-state trigger content (e.g. name + trailing meta on the right); default is selected option name */
  renderTriggerValue?: (params: {
    selected: T | undefined;
    placeholder: string;
  }) => ReactNode;
  /** when empty, focus trigger input on mount (e.g. new invoice party field) */
  autoFocusTrigger?: boolean;
};

/** next/prev keyboard row; skips section headers so arrows move item-to-item */
const getAdjacentSelectableIndex = <T extends BaseOption>(
  virtuosoData: readonly (SectionOrItem<T> | T)[],
  fromIndex: number,
  direction: 1 | -1,
  grouped: boolean,
): number => {
  if (!grouped) {
    const next = fromIndex + direction;
    if (direction === 1) {
      return Math.min(next, Math.max(0, virtuosoData.length - 1));
    }
    return Math.max(next, 0);
  }
  const list = virtuosoData as SectionOrItem<T>[];
  if (direction === 1) {
    for (let i = fromIndex + 1; i < list.length; i += 1) {
      if (list[i].type === 'item') return i;
    }
    return fromIndex;
  }
  for (let i = fromIndex - 1; i >= 0; i -= 1) {
    if (list[i].type === 'item') return i;
  }
  return fromIndex;
};

const scheduleVirtuosoScrollToTop = (
  virtuosoRef: RefObject<VirtuosoHandle | null>,
) =>
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: 0, align: 'start' });
    });
  });

const scheduleVirtuosoItemIntoView = (
  virtuosoRef: RefObject<VirtuosoHandle | null>,
  index: number,
) =>
  queueMicrotask(() => {
    virtuosoRef.current?.scrollIntoView({ index, behavior: 'auto' });
  });

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
  renderTriggerValue,
  autoFocusTrigger = false,
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
  const [keyboardSelectedIndex, setKeyboardSelectedIndex] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const isTypingRef = useRef(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const prevIsOpenForKeyboardRef = useRef(false);
  const prevFilteredSearchForKeyboardRef = useRef(filteredSearchValue);
  const firstSelectableRowIndexRef = useRef(0);
  /** radix may fire onCloseAutoFocus more than once; time window blocks all trigger refocus after a value pick */
  const suppressCloseFocusUntilRef = useRef(0);

  const commitSelectionAndClose = useCallback(
    (nextValue: string | number) => {
      suppressCloseFocusUntilRef.current =
        Date.now() + SUPPRESS_POPOVER_REFOCUS_MS;
      onChange(nextValue);
      setIsOpen(false);
    },
    [onChange],
  );

  const scrollVirtuosoToTop = useCallback(() => {
    scheduleVirtuosoScrollToTop(virtuosoRef);
  }, []);

  // maintain focus on input while typing
  useEffect(() => {
    if (!isOpen) return undefined;
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

  const debouncedSetFilteredValue = useMemo(
    () =>
      debounce((search: string) => {
        setFilteredSearchValue(search);
        isTypingRef.current = false;
      }, SEARCH_DEBOUNCE_MS),
    [],
  );

  const handleSearchInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      isTypingRef.current = true;
      setSearchInputValue(e.target.value);
      debouncedSetFilteredValue(e.target.value);
      if (!isOpen) setIsOpen(true);
    },
    [debouncedSetFilteredValue, isOpen],
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

  const selectedOption = useMemo(
    () =>
      options.find(
        (opt) => opt.id?.toString() === value?.toString() && value !== '0',
      ),
    [options, value],
  );

  const isSearching = filteredSearchValue.trim().length > 0;

  const toggleSectionCollapsed = useCallback(
    (label: string) => {
      setCollapsedSections((prev) => ({
        ...prev,
        [label]: !prev[label],
      }));
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
      setKeyboardSelectedIndex(0);
    }
  }, []);

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

  useEffect(() => {
    if (!groupBy || !isSearching || !groupCountsByLabel) return;
    setCollapsedSections((prev) => {
      const next = { ...prev };
      for (const label of Object.keys(groupCountsByLabel.matchByLabel)) {
        const matches = groupCountsByLabel.matchByLabel[label] ?? 0;
        if (matches <= 0) continue;
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
    (label: string, isSpacer = false) => {
      const isCollapsed = collapsedSections[label] === true;
      const totalCount = groupCountsByLabel?.totalByLabel[label] ?? 0;
      const matchCount = groupCountsByLabel?.matchByLabel[label] ?? 0;
      const countLabel = isSearching
        ? `${matchCount}/${totalCount}`
        : `${totalCount}`;

      const content = (
        <>
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
        </>
      );

      if (isSpacer) {
        return (
          <div
            className={cn(
              sectionHeaderClassName,
              'opacity-0 select-none pointer-events-none',
            )}
            aria-hidden
          >
            {content}
          </div>
        );
      }

      return (
        <button
          type="button"
          className={sectionHeaderClassName}
          onClick={() => toggleSectionCollapsed(label)}
          aria-expanded={!isCollapsed}
        >
          {content}
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

  /** px to subtract from radix available height so list + headers stay in viewport when popover flips */
  const listShellChromeReservePx = useMemo(() => {
    let reservePx = 20; // borders, spacing
    if (selectedOption) reservePx += 64; // search row (p-2 + input)
    if (groupBy && !isSearching && sortedGroupLabels.length > 0)
      reservePx += 80; // sections toolbar block
    return reservePx;
  }, [selectedOption, groupBy, isSearching, sortedGroupLabels.length]);

  const listShellStyle = useMemo((): CSSProperties | undefined => {
    if (!hasOptions) return undefined;
    const cap = `min(400px, max(120px, calc(var(--radix-popper-available-height, 100dvh) - ${listShellChromeReservePx}px)))`;
    return { height: cap, maxHeight: cap };
  }, [hasOptions, listShellChromeReservePx]);

  // with groupBy, row 0 is often a section header — keyboard selection must start on first real option so Enter matches party selector behavior
  const firstSelectableRowIndex = useMemo(() => {
    if (!groupBy) return 0;
    const list = virtuosoData as SectionOrItem<T>[];
    const idx = list.findIndex((row) => row.type === 'item');
    return idx === -1 ? 0 : idx;
  }, [groupBy, virtuosoData]);

  firstSelectableRowIndexRef.current = firstSelectableRowIndex;

  useLayoutEffect(() => {
    if (!isOpen) {
      prevIsOpenForKeyboardRef.current = false;
      prevFilteredSearchForKeyboardRef.current = filteredSearchValue;
      return;
    }
    const openedNow = !prevIsOpenForKeyboardRef.current;
    const searchChanged =
      prevFilteredSearchForKeyboardRef.current !== filteredSearchValue;
    prevIsOpenForKeyboardRef.current = true;
    prevFilteredSearchForKeyboardRef.current = filteredSearchValue;
    if (openedNow || searchChanged) {
      const idx = firstSelectableRowIndexRef.current;
      setKeyboardSelectedIndex(idx);
      scheduleVirtuosoItemIntoView(virtuosoRef, idx);
    }
  }, [isOpen, filteredSearchValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLButtonElement>) => {
      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setKeyboardSelectedIndex((prev) => {
          const next = getAdjacentSelectableIndex(
            virtuosoData,
            prev,
            1,
            !!groupBy,
          );
          scheduleVirtuosoItemIntoView(virtuosoRef, next);
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setKeyboardSelectedIndex((prev) => {
          const next = getAdjacentSelectableIndex(
            virtuosoData,
            prev,
            -1,
            !!groupBy,
          );
          scheduleVirtuosoItemIntoView(virtuosoRef, next);
          return next;
        });
      } else if (e.key === 'Enter' && hasOptions) {
        e.preventDefault();
        const current = virtuosoData[keyboardSelectedIndex];
        if (current) {
          if (groupBy && 'type' in current) {
            if (current.type === 'item') {
              commitSelectionAndClose(
                (current.item as T).id as string | number,
              );
            } else {
              toggleSectionCollapsed(current.label);
            }
          } else {
            commitSelectionAndClose((current as T).id as string | number);
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
      }
    },
    [
      isOpen,
      virtuosoData,
      keyboardSelectedIndex,
      hasOptions,
      groupBy,
      commitSelectionAndClose,
      toggleSectionCollapsed,
    ],
  );

  const itemRenderer = useCallback(
    (index: number, item: T) => {
      const isSelected = index === keyboardSelectedIndex;
      return (
        <div
          role="option"
          aria-selected={isSelected}
          tabIndex={-1}
          key={item?.id?.toString() || crypto.randomUUID()}
          onMouseDown={(e) => {
            if (isTypingRef.current) e.preventDefault();
          }}
          onClick={() => {
            commitSelectionAndClose(item.id as string | number);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              commitSelectionAndClose(item.id as string | number);
            }
          }}
          onMouseEnter={() => setKeyboardSelectedIndex(index)}
          className={cn(
            'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors',
            isSelected
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50',
          )}
        >
          {renderSelectItem
            ? renderSelectItem(item)
            : defaultRenderSelectItem(item)}
        </div>
      );
    },
    [
      keyboardSelectedIndex,
      commitSelectionAndClose,
      renderSelectItem,
      defaultRenderSelectItem,
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
      if (row.label === stickySectionLabel) {
        return sectionHeaderRenderer(row.label, true);
      }
      // otherwise, it's a section header; we wrap it to allow highlighting when selected
      const isSelected = index === keyboardSelectedIndex;
      return (
        <div
          onMouseEnter={() => setKeyboardSelectedIndex(index)}
          className={cn(isSelected && 'ring-2 ring-inset ring-ring')}
        >
          {sectionHeaderRenderer(row.label, false)}
        </div>
      );
    },
    [
      groupBy,
      itemRenderer,
      sectionHeaderRenderer,
      stickySectionLabel,
      keyboardSelectedIndex,
    ],
  );

  useEffect(() => {
    if (!listWithSections?.length || !isOpen) return;
    const first = listWithSections[0];
    if (first.type === 'header') {
      setStickySectionLabel(first.label);
    }
  }, [listWithSections, isOpen]);

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

  // focus effect when opening: if we started with the unselected input, the input retains focus
  // if we used the button, we should focus the inner search input inside PopoverContent
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      // avoid stealing focus from the trigger input if it's already focused
      if (
        document.activeElement !== searchInputRef.current &&
        !!selectedOption
      ) {
        searchInputRef.current.focus();
      }
    }
  }, [isOpen, selectedOption]);

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            'relative flex w-full min-h-10 items-stretch rounded-md border border-input bg-background text-sm shadow-sm focus-within:ring-1 focus-within:ring-ring',
            triggerClassName,
          )}
        >
          {!selectedOption ? (
            <Input
              value={searchInputValue}
              onChange={handleSearchInputChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              className="my-0 h-10 min-h-10 w-full flex-1 border-0 bg-transparent px-3 py-2 text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
              autoComplete="off"
              autoCapitalize="off"
              autoFocus={autoFocusTrigger}
            />
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setIsOpen(true)}
              onKeyDown={handleKeyDown}
              className="flex w-full flex-1 items-center self-stretch bg-transparent px-0 py-0 text-left text-sm font-normal outline-none"
            >
              {renderTriggerValue ? (
                renderTriggerValue({ selected: selectedOption, placeholder })
              ) : (
                <span className="block w-full truncate px-3 py-2 text-left">
                  {selectedOption?.name || placeholder}
                </span>
              )}
            </button>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="flex max-h-[min(520px,var(--radix-popper-available-height,100dvh))] w-[var(--radix-popover-trigger-width)] flex-col overflow-hidden p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          // We do not want popover to auto focus and blur our Trigger Input if we didn't have an option selected
          if (!selectedOption) e.preventDefault();
        }}
        onCloseAutoFocus={(e) => {
          if (Date.now() < suppressCloseFocusUntilRef.current) {
            e.preventDefault();
          }
        }}
      >
        {!!selectedOption && (
          <div className="shrink-0 border-b border-border p-2">
            <Input
              ref={searchInputRef}
              value={searchInputValue}
              onChange={handleSearchInputChange}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder || 'Search...'}
              className="w-full"
              autoComplete="off"
            />
          </div>
        )}
        {groupBy && !isSearching && sortedGroupLabels.length > 0 && (
          <div className="mt-2 shrink-0 px-2 pb-2">
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
          className={cn(
            'relative mt-1 flex min-h-0 flex-col transition-opacity duration-150 ease-in-out',
            !hasOptions && 'min-h-[8rem]',
          )}
          style={listShellStyle}
        >
          {listWithSections && stickySectionLabel && hasOptions && (
            <div className="absolute left-0 right-0 top-0 z-20">
              {sectionHeaderRenderer(stickySectionLabel, false)}
            </div>
          )}
          {hasOptions ? (
            <Virtuoso
              ref={virtuosoRef}
              data={virtuosoData}
              style={{ height: '100%' }}
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
      </PopoverContent>
    </Popover>
  );
};

export default VirtualSelect;
