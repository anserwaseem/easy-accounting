import { useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { toString } from 'lodash';
import { currency, dateFormatOptions } from 'renderer/lib/constants';
import {
  defaultSortingFunctions,
  getFormattedCurrency,
  getFormattedDebitCreditWithoutCurrency,
} from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { LedgerView } from '@/types';
import { renderJournalCell } from '@/renderer/components/journal/NarrationCell';
import { DateHeader } from '@/renderer/components/common/DateHeader';

interface LedgerTableBaseProps {
  ledger: LedgerView[];
  printMode?: boolean;
  className?: string;
  /** aligned footer row (see `DataTable` stickyFooterRow) */
  stickyFooterRow?: ReactNode[];
}

export const LedgerTableBase: React.FC<LedgerTableBaseProps> = ({
  ledger,
  printMode = false,
  className = '',
  stickyFooterRow,
}: LedgerTableBaseProps) => {
  const debitCreditZeroLabel = useMemo(
    () => toString(window.electron.store.get('debitCreditDefaultLabel') ?? ' '),
    [],
  );

  const formatDebitCredit = useCallback(
    (value: number) =>
      getFormattedDebitCreditWithoutCurrency(value, debitCreditZeroLabel),
    [debitCreditZeroLabel],
  );

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
        size: 100,
      },
      {
        header: 'Narration',
        cell: (info) => renderJournalCell(info, printMode),
        size: 120,
      },
      {
        accessorKey: 'debit',
        header: 'Debit',
        cell: ({ row }) => formatDebitCredit(row.original.debit),
        size: 60,
      },
      {
        accessorKey: 'credit',
        header: 'Credit',
        cell: ({ row }) => formatDebitCredit(row.original.credit),
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
    [printMode, formatDebitCredit],
  );

  return (
    <div className={className}>
      <DataTable
        virtual
        columns={columns}
        data={ledger}
        sortingFns={defaultSortingFunctions}
        enableSorting={false}
        compact
        stickyFooterRow={stickyFooterRow}
      />
    </div>
  );
};
