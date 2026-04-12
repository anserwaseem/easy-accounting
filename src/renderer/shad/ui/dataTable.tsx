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
import { get, toString, debounce } from 'lodash';
import { cn } from '@/renderer/lib/utils';
import {
  type MutableRefObject,
  HTMLAttributes,
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import { TableVirtuoso } from 'react-virtuoso';
import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/renderer/shad/ui/tooltip';
import { CompactSearchBar } from './compactSearchBar';
import { Search } from './search';

export type ColumnDef<TData, TValue = unknown> = ColDef<TData, TValue> & {
  onClick?: (row: Row<TData>) => void;
  /** explanatory text shown as a tooltip on the column header */
  headerTooltip?: string;
};

// TODO: search by field(s)
interface DataTableProps<TData, TValue> extends Partial<TableOptions<TData>> {
  columns: ColDef<TData, TValue>[];
  data: TData[];
  defaultSortField?: keyof TData;
  defaultSortDirection?: SortDirection;
  infoData?: React.ReactNode[][];
  virtual?: boolean;
  /** tighter row/header/cell padding for dense grids */
  compact?: boolean;
  /**
   * one cell per visible column; widths match tanstack column sizes.
   * stays aligned with virtual + non-virtual tables; hidden when printing.
   */
  stickyFooterRow?: React.ReactNode[];
  searchPlaceholder?: string;
  searchFields?: string[];
  isMini?: boolean;
  searchPersistenceKey?: string;
  /** focus the table search field when the page mounts (listing screens) */
  autoFocusSearch?: boolean;
  /**
   * current visible rows after search + sort (for export/print parity with grid).
   * parent should keep callback ref-stable (useCallback) to avoid extra runs.
   */
  onViewModelChange?: (rows: TData[]) => void;
}

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

/** virtuoso TableRow: stable when memoized with same `cellPad`; reads row from ref each paint. must forwardRef — virtuoso measures `<tr>`; missing ref breaks updates (sort looked dead). */
const createDataTableVirtualTableRow = <TData,>(
  rowsRef: MutableRefObject<Row<TData>[]>,
  cellPadLocal: string,
) => {
  const VirtTableRow = forwardRef<
    HTMLTableRowElement,
    HTMLAttributes<HTMLTableRowElement>
  >((rowProps, ref) => {
    const { className: trClassName, style: trStyle, ...trRest } = rowProps;
    const index = (trRest as Record<string, unknown>)['data-index'] as number;
    const row = rowsRef.current[index];
    if (!row) return null;
    return (
      <TableRow
        ref={ref}
        className={trClassName}
        style={trStyle}
        data-state={row.getIsSelected() && 'selected'}
        {...trRest}
      >
        {row.getVisibleCells().map((cell) => (
          <TableCell
            key={cell.id}
            className={cn(
              cellPadLocal,
              (cell.column.columnDef as ColumnDef<TData, unknown>)?.onClick &&
                'cursor-pointer',
            )}
            style={{
              width: cell.column.getSize(),
              minWidth: cell.column.getSize(),
              maxWidth: cell.column.getSize(),
            }}
            onClick={() =>
              (cell.column.columnDef as ColumnDef<TData, unknown>)?.onClick?.(
                cell.row,
              )
            }
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
      </TableRow>
    );
  });
  VirtTableRow.displayName = 'VirtTableRow';
  return VirtTableRow;
};

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
            header.column.getIsSorted()
              ? 'bg-gray-300 dark:bg-gray-800'
              : 'bg-gray-200 dark:bg-gray-900',
            compact ? 'h-7 px-2 py-1 text-xs' : 'h-8',
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
  defaultSortField,
  defaultSortDirection = 'asc',
  infoData,
  virtual = false,
  compact = false,
  stickyFooterRow,
  searchPlaceholder,
  searchFields,
  isMini = false,
  searchPersistenceKey,
  autoFocusSearch = false,
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
  const [filteredData, setFilteredData] = useState(data);
  const [height, setHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const isSearchHydratedRef = useRef(false);

  // when virtual toggles on, seed height so virtuoso is usable before layout measure runs
  useEffect(() => {
    if (!virtual) return;
    setHeight((h) => (h > 0 ? h : 480));
  }, [virtual]);

  // calculate height of the table based for virtual table
  useEffect(() => {
    const calculateHeight = () => {
      if (!containerRef.current || !virtual) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const searchBarHeight =
        container.querySelector('.search-container')?.getBoundingClientRect()
          .height || 0;

      // calculate available space from the container's top to the viewport bottom
      // subtract search bar height and some padding to prevent scrollbar from appearing
      const availableHeight =
        window.innerHeight - rect.top - searchBarHeight - 50;

      // ensure minimum height of 400px and maximum of available space
      const newHeight = Math.max(
        400,
        Math.min(availableHeight, window.innerHeight - 100),
      );

      setHeight(newHeight);
    };

    calculateHeight();
    // recalculate on window resize
    window.addEventListener('resize', calculateHeight);

    return () => window.removeEventListener('resize', calculateHeight);
  }, [virtual]);

  // update filtered data when search value or data changes
  useEffect(() => {
    if (!searchValue || !searchFields?.length) {
      setFilteredData(data);
      return;
    }

    const searchTerm = searchValue.toLowerCase();
    const filtered = data.filter((item) =>
      searchFields.some((field) => {
        const value = get(item, field);
        return toString(value).toLowerCase().includes(searchTerm);
      }),
    );
    setFilteredData(filtered);
  }, [searchValue, data, searchFields]);

  // debounced search handler
  const debounceSearch = useMemo(
    () =>
      debounce((value: string) => {
        setSearchValue(value);
      }, 300),
    [],
  );
  useEffect(() => () => debounceSearch.cancel(), [debounceSearch]);

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

  useEffect(() => {
    if (!searchPersistenceKey) return;
    if (!isSearchHydratedRef.current) return;
    window.electron.store.set(searchPersistenceKey, searchInputValue);
  }, [searchPersistenceKey, searchInputValue]);

  const table = useReactTable({
    ...restTableOptions,
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: {
      ...userTableState,
      sorting,
    },
    onSortingChange: (updater) => {
      setSorting(updater);
      userOnSortingChange?.(updater);
    },
  });

  const { rows } = table.getRowModel();

  const virtualRowsRef = useRef(rows);
  virtualRowsRef.current = rows;
  const VirtualTableRow = useMemo(
    () =>
      createDataTableVirtualTableRow<TData>(
        virtualRowsRef,
        compact ? 'py-1 px-2' : 'py-2 px-4',
      ),
    [compact],
  );

  const tableRef = useRef(table);
  tableRef.current = table;
  const onViewModelChangeRef = useRef(onViewModelChange);
  onViewModelChangeRef.current = onViewModelChange;

  useLayoutEffect(() => {
    onViewModelChangeRef.current?.(
      tableRef.current.getRowModel().rows.map((r) => r.original),
    );
  }, [filteredData, sorting, searchValue]);

  const recordCount = {
    filtered: rows.length,
    total: data.length,
  };

  const searchClassName = useMemo(() => 'w-full md:w-[320px]', []);

  const cellPad = compact ? 'py-1 px-2' : 'py-2 px-4';

  const hasStickyFooter = Boolean(
    stickyFooterRow && stickyFooterRow.length > 0,
  );

  const leafHeaders =
    table.getHeaderGroups()[0]?.headers.filter((h) => !h.isPlaceholder) ?? [];

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
            <div className="overflow-x-auto flex-1 min-h-0">
              <div
                className="flex flex-col min-h-0"
                style={{ minWidth: table.getTotalSize() }}
              >
                <TableVirtuoso
                  style={{ height }}
                  totalCount={rows.length}
                  computeItemKey={(index) => rows[index]?.id ?? index}
                  components={{
                    Table: TableComponent,
                    TableRow: VirtualTableRow,
                  }}
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

      return (
        <div className="overflow-x-auto">
          <TableVirtuoso
            style={{ height }}
            totalCount={rows.length}
            computeItemKey={(index) => rows[index]?.id ?? index}
            components={{
              Table: TableComponent,
              TableRow: VirtualTableRow,
            }}
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
      );
    };

    return (
      <div
        ref={containerRef}
        className="rounded-md border w-full min-w-0 max-w-full flex flex-col"
      >
        {searchFields?.length ? (
          <div className="search-container border-b shrink-0">
            <div
              className={cn(
                'gap-2 flex justify-between items-center',
                isMini ? 'px-2 py-2' : 'px-4 py-3',
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
                />
              ) : (
                <>
                  <Search
                    placeholder={searchPlaceholder}
                    value={searchInputValue}
                    onChange={handleSearchInputChange}
                    className={searchClassName}
                    autoFocus={autoFocusSearch}
                  />
                  <RecordCount {...recordCount} />
                </>
              )}
            </div>
          </div>
        ) : null}
        {renderVirtualMain()}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="rounded-md border">
      {searchFields?.length ? (
        <div className="search-container border-b">
          <div
            className={cn(
              'gap-2 flex justify-between items-center',
              isMini ? 'px-2 py-2' : 'px-4 py-3',
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
              />
            ) : (
              <>
                <Search
                  placeholder={searchPlaceholder}
                  value={searchInputValue}
                  onChange={handleSearchInputChange}
                  className={searchClassName}
                  autoFocus={autoFocusSearch}
                />
                <RecordCount {...recordCount} />
              </>
            )}
          </div>
        </div>
      ) : null}
      <Table className={hasStickyFooter ? 'table-fixed' : undefined}>
        {hasStickyFooter ? (
          <colgroup>
            {leafHeaders.map((header) => (
              <col key={header.id} style={{ width: header.column.getSize() }} />
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
                  key={row.id}
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
                      <div key={toString(get(cell.row.original, 'id'))}>
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
                  className="bg-gray-50 dark:bg-gray-800 font-medium"
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
                    className={cn(cellPad, 'whitespace-nowrap bg-background')}
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
  );
};

export { DataTable };
