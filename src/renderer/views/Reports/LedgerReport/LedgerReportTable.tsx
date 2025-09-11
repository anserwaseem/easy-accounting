import { useMemo } from 'react';
import { currency, dateFormatOptions } from 'renderer/lib/constants';
import {
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { LedgerView } from '@/types';
import { format } from 'date-fns';
import { renderJournalCell } from '@/renderer/components/journal/NarrationCell';
import { DateHeader } from '@/renderer/components/common/DateHeader';
import { Card } from '@/renderer/shad/ui/card';
import { EmptyState, LoadingState } from '../components';

interface LedgerReportTableProps {
  ledger: LedgerView[];
  isLoading: boolean;
  selectedDate: Date;
  accountName: string;
}

export const LedgerReportTable: React.FC<LedgerReportTableProps> = ({
  ledger,
  isLoading,
  selectedDate,
  accountName,
}: LedgerReportTableProps) => {
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
        cell: (info) => renderJournalCell(info, true), // Pass true for printMode
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
    [],
  );

  if (isLoading) {
    return <LoadingState message="Loading ledger entries..." />;
  }

  if (ledger.length === 0) {
    return (
      <Card className="p-6 text-center text-muted-foreground">
        <EmptyState message="No ledger entries found for the selected account and date." />
      </Card>
    );
  }

  const latestBalance =
    ledger.length > 0
      ? `${getFormattedCurrency(
          ledger.at(-1)?.balance ?? 0,
        ).trim()} ${ledger.at(-1)?.balanceType}`
      : '';

  return (
    <>
      {/* Print-only report header */}
      <div className="hidden print:block print:mb-4">
        <h1 className="text-center font-bold text-lg">
          Ledger Report for {accountName} as of{' '}
          {format(selectedDate, 'MMMM do, yyyy')}
        </h1>
      </div>

      {/* Account and balance info */}
      <div className="flex justify-between items-center mb-4 print:mb-2">
        {ledger.length > 0 && (
          <p className="text-sm">
            Latest Balance:{' '}
            <span className="font-semibold">{latestBalance}</span>
          </p>
        )}
      </div>

      {/* Table - styled for both screen and print */}
      <div className="print-table">
        <DataTable
          columns={columns}
          data={ledger}
          sortingFns={defaultSortingFunctions}
        />
      </div>
    </>
  );
};
