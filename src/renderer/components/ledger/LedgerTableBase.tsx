import { useMemo, useState, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
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

/** below this, a plain table is cheaper than virtuoso + scroll container */
const VIRTUAL_ROW_THRESHOLD = 50;

interface LedgerTableBaseProps {
  ledger: LedgerView[];
  printMode?: boolean;
  className?: string;
  /**
   * when false, skip beforeprint expansion (ledger report prints via iframe — avoids freezing the main window).
   * when true, Cmd+P expands a full table for native print (account ledger screen).
   */
  useNativePrintExpansion?: boolean;
}

export const LedgerTableBase: React.FC<LedgerTableBaseProps> = ({
  ledger,
  printMode = false,
  className = '',
  useNativePrintExpansion = true,
}: LedgerTableBaseProps) => {
  // when useNativePrintExpansion, expand to full table for window.print / Cmd+P
  const [expandForPrint, setExpandForPrint] = useState(false);

  useEffect(() => {
    if (!useNativePrintExpansion) return undefined;

    const handleBeforePrint = () => {
      flushSync(() => setExpandForPrint(true));
    };
    const handleAfterPrint = () => setExpandForPrint(false);
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [useNativePrintExpansion]);

  const debitCreditZeroLabel = useMemo(
    () => toString(window.electron.store.get('debitCreditDefaultLabel') ?? ' '),
    [],
  );

  const formatDebitCredit = useCallback(
    (value: number) =>
      getFormattedDebitCreditWithoutCurrency(value, debitCreditZeroLabel),
    [debitCreditZeroLabel],
  );

  const useVirtual = ledger.length >= VIRTUAL_ROW_THRESHOLD && !expandForPrint;

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
        virtual={useVirtual}
        columns={columns}
        data={ledger}
        sortingFns={defaultSortingFunctions}
        enableSorting={false}
        compact
      />
    </div>
  );
};
