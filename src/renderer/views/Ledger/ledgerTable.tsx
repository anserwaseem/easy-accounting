import { useMemo } from 'react';
import { dateFormatOptions } from 'renderer/lib/constants';
import { defaultSortingFunctions } from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { LedgerView } from 'types';

interface LedgerTableProps {
  ledger: LedgerView[];
}

export const LedgerTable: React.FC<LedgerTableProps> = ({
  ledger,
}: LedgerTableProps) => {
  // eslint-disable-next-line no-console
  console.log('LedgerTable', ledger);

  const columns: ColumnDef<LedgerView>[] = useMemo(
    () => [
      {
        accessorKey: 'date',
        header: 'Date (MM/DD/YYYY)',
        cell: ({ row }) =>
          new Date(row.original.date).toLocaleString(
            'en-US',
            dateFormatOptions,
          ),
      },
      {
        header: 'Particulars',
        cell: ({ row }) =>
          row.original.linkedAccountName ?? row.original.particulars,
      },
      {
        accessorKey: 'debit',
        header: 'Debit',
      },
      {
        accessorKey: 'credit',
        header: 'Credit',
      },
      {
        accessorKey: 'balance',
        header: 'Balance',
      },
      {
        accessorKey: 'balanceType',
        header: 'Balance Type',
      },
      // {
      //   accessorKey: 'updatedAt',
      //   header: 'Updated At',
      //   cell: ({ row }) =>
      //     new Date(row.original.updatedAt || '').toLocaleString(
      //       'en-US',
      //       dateFormatOptions,
      //     ),
      // },
      // {
      //   accessorKey: 'createdAt',
      //   header: 'Created At',
      //   cell: ({ row }) =>
      //     new Date(row.original.createdAt || '').toLocaleString(
      //       'en-US',
      //       dateFormatOptions,
      //     ),
      // },
    ],
    [],
  );

  return (
    <div className="py-8">
      <DataTable
        columns={columns}
        data={ledger}
        sortingFns={defaultSortingFunctions}
      />
    </div>
  );
};
