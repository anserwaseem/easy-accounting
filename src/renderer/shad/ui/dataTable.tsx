import {
  type ColumnDef as ColDef,
  type Row,
  type TableOptions,
  type SortingState,
  type SortDirection,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from 'renderer/shad/ui/table';
import { clamp, debounce, get, toString } from 'lodash';
import { cn, getSearchTerms, matchesSearchTerms } from '@/renderer/lib/utils';
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  TableVirtuoso,
  Virtuoso,
  type TableVirtuosoHandle,
} from 'react-virtuoso';
import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/renderer/shad/ui/tooltip';
import {
  useMediaQuery,
  useIsSmallScreenUp,
  useIsLargeScreenUp,
} from '@/renderer/hooks/useMediaQuery';
import { CompactSearchBar } from './compactSearchBar';
import { Search } from './search';

export type ColumnDef<TData, TValue = unknown> = ColDef<TData, TValue> & {
  onClick?: (row: Row<TData>) => void;
  /** explanatory text shown as a tooltip on the column header */
  headerTooltip?: string;
  /**
   * Responsive visibility/sizing classes applied to this column's header
   * and body cells (e.g. `hidden sm:table-cell`). Unset on desktop-only
   * columns so layout remains byte-identical.
   */
  responsiveClassName?: string;
  /**
   * Breakpoint below which this column is hidden.
   *
   * `sm` hides the column under 640px, `md` under 768px, `lg` under 1024px.
   *
   * Prefer this over `responsiveClassName: 'hidden sm:table-cell'`: a
   * column hidden with a plain CSS class still contributes its `size` to
   * TanStack's `getTotalSize()`, which is the `minWidth` the scroll
   * container is sized to — so the table stays as wide as the hidden
   * column and the horizontal scroll never actually shrinks. This
   * property removes the column from the layout entirely below the
   * breakpoint.
   *
   * Hiding a column drops information the user may need. Prefer the
   * card layout (see `cardLayout` on the table) on a phone: it shows
   * EVERY column, stacked and labelled, instead of a table that is
   * either too wide to read or missing data.
   */
  hideBelow?: 'sm' | 'md' | 'lg';
  /**
   * In the card layout, this column is the card's headline: it is
   * rendered large and unlabelled at the top of the card, and the
   * remaining columns follow as labelled rows beneath it.
   *
   * The first visible column is the headline by default.
   */
  cardHeadline?: boolean;
  /**
   * In the card layout, this column is laid out on the headline's row
   * (to the right of it) rather than as its own labelled row — for the
   * one other number a reader wants at a glance, e.g. the amount.
   */
  cardAside?: boolean;
  /**
   * In the card layout, this column is omitted entirely. For a column
   * that carries no information on its own (a row number, a kind of
   * icon) once the card has given the row some context.
   */
  cardHidden?: boolean;
  /**
   * In the card layout, this column takes the full card width and is
   * left-aligned rather than right-aligned in a label/value row. For a
   * column holding an input or a select, which needs the whole width
   * to be usable.
   */
  cardFullWidth?: boolean;
  /**
   * The label shown for this column in the card layout. Defaults to the
   * column's header when that is a string; set it when the header is a
   * node (an icon, a formatted label) or when the fallback would be
   * meaningless (the raw column id).
   */
  cardLabel?: string;
};

// TODO: search by field(s)
interface DataTableProps<TData, TValue> extends Partial<TableOptions<TData>> {
  columns: ColDef<TData, TValue>[];
  data: TData[];
  className?: string;
  getRowKey?: (row: TData, index: number) => string | number;
  defaultSortField?: keyof TData;
  defaultSortDirection?: SortDirection;
  infoData?: React.ReactNode[][];
  virtual?: boolean;
  /** tighter row/header/cell padding for dense grids */
  compact?: boolean;
  /**
   * Render each row as a card on a phone instead of a table row.
   *
   * The table layout needs a horizontal scroll on a narrow screen, and
   * every column that does not fit is either cut off or hidden. The card
   * layout shows EVERY column: the headline (the first column, or one
   * marked `cardHeadline`) at the top, the `cardAside` column beside it,
   * and the rest as labelled rows underneath. Nothing is dropped.
   *
   * Defaults to true below 640px, which is where the table layout stops
   * being readable. Pass false to keep the table at every width.
   */
  cardLayout?: boolean;
  /**
   * controls how virtual table height is computed
   * - content: shrink-to-rows (best for editors/forms; reduces wasted space)
   * - fill: grow to available viewport space (best for reports/list screens)
   */
  virtualHeightMode?: 'content' | 'fill';
  /**
   * one cell per visible column; widths match tanstack column sizes.
   * stays aligned with virtual + non-virtual tables; hidden when printing.
   */
  stickyFooterRow?: React.ReactNode[];
  virtualScrollToIndex?: number | null;
  /**
   * optional detail panel rendered in its own full-width row beneath an
   * expanded row. Virtuoso owns the <tr> and itemContent returns only its
   * cells, so a detail panel cannot be nested inside the row it belongs to;
   * it is interleaved as a separate item spanning every column instead.
   * Expansion state stays with the caller so the table holds no row state.
   * Virtual tables only.
   */
  renderRowDetail?: (row: TData) => React.ReactNode;
  isRowExpanded?: (row: TData) => boolean;
  searchPlaceholder?: string;
  searchFields?: string[];
  isMini?: boolean;
  searchPersistenceKey?: string;
  /** focus the table search field when the page mounts (listing screens) */
  autoFocusSearch?: boolean;
  /** disable search input (e.g. inventory bulk edit while dirty) */
  searchDisabled?: boolean;
  /**
   * current visible rows after search + sort (for export/print parity with grid).
   * parent should keep callback ref-stable (useCallback) to avoid extra runs.
   */
  onViewModelChange?: (rows: TData[]) => void;
}

const subscribeWindowInnerHeight = (cb: () => void) => {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
};

const getWindowInnerHeightSnapshot = () => window.innerHeight;

const TableComponent = forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <table
    ref={ref}
    className={cn('w-full caption-bottom text-sm', className)}
    {...props}
  />
));
TableComponent.displayName = 'TableComponent';

const SortingIndicator = ({ isSorted }: { isSorted: string | false }) => {
  if (!isSorted) return null;
  return (
    <span className="ml-1">
      {
        {
          asc: '↑',
          desc: '↓',
        }[isSorted]
      }
    </span>
  );
};

const HeaderCellContent = ({ header }: { header: any }) => {
  const tooltip = header.column.columnDef.headerTooltip as string | undefined;
  return (
    <div className="flex items-center gap-1">
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        className="flex items-center gap-1"
        {...{
          style: header.column.getCanSort()
            ? {
                cursor: 'pointer',
                userSelect: 'none',
              }
            : {},
          onClick: header.column.getToggleSortingHandler(),
        }}
      >
        {flexRender(header.column.columnDef.header, header.getContext())}
        <SortingIndicator isSorted={header.column.getIsSorted()} />
      </div>
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger type="button" asChild>
            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help flex-shrink-0" />
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-xs text-xs">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
};

const HeaderRow = ({
  headerGroup,
  compact,
}: {
  headerGroup: any;
  compact?: boolean;
}) => (
  <TableRow className="bg-card hover:bg-muted" key={headerGroup.id}>
    <TooltipProvider>
      {headerGroup.headers.map((header: any) => (
        <TableHead
          key={header.id}
          colSpan={header.colSpan}
          className={cn(
            // Header used a hard grey in both themes — a light slab that
            // fought the page in light mode and a mismatched grey in dark
            // mode. It now uses the muted token so it tracks the theme.
            header.column.getIsSorted()
              ? 'bg-muted text-foreground'
              : 'bg-muted/60 text-muted-foreground',
            compact ? 'h-7 px-2 py-1 text-xs' : 'h-8',
            (header.column.columnDef as ColumnDef<unknown>)
              ?.responsiveClassName,
          )}
          style={{
            width: header.getSize(),
          }}
        >
          {header.isPlaceholder ? null : <HeaderCellContent header={header} />}
        </TableHead>
      ))}
    </TooltipProvider>
  </TableRow>
);

const NoResultsRow = ({
  columns,
  searchFields,
  searchValue,
}: {
  columns: any[];
  searchFields?: string[];
  searchValue?: string;
}) => (
  <TableRow>
    <TableCell colSpan={columns.length} className="h-24 text-center">
      <div className="flex flex-col items-center justify-center text-muted-foreground">
        <p>No results found</p>
        {searchFields?.length && searchValue && (
          <p className="text-sm mt-1">Try adjusting your search criteria</p>
        )}
      </div>
    </TableCell>
  </TableRow>
);

const RecordCount = ({
  filtered,
  total,
}: {
  filtered: number;
  total: number;
}) => {
  if (filtered === total) {
    return (
      <p className="text-sm text-muted-foreground">Total records: {total}</p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      Showing {filtered} out of {total} records
    </p>
  );
};

const DataTable = <TData, TValue>({
  columns,
  data,
  className,
  getRowKey,
  defaultSortField,
  defaultSortDirection = 'asc',
  infoData,
  virtual = false,
  compact = false,
  cardLayout,
  virtualHeightMode = 'content',
  stickyFooterRow,
  virtualScrollToIndex = null,
  renderRowDetail,
  isRowExpanded,
  searchPlaceholder,
  searchFields,
  isMini = false,
  searchPersistenceKey,
  autoFocusSearch = false,
  searchDisabled = false,
  onViewModelChange,
  state: userTableState,
  onSortingChange: userOnSortingChange,
  ...restTableOptions
}: DataTableProps<TData, TValue>) => {
  const [sorting, setSorting] = useState<SortingState>(() => {
    if (!defaultSortField) return [];
    return [
      {
        id: defaultSortField.toString(),
        desc: defaultSortDirection === 'desc',
      },
    ];
  });
  const [searchValue, setSearchValue] = useState('');
  const [searchInputValue, setSearchInputValue] = useState('');

  // Breakpoint state for `hideBelow` columns. Each is a separate media
  // query so a column can declare its own threshold.
  const isSmUp = useIsSmallScreenUp();
  const isMdUp = useMediaQuery('(min-width: 768px)');
  const isLgUp = useIsLargeScreenUp();

  /**
   * Maps `hideBelow` on each column to a `columnVisibility` entry.
   *
   * TanStack's `columnVisibility` is keyed by column id, where `false`
   * hides the column outright: no header cell, no body cell, and no
   * width contribution to `getTotalSize()`.
   *
   * Only ever sets `false`. A column that the user hid through a
   * "Columns" menu must stay hidden, so a `hideBelow` rule that happens
   * to be satisfied at the current width must not flip it back on.
   */
  const hiddenColumnVisibility = useMemo(() => {
    const visibility: Record<string, boolean> = {};
    for (const column of columns) {
      const { hideBelow } = column as ColumnDef<TData, TValue>;
      if (!hideBelow) continue;
      let withinBreakpoint: boolean;
      if (hideBelow === 'sm') withinBreakpoint = isSmUp;
      else if (hideBelow === 'md') withinBreakpoint = isMdUp;
      else withinBreakpoint = isLgUp;
      if (withinBreakpoint) continue; // wide enough to show it
      // TanStack derives the column id from `id`, else `accessorKey`,
      // else the header string. Mirror that exactly so the visibility
      // key always matches the id the table actually uses — a column
      // defined only by `header: 'Price'` has the id "Price".
      const accessorKey =
        'accessorKey' in column && typeof column.accessorKey === 'string'
          ? column.accessorKey
          : undefined;
      const headerId =
        typeof column.header === 'string' ? column.header : undefined;
      const id = column.id ?? accessorKey ?? headerId;
      if (typeof id === 'string') visibility[id] = false;
    }
    return visibility;
  }, [columns, isSmUp, isMdUp, isLgUp]);
  const containerRef = useRef<HTMLDivElement>(null);
  const isSearchHydratedRef = useRef(false);
  const [fillMeasure, setFillMeasure] = useState<{
    rectTop: number;
    searchBarHeight: number;
  } | null>(null);

  const windowInnerHeight = useSyncExternalStore(
    subscribeWindowInnerHeight,
    getWindowInnerHeightSnapshot,
    () => 900,
  );

  const filteredData = useMemo(() => {
    if (!searchValue || !searchFields?.length) {
      return data;
    }

    // each word must hit some field (not necessarily the same one), so 'AYESHA SADIQA' finds
    // 'MAKTABA AYESHA SADIQA' and word order/extra spacing don't matter
    const searchTerms = getSearchTerms(searchValue);
    return data.filter((item) =>
      matchesSearchTerms(
        searchFields.map((field) => get(item, field)),
        searchTerms,
      ),
    );
  }, [searchValue, data, searchFields]);

  // debounced search handler
  const debounceSearch = useMemo(
    () =>
      debounce((value: string) => {
        setSearchValue(value);
      }, 300),
    [],
  );
  useLayoutEffect(() => () => debounceSearch.cancel(), [debounceSearch]);

  const handleSearchInputChange = (value: string) => {
    setSearchInputValue(value);
    debounceSearch(value);
  };

  useLayoutEffect(() => {
    isSearchHydratedRef.current = false;
    if (!searchPersistenceKey) {
      isSearchHydratedRef.current = true;
      return;
    }

    const persistedSearchValue =
      window.electron.store.get(searchPersistenceKey);
    const normalizedSearchValue =
      typeof persistedSearchValue === 'string' ? persistedSearchValue : '';
    setSearchInputValue(normalizedSearchValue);
    setSearchValue(normalizedSearchValue);
    isSearchHydratedRef.current = true;
  }, [searchPersistenceKey]);

  useLayoutEffect(() => {
    if (!searchPersistenceKey) return;
    if (!isSearchHydratedRef.current) return;
    window.electron.store.set(searchPersistenceKey, searchInputValue);
  }, [searchPersistenceKey, searchInputValue]);

  const resolveRowKey = useCallback(
    (row: TData, index: number) => getRowKey?.(row, index) ?? index,
    [getRowKey],
  );

  const table = useReactTable({
    ...restTableOptions,
    data: filteredData,
    columns,
    getRowId: (originalRow, index) =>
      toString(resolveRowKey(originalRow, index)),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: {
      ...userTableState,
      sorting,
      // Columns whose `hideBelow` breakpoint has passed are removed from
      // the visible set here, so they contribute neither a cell nor a
      // width to `getTotalSize()` — the scroll container shrinks with
      // them.
      columnVisibility: {
        ...(userTableState?.columnVisibility ?? {}),
        ...hiddenColumnVisibility,
      },
    },
    onSortingChange: (updater) => {
      setSorting(updater);
      userOnSortingChange?.(updater);
    },
  });

  const { rows } = table.getRowModel();

  const tableVirtuosoRef = useRef<TableVirtuosoHandle | null>(null);

  const tableRef = useRef(table);
  tableRef.current = table;
  const onViewModelChangeRef = useRef(onViewModelChange);
  onViewModelChangeRef.current = onViewModelChange;

  useLayoutEffect(() => {
    onViewModelChangeRef.current?.(
      tableRef.current.getRowModel().rows.map((r) => r.original),
    );
  }, [filteredData, sorting, searchValue]);

  useLayoutEffect(() => {
    if (!virtual) return;
    if (virtualScrollToIndex == null || virtualScrollToIndex < 0) return;
    requestAnimationFrame(() => {
      tableVirtuosoRef.current?.scrollToIndex({
        index: virtualScrollToIndex,
        align: 'end',
        behavior: 'auto',
      });
    });
  }, [virtual, virtualScrollToIndex]);

  const recordCount = {
    filtered: rows.length,
    total: data.length,
  };

  const searchClassName = useMemo(() => 'w-full md:w-[320px]', []);

  // Tighter horizontal padding on a phone: 16px on each side of six
  // columns is 192px of a 366px content area.
  const cellPad = compact ? 'py-1 px-2' : 'py-2 px-2 sm:px-4';

  const hasStickyFooter = Boolean(
    stickyFooterRow && stickyFooterRow.length > 0,
  );

  const measureFill = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rectTop = container.getBoundingClientRect().top;
    const searchBarHeight =
      container.querySelector('.search-container')?.getBoundingClientRect()
        .height ?? 0;

    setFillMeasure((prev) => {
      if (
        prev &&
        Math.abs(prev.rectTop - rectTop) < 0.5 &&
        Math.abs(prev.searchBarHeight - searchBarHeight) < 0.5
      ) {
        return prev;
      }
      return { rectTop, searchBarHeight };
    });
  }, []);

  useLayoutEffect(() => {
    if (!virtual) return;
    if (virtualHeightMode !== 'fill') return;

    // run once after mount/layout, then again on next frame to catch late layout shifts
    measureFill();
    const raf = requestAnimationFrame(measureFill);

    // keep the measurement fresh as the table moves (scrolling) or resizes (layout shifts)
    window.addEventListener('scroll', measureFill, true);

    let ro: ResizeObserver | null = null;
    // measuring on the next frame rather than inside the callback: measureFill resizes the
    // table it is observing, and doing that synchronously makes the browser report
    // "ResizeObserver loop limit exceeded" — harmless, but it lands as an uncaught error
    let measureRaf = 0;
    const measureNextFrame = () => {
      cancelAnimationFrame(measureRaf);
      measureRaf = requestAnimationFrame(measureFill);
    };
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measureNextFrame);
      const container = containerRef.current;
      if (container) {
        ro.observe(container);
        const searchEl = container.querySelector('.search-container');
        if (searchEl) ro.observe(searchEl);
      }
    }

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(measureRaf);
      window.removeEventListener('scroll', measureFill, true);
      ro?.disconnect();
    };
  }, [measureFill, virtual, virtualHeightMode, windowInnerHeight]);

  const virtualTableHeight = useMemo(() => {
    if (!virtual) return 0;

    if (virtualHeightMode === 'fill') {
      if (!fillMeasure) {
        // avoid over-estimation before first layout measurement
        return clamp(Math.floor(windowInnerHeight * 0.4), 240, 560);
      }

      // fill available space from table top to viewport bottom, minus search bar and padding.
      const availablePx =
        windowInnerHeight -
        fillMeasure.rectTop -
        fillMeasure.searchBarHeight -
        24;
      const minPx = 240;
      const maxPx = Math.max(320, windowInnerHeight - 120);
      return clamp(availablePx, minPx, maxPx);
    }

    // compact grid: tighter row heights; estimate is only used to avoid large wasted space.
    const headerRowPx = compact ? 28 : 32;
    const bodyRowPx = compact ? 32 : 40;
    const footerRowPx = hasStickyFooter ? bodyRowPx : 0;

    // empty state needs breathing room for "No results" copy.
    const emptyStatePx = rows.length ? 0 : 160;
    const contentPx =
      headerRowPx + footerRowPx + rows.length * bodyRowPx + emptyStatePx;

    // keep table usable but avoid pushing totals/actions below fold on small invoices.
    const minPx = 160;
    const maxPx = Math.max(240, Math.floor(windowInnerHeight * 0.55));

    return clamp(contentPx, minPx, maxPx);
  }, [
    compact,
    fillMeasure,
    hasStickyFooter,
    rows.length,
    virtual,
    virtualHeightMode,
    windowInnerHeight,
  ]);

  const leafHeaders =
    table.getHeaderGroups()[0]?.headers.filter((h) => !h.isPlaceholder) ?? [];

  // The card layout replaces the table below 640px, where a table can
  // only be read by scrolling sideways and every column that does not
  // fit is either cut off or hidden. It shows every column instead.
  const useCardLayout = cardLayout ?? !isSmUp;

  const renderStickyFooterTableRow = () => {
    if (!hasStickyFooter || !stickyFooterRow) return null;
    return (
      <TableRow className="print:hidden border-t bg-background hover:bg-background [&>td]:bg-background">
        {leafHeaders.map((header, i) => {
          const w = header.column.getSize();
          return (
            <TableCell
              key={header.id}
              className={cn(
                cellPad,
                'align-middle whitespace-nowrap bg-background',
              )}
              style={{
                width: w,
                minWidth: w,
                maxWidth: w,
              }}
            >
              {stickyFooterRow[i] ?? null}
            </TableCell>
          );
        })}
      </TableRow>
    );
  };

  const renderInfoRowsTable = () => {
    if (!infoData?.length) return null;
    return (
      <div className="border-t overflow-x-auto">
        <Table className="table-fixed">
          <colgroup>
            {leafHeaders.map((header) => (
              <col key={header.id} style={{ width: header.column.getSize() }} />
            ))}
          </colgroup>
          <TableBody>
            {infoData.map((row, rowIndex) => (
              <TableRow
                // eslint-disable-next-line react/no-array-index-key
                key={`virtual-info-row-${rowIndex}`}
                className="bg-muted/50 font-medium"
              >
                {row.map((cell, cellIndex) => (
                  <TableCell
                    // eslint-disable-next-line react/no-array-index-key
                    key={`virtual-info-cell-${rowIndex}-${cellIndex}`}
                    className={cellPad}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  /**
   * The card layout: one card per row, every column shown.
   *
   * A table on a phone is a horizontal scroll with columns cut off at
   * the edge. The card layout stacks the same data instead: the
   * headline column large at the top-left, the `cardAside` column
   * (the amount, usually) on the same row, and every remaining column
   * as a labelled row underneath. Nothing is hidden and nothing needs
   * scrolling sideways.
   */
  const rowKeyOf = (row: Row<TData>) =>
    toString(resolveRowKey(row.original, row.index));

  const renderCard = (row: Row<TData>) => {
    const cells = row.getVisibleCells();
    if (cells.length === 0) return null;

    const defOf = (cell: (typeof cells)[number]) =>
      cell.column.columnDef as ColumnDef<TData, TValue>;

    const visible = cells.filter((c) => !defOf(c).cardHidden);
    if (visible.length === 0) return null;

    // A column marked `cardFullWidth` takes the whole card, so it cannot
    // also be the headline — otherwise its content is rendered twice.
    const fullWidthCells = visible.filter((c) => defOf(c).cardFullWidth);
    const headlineCandidates = visible.filter((c) => !defOf(c).cardFullWidth);
    const headlineCell =
      headlineCandidates.find((c) => defOf(c).cardHeadline) ??
      headlineCandidates[0] ??
      fullWidthCells[0];
    const asideCell = visible.find(
      (c) => c !== headlineCell && defOf(c).cardAside,
    );
    const restCells = visible.filter(
      (c) => c !== headlineCell && c !== asideCell && !defOf(c).cardFullWidth,
    );
    // A headline that is also full-width would render its content twice
    // (once in the headline row, once in the full-width block). Drop it
    // from the full-width block and let the headline row carry it.
    const headlineIsFullWidth = fullWidthCells.includes(headlineCell);
    const fullWidthRenderCells = headlineIsFullWidth
      ? fullWidthCells.filter((c) => c !== headlineCell)
      : fullWidthCells;

    const cellContent = (cell: (typeof cells)[number]) => (
      <div key={`${rowKeyOf(row)}:${cell.column.id}`}>
        {flexRender(cell.column.columnDef.cell, cell.getContext())}
      </div>
    );

    const labelFor = (cell: (typeof cells)[number]) => {
      const explicit = defOf(cell).cardLabel;
      if (explicit) return explicit;
      const { header } = cell.column.columnDef;
      if (typeof header === 'string') return header;
      if (typeof header === 'number') return String(header);
      return cell.column.id;
    };

    return (
      <div
        key={rowKeyOf(row)}
        // A stable hook for the e2e tests: the card's headline is the
        // row's identity, and on a phone it is the only way to reach
        // the row's detail screen (there is no `cell` role any more).
        data-card-headline={
          headlineCell ? String(headlineCell.column.id) : undefined
        }
        className="rounded-lg border bg-card p-3 text-card-foreground"
      >
        {headlineCell && !headlineIsFullWidth ? (
          <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              className="min-w-0 flex-1 text-left text-[15px] font-medium leading-snug"
              onClick={() => defOf(headlineCell).onClick?.(row)}
            >
              {defOf(headlineCell).cardLabel ? (
                <span className="mb-0.5 block text-xs font-normal text-muted-foreground">
                  {defOf(headlineCell).cardLabel}
                </span>
              ) : null}
              {cellContent(headlineCell)}
            </button>
            {asideCell ? (
              <button
                type="button"
                className="shrink-0 text-right text-[15px] font-semibold tabular-nums"
                onClick={() => defOf(asideCell).onClick?.(row)}
              >
                {cellContent(asideCell)}
              </button>
            ) : null}
          </div>
        ) : null}
        {!headlineCell && asideCell ? (
          // No headline, but there is an action: it gets its own row.
          <div className="flex justify-end">
            <button
              type="button"
              className="shrink-0 text-right text-[15px] font-semibold tabular-nums"
              onClick={() => defOf(asideCell).onClick?.(row)}
            >
              {cellContent(asideCell)}
            </button>
          </div>
        ) : null}

        {fullWidthRenderCells.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2 border-t pt-2">
            {fullWidthRenderCells.map((cell) => (
              <div key={`${rowKeyOf(row)}:${cell.column.id}:full`}>
                {/* A full-width field is usually an input or a select,
                    which needs to say what it is — a bare input with no
                    label is not identifiable. */}
                {defOf(cell).cardLabel ? (
                  <p className="mb-1 text-xs text-muted-foreground">
                    {defOf(cell).cardLabel}
                  </p>
                ) : null}
                {cellContent(cell)}
              </div>
            ))}
          </div>
        ) : null}

        {restCells.length > 0 ? (
          <dl className="mt-2 flex flex-col gap-1 border-t pt-2">
            {restCells.map((cell) => (
              <div
                key={`${rowKeyOf(row)}:${cell.column.id}:row`}
                className="flex items-baseline justify-between gap-3"
              >
                <dt className="shrink-0 text-xs text-muted-foreground">
                  {labelFor(cell)}
                </dt>
                <dd className="min-w-0 text-right text-sm">
                  {defOf(cell).onClick ? (
                    <button
                      type="button"
                      className="text-right"
                      onClick={() => defOf(cell).onClick?.(row)}
                    >
                      {cellContent(cell)}
                    </button>
                  ) : (
                    cellContent(cell)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    );
  };

  const renderVirtualItemCells = (row: Row<TData>) => {
    const rowKey = toString(resolveRowKey(row.original, row.index));
    // Cell key: stable (fieldKey + column) — React reuses the <td> across index shifts.
    // Inner div key: fieldKey + index — forces useController re-registration when a row
    // shifts position after a middle deletion (matches non-virtual path behavior).
    const rowFormKey = `${rowKey}:${row.index}`;
    return row.getVisibleCells().map((cell) => (
      <TableCell
        key={`${rowKey}:${cell.column.id}`}
        className={cn(
          cellPad,
          (cell.column.columnDef as ColumnDef<TData, TValue>)?.onClick &&
            'cursor-pointer',
          (cell.column.columnDef as ColumnDef<TData, TValue>)
            ?.responsiveClassName,
        )}
        style={{
          width: cell.column.getSize(),
          minWidth: cell.column.getSize(),
          maxWidth: cell.column.getSize(),
        }}
        onClick={() =>
          (cell.column.columnDef as ColumnDef<TData, TValue>)?.onClick?.(
            cell.row,
          )
        }
      >
        <div key={rowFormKey}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </div>
      </TableCell>
    ));
  };

  // A detail item carries the row it belongs to. Interleaving them into the
  // data array is what lets Virtuoso measure each panel: it varies row heights
  // per item, and a panel hidden inside a fixed-height row would be clipped.
  type DetailItem = { detailFor: Row<TData> };
  const isDetailItem = (item: Row<TData> | DetailItem): item is DetailItem =>
    'detailFor' in item;

  const virtualItems: (Row<TData> | DetailItem)[] =
    renderRowDetail && isRowExpanded
      ? rows.flatMap((row) =>
          isRowExpanded(row.original) ? [row, { detailFor: row }] : [row],
        )
      : rows;

  const virtualItemKey = (item: Row<TData> | DetailItem) =>
    isDetailItem(item) ? `${item.detailFor.id}:detail` : item.id;

  const renderCardItem = (item: Row<TData> | DetailItem) => {
    if (isDetailItem(item)) {
      return (
        <div className="rounded-lg border bg-muted/30 p-3">
          {renderRowDetail?.(item.detailFor.original)}
        </div>
      );
    }
    return <div className="pb-2">{renderCard(item)}</div>;
  };

  const renderVirtualItem = (item: Row<TData> | DetailItem) => {
    if (!isDetailItem(item)) return renderVirtualItemCells(item);
    return (
      <TableCell
        colSpan={table.getVisibleLeafColumns().length}
        className="bg-muted/30 p-0"
      >
        {renderRowDetail?.(item.detailFor.original)}
      </TableCell>
    );
  };

  if (virtual) {
    const renderVirtualMain = () => {
      if (!rows.length) {
        return (
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <HeaderRow
                  key={headerGroup.id}
                  headerGroup={headerGroup}
                  compact={compact}
                />
              ))}
            </TableHeader>
            <TableBody>
              <NoResultsRow
                columns={columns}
                searchFields={searchFields}
                searchValue={searchValue}
              />
            </TableBody>
          </Table>
        );
      }

      if (hasStickyFooter) {
        return (
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            <div className="overflow-x-auto flex-1 min-h-0 scroll-shadow">
              <div
                className="flex flex-col min-h-0"
                style={{ minWidth: table.getTotalSize() }}
              >
                <TableVirtuoso
                  ref={tableVirtuosoRef}
                  data={virtualItems}
                  style={{ height: virtualTableHeight }}
                  computeItemKey={(_, item) =>
                    virtualItemKey(item as Row<TData> | DetailItem)
                  }
                  components={{
                    Table: TableComponent,
                  }}
                  itemContent={(index, item) =>
                    renderVirtualItem(item as Row<TData> | DetailItem)
                  }
                  fixedHeaderContent={() =>
                    table
                      .getHeaderGroups()
                      .map((headerGroup) => (
                        <HeaderRow
                          key={headerGroup.id}
                          headerGroup={headerGroup}
                          compact={compact}
                        />
                      ))
                  }
                  fixedFooterContent={() => renderStickyFooterTableRow()}
                />
              </div>
            </div>
          </div>
        );
      }

      if (useCardLayout) {
        // A card's height depends on how many columns it has and how
        // their values wrap, so the table's fixed row-height estimate
        // does not apply.
        //
        // In 'content' mode (the mode the form grids use) the list
        // grows with its content and the page scrolls — a Virtuoso
        // scroller would need a fixed height and would clip the last
        // card. In 'fill' mode the list takes the available space, so
        // it keeps the virtual scroller and stays bounded.
        if (virtualHeightMode !== 'fill') {
          return (
            <div className="flex flex-col gap-2 p-2">
              {virtualItems.map((item) => (
                <div key={virtualItemKey(item)}>{renderCardItem(item)}</div>
              ))}
            </div>
          );
        }

        return (
          <Virtuoso
            data={virtualItems}
            style={{ height: virtualTableHeight }}
            increaseViewportBy={{ top: 400, bottom: 400 }}
            computeItemKey={(_, item) =>
              virtualItemKey(item as Row<TData> | DetailItem)
            }
            itemContent={(index, item) =>
              renderCardItem(item as Row<TData> | DetailItem)
            }
          />
        );
      }

      return (
        <div className="overflow-x-auto scroll-shadow">
          <div
            className="flex flex-col min-h-0"
            // Without this floor the table compresses to fit the viewport
            // instead of scrolling, and every cell gets squeezed until
            // its content is clipped mid-word.
            style={{ minWidth: table.getTotalSize() }}
          >
            <TableVirtuoso
              ref={tableVirtuosoRef}
              data={virtualItems}
              style={{ height: virtualTableHeight }}
              computeItemKey={(_, item) =>
                virtualItemKey(item as Row<TData> | DetailItem)
              }
              components={{
                Table: TableComponent,
              }}
              itemContent={(index, item) =>
                renderVirtualItem(item as Row<TData> | DetailItem)
              }
              fixedHeaderContent={() =>
                table
                  .getHeaderGroups()
                  .map((headerGroup) => (
                    <HeaderRow
                      key={headerGroup.id}
                      headerGroup={headerGroup}
                      compact={compact}
                    />
                  ))
              }
            />
          </div>
        </div>
      );
    };

    return (
      <div
        ref={containerRef}
        className={cn(
          'rounded-md border w-full min-w-0 max-w-full flex flex-col',
          className,
        )}
      >
        {searchFields?.length ? (
          <div className="search-container border-b shrink-0">
            <div
              className={cn(
                // On a phone the count sits under the field rather than
                // competing with it for width — side by side, the
                // "Showing X out of Y records" text squeezed the input
                // down to an unusable width.
                'gap-2 flex flex-col items-stretch sm:flex-row sm:items-center sm:justify-between',
                isMini ? 'px-2 py-2' : 'px-3 py-2 sm:px-4 sm:py-3',
              )}
            >
              {isMini ? (
                <CompactSearchBar
                  value={searchInputValue}
                  onChange={handleSearchInputChange}
                  placeholder={searchPlaceholder || 'Search…'}
                  filteredCount={recordCount.filtered}
                  totalCount={recordCount.total}
                  className="w-full"
                  autoFocus={autoFocusSearch}
                  disabled={searchDisabled}
                />
              ) : (
                <>
                  <Search
                    placeholder={searchPlaceholder}
                    value={searchInputValue}
                    onChange={handleSearchInputChange}
                    className={searchClassName}
                    autoFocus={autoFocusSearch}
                    disabled={searchDisabled}
                  />
                  <RecordCount {...recordCount} />
                </>
              )}
            </div>
          </div>
        ) : null}
        {renderVirtualMain()}
        {renderInfoRowsTable()}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('rounded-md border', className)}>
      {searchFields?.length ? (
        <div className="search-container border-b">
          <div
            className={cn(
              'gap-2 flex flex-col items-stretch sm:flex-row sm:items-center sm:justify-between',
              isMini ? 'px-2 py-2' : 'px-3 py-2 sm:px-4 sm:py-3',
            )}
          >
            {isMini ? (
              <CompactSearchBar
                value={searchInputValue}
                onChange={handleSearchInputChange}
                placeholder={searchPlaceholder || 'Search…'}
                filteredCount={recordCount.filtered}
                totalCount={recordCount.total}
                className="w-full"
                autoFocus={autoFocusSearch}
                disabled={searchDisabled}
              />
            ) : (
              <>
                <Search
                  placeholder={searchPlaceholder}
                  value={searchInputValue}
                  onChange={handleSearchInputChange}
                  className={searchClassName}
                  autoFocus={autoFocusSearch}
                  disabled={searchDisabled}
                />
                <RecordCount {...recordCount} />
              </>
            )}
          </div>
        </div>
      ) : null}
      {useCardLayout ? (
        <div className="flex flex-col gap-2 p-2">
          {rows.map((row) => (
            <div key={rowKeyOf(row)}>{renderCard(row)}</div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto w-full scroll-shadow">
          <Table className={hasStickyFooter ? 'table-fixed' : undefined}>
            {hasStickyFooter ? (
              <colgroup>
                {leafHeaders.map((header) => (
                  <col
                    key={header.id}
                    style={{ width: header.column.getSize() }}
                  />
                ))}
              </colgroup>
            ) : null}
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <HeaderRow
                  key={headerGroup.id}
                  headerGroup={headerGroup}
                  compact={compact}
                />
              ))}
            </TableHeader>
            <TableBody>
              {rows?.length ? (
                <>
                  {rows.map((row) => (
                    <TableRow
                      key={resolveRowKey(row.original, row.index)}
                      data-state={row.getIsSelected() && 'selected'}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          onClick={() =>
                            (
                              cell.column.columnDef as ColumnDef<TData, TValue>
                            )?.onClick?.(cell.row)
                          }
                          className={cn(
                            cellPad,
                            (cell.column.columnDef as ColumnDef<TData, TValue>)
                              ?.onClick && 'cursor-pointer',
                            (cell.column.columnDef as ColumnDef<TData, TValue>)
                              ?.responsiveClassName,
                          )}
                          style={
                            hasStickyFooter
                              ? {
                                  width: cell.column.getSize(),
                                  minWidth: cell.column.getSize(),
                                  maxWidth: cell.column.getSize(),
                                }
                              : undefined
                          }
                        >
                          {/* HACK: Passing fields of useFieldArray as data requires field.id to be used or else it always removes only the last element https://stackoverflow.com/a/76339991/13183269 */}
                          <div
                            key={toString(
                              `${resolveRowKey(
                                cell.row.original,
                                cell.row.index,
                              )}:${cell.row.index}`,
                            )}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </div>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {/* Info Rows */}
                  {infoData?.map((row, rowIndex) => (
                    <TableRow
                      // eslint-disable-next-line react/no-array-index-key
                      key={`info-row-${rowIndex}`}
                      className="bg-muted/50 font-medium"
                    >
                      {row.map((cell, cellIndex) => (
                        <TableCell
                          // eslint-disable-next-line react/no-array-index-key
                          key={`info-cell-${rowIndex}-${cellIndex}`}
                          className={cellPad}
                        >
                          {cell}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </>
              ) : (
                <NoResultsRow columns={columns} />
              )}
            </TableBody>
            {hasStickyFooter ? (
              <TableFooter className="sticky bottom-0 z-10 border-t bg-background print:hidden [&>tr]:bg-background">
                <TableRow className="border-t bg-background hover:bg-background font-semibold [&>td]:bg-background">
                  {leafHeaders.map((header, i) => {
                    const w = header.column.getSize();
                    return (
                      <TableCell
                        key={header.id}
                        className={cn(
                          cellPad,
                          'whitespace-nowrap bg-background',
                        )}
                        style={{
                          width: w,
                          minWidth: w,
                          maxWidth: w,
                        }}
                      >
                        {stickyFooterRow![i] ?? null}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </div>
      )}
    </div>
  );
};

export { DataTable };
