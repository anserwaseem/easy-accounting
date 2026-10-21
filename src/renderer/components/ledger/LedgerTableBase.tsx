import { useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { CellContext } from '@tanstack/react-table';
import { toString } from 'lodash';
import { currency } from 'renderer/lib/constants';
import {
  defaultSortingFunctions,
  getFormattedCurrency,
  getFormattedDebitCreditWithoutCurrency,
} from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import { Badge } from 'renderer/shad/ui/badge';
import type { LedgerView } from '@/types';
import { renderJournalCell } from '@/renderer/components/journal/NarrationCell';
import { DateCell } from '@/renderer/components/common/DateCell';

interface LedgerParticularsCellProps {
  row: LedgerView;
}

const LedgerParticularsCell: React.FC<LedgerParticularsCellProps> = ({
  row,
}: LedgerParticularsCellProps) => {
  const name = row.linkedAccountName ?? row.particulars;
  const codeRaw = row.linkedAccountCode;
  const code = codeRaw != null && codeRaw !== '' ? String(codeRaw) : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
      <span className="min-w-0 break-words">{name}</span>
      {code != null ? (
        <Badge
          variant="secondary"
          className="shrink-0 font-mono text-[10px] px-1.5 py-0"
        >
          {code}
        </Badge>
      ) : null}
    </div>
  );
};

const renderLedgerParticularsCell = ({
  row,
}: CellContext<LedgerView, unknown>) => (
  <LedgerParticularsCell row={row.original} />
);

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
        header: 'Date',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => <DateCell value={row.original.date} />,
        size: 110,
        hideBelow: 'sm' as const,
      },
      {
        header: 'Particulars',
        cell: renderLedgerParticularsCell,
        size: 180,
      },
      {
        header: 'Narration',
        cell: (info) => renderJournalCell(info, printMode),
        size: 200,
        hideBelow: 'lg' as const,
      },
      {
        accessorKey: 'debit',
        header: 'Debit',
        cell: ({ row }) => formatDebitCredit(row.original.debit),
        size: 110,
      },
      {
        accessorKey: 'credit',
        header: 'Credit',
        cell: ({ row }) => formatDebitCredit(row.original.credit),
        size: 110,
      },
      {
        accessorKey: 'balance',
        header: 'Balance',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.balance)
            .replace(currency, '')
            .trim(),
        size: 120,
      },
      {
        accessorKey: 'balanceType',
        header: 'Type',
        size: 90,
        hideBelow: 'md' as const,
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
        virtualHeightMode="fill"
        stickyFooterRow={stickyFooterRow}
      />
    </div>
  );
};
