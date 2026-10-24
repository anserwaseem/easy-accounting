/* eslint-disable react/prop-types -- props typed via ReportColumnsMenuProps */
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Columns3, Search, X } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Input } from '@/renderer/shad/ui/input';
import { Label } from '@/renderer/shad/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/renderer/shad/ui/sheet';
import { useIsMobile } from '@/renderer/hooks/useIsMobile';
import { cn } from '@/renderer/lib/utils';

export interface ReportColumnOption {
  id: string;
  label: string;
}

interface ReportColumnsMenuProps {
  columns: readonly ReportColumnOption[];
  included: ReadonlySet<string>;
  onToggle: (id: string, next: boolean) => void;
  onToggleAll: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}

const prefersFinePointer = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const moveColumnFocus = (list: HTMLUListElement, key: string): void => {
  const items = Array.from(
    list.querySelectorAll<HTMLElement>('[role="checkbox"]'),
  );
  if (items.length === 0) return;

  const current = items.findIndex((item) => item === document.activeElement);
  let next = current;

  if (key === 'Home') next = 0;
  else if (key === 'End') next = items.length - 1;
  else if (key === 'ArrowDown') {
    next = Math.min(items.length - 1, current + 1);
  } else if (key === 'ArrowUp') {
    next = Math.max(0, current < 0 ? 0 : current - 1);
  } else return;

  const target = items[next];
  target?.focus();
  target?.scrollIntoView?.({ block: 'nearest' });
};

export const ReportColumnsMenu: React.FC<ReportColumnsMenuProps> = ({
  columns,
  included,
  onToggle,
  onToggleAll,
  disabled = false,
  className,
  label = 'Columns',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const searchId = useId();
  const listId = useId();
  const statusId = useId();

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      normalizedQuery
        ? columns.filter((column) =>
            column.label.toLowerCase().includes(normalizedQuery),
          )
        : columns,
    [columns, normalizedQuery],
  );

  const allIncluded = columns.length > 0 && included.size === columns.length;
  const allFilteredIncluded =
    filtered.length > 0 && filtered.every((column) => included.has(column.id));
  const filtering = normalizedQuery.length > 0;

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    // search is session-only; a reopened sheet starts from the full list
    if (!next) setQuery('');
  }, []);

  const handleOpenAutoFocus = useCallback((event: Event) => {
    // focusing the search field on a phone opens the keyboard over the list
    if (prefersFinePointer()) return;
    event.preventDefault();
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.focus({ preventScroll: true });
    }
  }, []);

  const handleBulk = useCallback(() => {
    if (!filtering) {
      onToggleAll(!allIncluded);
      return;
    }
    const next = !allFilteredIncluded;
    filtered.forEach((column) => {
      if (included.has(column.id) !== next) onToggle(column.id, next);
    });
  }, [
    allFilteredIncluded,
    allIncluded,
    filtered,
    filtering,
    included,
    onToggle,
    onToggleAll,
  ]);

  const handleClearQuery = useCallback(() => {
    setQuery('');
    if (prefersFinePointer()) searchRef.current?.focus();
  }, []);

  const handleCheckboxKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (
        event.key !== 'ArrowDown' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'Home' &&
        event.key !== 'End'
      ) {
        return;
      }
      const list = event.currentTarget.closest('ul');
      if (!(list instanceof HTMLUListElement)) return;
      event.preventDefault();
      moveColumnFocus(list, event.key);
    },
    [],
  );

  let bulkLabel = 'Show all';
  if (filtering) {
    bulkLabel = allFilteredIncluded ? 'Hide matches' : 'Show matches';
  } else if (allIncluded) {
    bulkLabel = 'Hide all';
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          className={cn('relative', className)}
          title={label}
          aria-label={`${label}, ${included.size} of ${columns.length} visible`}
        >
          <Columns3 className="h-4 w-4" aria-hidden />
          <span
            aria-hidden
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
          >
            {included.size}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        aria-modal="true"
        tabIndex={-1}
        onOpenAutoFocus={handleOpenAutoFocus}
        // definite height + column flex so the list (min-h-0) scrolls
        // and the search, bulk action, and Done stay on screen
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0',
          '[&>button.absolute]:flex [&>button.absolute]:h-11 [&>button.absolute]:w-11 [&>button.absolute]:items-center [&>button.absolute]:justify-center',
          'md:[&>button.absolute]:h-10 md:[&>button.absolute]:w-10',
          isMobile
            ? 'h-[min(92dvh,100%)] max-h-[92dvh] rounded-t-2xl'
            : 'h-full sm:max-w-md',
        )}
      >
        {isMobile ? (
          <div className="flex shrink-0 justify-center pt-2" aria-hidden>
            <div className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          </div>
        ) : null}

        <SheetHeader className="shrink-0 space-y-1 px-4 pb-3 pr-16 pt-4 text-left">
          <SheetTitle className="text-base">{label}</SheetTitle>
          <SheetDescription>
            Show or hide columns. The report updates immediately.
          </SheetDescription>
        </SheetHeader>

        <div className="shrink-0 space-y-3 border-b px-4 pb-3">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              id={searchId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a column…"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Find a column"
              aria-controls={listId}
              aria-describedby={statusId}
              className={cn('pl-9', query ? 'pr-10' : undefined)}
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2"
                aria-label="Clear search"
                onClick={handleClearQuery}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-2 md:h-9"
              onClick={handleBulk}
              disabled={filtered.length === 0}
            >
              {bulkLabel}
            </Button>
            <p
              id={statusId}
              className="text-xs tabular-nums text-muted-foreground"
            >
              {filtering
                ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`
                : `${included.size} of ${columns.length} shown`}
            </p>
          </div>
          <span className="sr-only" aria-live="polite">
            {filtering ? `${filtered.length} matching columns` : ''}
          </span>
        </div>

        <ul
          id={listId}
          aria-label={label}
          className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-2 py-2"
        >
          {filtered.length === 0 ? (
            <li className="px-2 py-8 text-center text-sm text-muted-foreground">
              No columns match “{query.trim()}”.
            </li>
          ) : (
            filtered.map((column) => {
              const inputId = `${listId}-${column.id}`;
              return (
                <li key={column.id}>
                  <div className="flex items-center gap-3 rounded-md px-2 hover:bg-muted">
                    <Checkbox
                      id={inputId}
                      className="my-3.5 md:my-2"
                      checked={included.has(column.id)}
                      onCheckedChange={(checked) =>
                        onToggle(column.id, checked === true)
                      }
                      onKeyDown={handleCheckboxKeyDown}
                    />
                    <Label
                      htmlFor={inputId}
                      className="min-h-11 flex-1 cursor-pointer py-2.5 font-normal leading-snug md:min-h-9"
                    >
                      <span className="break-words" dir="auto">
                        {column.label}
                      </span>
                    </Label>
                  </div>
                </li>
              );
            })
          )}
        </ul>

        <div
          className={cn(
            'flex shrink-0 border-t bg-background px-4 py-3',
            isMobile
              ? 'pb-[max(0.75rem,env(safe-area-inset-bottom))]'
              : 'justify-end',
          )}
        >
          <Button
            type="button"
            className={isMobile ? 'w-full' : undefined}
            onClick={() => handleOpenChange(false)}
          >
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

ReportColumnsMenu.displayName = 'ReportColumnsMenu';

export default ReportColumnsMenu;
