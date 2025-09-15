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

interface LedgerTableBaseProps {
  ledger: LedgerView[];
  printMode?: boolean;
  className?: string;
}

export const LedgerTableBase: React.FC<LedgerTableBaseProps> = ({
  ledger,
  printMode = false,
  className = '',
}: LedgerTableBaseProps) => {
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
        size: 40,
      },
      {
        header: 'Particulars',
        cell: ({ row }) =>
          row.original.linkedAccountName ?? row.original.particulars,
        size: 400,
      },
      {
        header: 'Narration',
        cell: (info) => renderJournalCell(info, printMode),
        size: 1100,
      },
      {
        accessorKey: 'debit',
        header: 'Debit',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.debit).replace(currency, '').trim(),
        size: 60,
      },
      {
        accessorKey: 'credit',
        header: 'Credit',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.credit)
            .replace(currency, '')
            .trim(),
        size: 60,
      },
      {
        accessorKey: 'balance',
        header: 'Balance',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.balance)
            .replace(currency, '')
            .trim(),
        size: 70,
      },
      {
        accessorKey: 'balanceType',
        header: 'Type',
        size: 10,
      },
    ],
    [printMode],
  );

  return (
    <div className={className}>
      <DataTable
        columns={columns}
        data={ledger}
        sortingFns={defaultSortingFunctions}
      />
    </div>
  );
};
