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
}) => {
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
        header: 'Narration',
        cell: (info) => renderJournalCell(info, true), // Pass true for printMode
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
    ],
    [],
  );

  // Display loading state
  if (isLoading) {
    return <LoadingState message="Loading ledger entries..." />;
  }

  // Display empty state
  if (ledger.length === 0) {
    return (
      <EmptyState message="No ledger entries found for the selected account and date." />
    );
  }

  const latestBalance =
    ledger.length > 0
      ? `PKR ${getFormattedCurrency(
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

      {/* Account and balance info - screen only */}
      <div className="flex justify-between items-center mb-4 print:hidden">
        {ledger.length > 0 && (
          <p className="text-sm font-medium mt-1">
            Latest Balance:{' '}
            <span className="font-semibold">{latestBalance}</span>
          </p>
        )}
      </div>

      {/* Account and balance info - print only */}
      <div className="hidden print:flex print:flex-col print:mb-2">
        {ledger.length > 0 && (
          <p className="text-xs">
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
