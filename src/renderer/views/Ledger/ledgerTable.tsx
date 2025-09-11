import { useMemo } from 'react';
import { currency, dateFormatOptions } from 'renderer/lib/constants';
import {
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { LedgerView } from '@/types';
import { renderJournalCell } from '@/renderer/components/journal/NarrationCell';
import { DateHeader } from '@/renderer/components/common/DateHeader';

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
        header: DateHeader,
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
        header: 'Narration',
        cell: renderJournalCell,
      },
      {
        accessorKey: 'debit',
        header: 'Debit',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.debit).replace(currency, '').trim(),
      },
      {
        accessorKey: 'credit',
        header: 'Credit',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.credit)
            .replace(currency, '')
            .trim(),
      },
      {
        accessorKey: 'balance',
        header: 'Balance',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.balance)
            .replace(currency, '')
            .trim(),
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
