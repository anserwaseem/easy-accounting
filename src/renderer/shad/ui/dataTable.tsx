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
  TableHead,
  TableHeader,
  TableRow,
} from 'renderer/shad/ui/table';
import { get, toString, debounce } from 'lodash';
import { cn } from '@/renderer/lib/utils';
import {
  HTMLAttributes,
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import { TableVirtuoso } from 'react-virtuoso';
import { Search } from './search';
import { CompactSearchBar } from './compactSearchBar';

export type ColumnDef<TData, TValue = unknown> = ColDef<TData, TValue> & {
  onClick?: (row: Row<TData>) => void;
};

// TODO: search by field(s)
interface DataTableProps<TData, TValue> extends Partial<TableOptions<TData>> {
  columns: ColDef<TData, TValue>[];
  data: TData[];
  defaultSortField?: keyof TData;
  defaultSortDirection?: SortDirection;
  infoData?: React.ReactNode[][];
  virtual?: boolean;
  /** tighter row/header/cell padding for dense grids (e.g. invoice line items) */
  compact?: boolean;
  searchPlaceholder?: string;
  searchFields?: string[];
  isMini?: boolean;
  searchPersistenceKey?: string;
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

const TableRowComponent = <TData,>(rows: Row<TData>[], compact: boolean) =>
  function getTableRow(props: HTMLAttributes<HTMLTableRowElement>) {
    // @ts-expect-error data-index is a valid attribute
    const index = props['data-index'];
    const row = rows[index];

    if (!row) return null;

    const cellPad = compact ? 'py-1 px-2' : 'py-2 px-4';

    return (
      <TableRow
        key={row.id}
        data-state={row.getIsSelected() && 'selected'}
        {...props}
      >
        {row.getVisibleCells().map((cell) => (
          <TableCell
            key={cell.id}
            className={cn(
              cellPad,
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

const HeaderCellContent = ({ header }: { header: any }) => (
  // eslint-disable-next-line jsx-a11y/click-events-have-key-events
  <div
    className="flex items-center"
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
);

const HeaderRow = ({
  headerGroup,
  compact,
}: {
  headerGroup: any;
  compact?: boolean;
}) => (
  <TableRow className="bg-card hover:bg-muted" key={headerGroup.id}>
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
  searchPlaceholder,
  searchFields,
  isMini = false,
  searchPersistenceKey,
  ...props
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
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    ...props,
  });

  const { rows } = table.getRowModel();

  const recordCount = {
    filtered: rows.length,
    total: data.length,
  };

  const searchClassName = useMemo(() => 'w-full md:w-[320px]', []);

  const cellPad = compact ? 'py-1 px-2' : 'py-2 px-4';

  if (virtual) {
    return (
      <div
        ref={containerRef}
        className="rounded-md border w-full min-w-0 max-w-full overflow-x-auto"
      >
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
                />
              ) : (
                <>
                  <Search
                    placeholder={searchPlaceholder}
                    value={searchInputValue}
                    onChange={handleSearchInputChange}
                    className={searchClassName}
                  />
                  <RecordCount {...recordCount} />
                </>
              )}
            </div>
          </div>
        ) : null}
        {rows.length ? (
          <TableVirtuoso
            style={{ height }}
            totalCount={rows.length}
            components={{
              Table: TableComponent,
              TableRow: TableRowComponent(rows, compact),
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
        ) : (
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
        )}
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
              />
            ) : (
              <>
                <Search
                  placeholder={searchPlaceholder}
                  value={searchInputValue}
                  onChange={handleSearchInputChange}
                  className={searchClassName}
                />
                <RecordCount {...recordCount} />
              </>
            )}
          </div>
        </div>
      ) : null}
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
      </Table>
    </div>
  );
};

export { DataTable };
