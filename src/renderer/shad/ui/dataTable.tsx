import {
  ColumnDef as ColDef,
  Row,
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
import { toString } from 'lodash';

export type ColumnDef<TData, TValue = unknown> = ColDef<TData, TValue> & {
  onClick?: (row: Row<TData>) => void;
};

interface DataTableProps<TData, TValue> {
  columns: ColDef<TData, TValue>[];
  data: TData[];
  defaultSortField?: keyof TData;
}

function DataTable<TData, TValue>({
  columns,
  data,
  defaultSortField,
}: DataTableProps<TData, TValue>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: {
      sorting: defaultSortField
        ? [{ id: defaultSortField.toString(), desc: false }]
        : [],
    },
  });

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    key={header.id}
                    className={
                      header.column.getIsSorted()
                        ? 'bg-gray-300 dark:bg-gray-800'
                        : 'bg-gray-200 dark:bg-gray-900'
                    }
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                    {
                      {
                        asc: ' 🔼',
                        desc: ' 🔽',
                      }[toString(header.column.getIsSorted())]
                    }
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
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
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export { DataTable };
