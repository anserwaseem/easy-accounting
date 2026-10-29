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
import { extractJournalIdFromParticulars } from '@/shared/journalParticulars';

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

const renderTierBreakdownCell = ({ row }: CellContext<LedgerView, unknown>) => {
  const breakdown = row.original.tierBreakdown;
  if (!breakdown) return null;
  return (
    <div className="whitespace-pre-line text-xs text-muted-foreground">
      {breakdown}
    </div>
  );
};

interface LedgerTableBaseProps {
  ledger: LedgerView[];
  printMode?: boolean;
  className?: string;
  language?: 'en' | 'ur';
  /** aligned footer row (see `DataTable` stickyFooterRow) */
  stickyFooterRow?: ReactNode[];
  visibleColumns?: ReadonlySet<string>;
}

export const LedgerTableBase: React.FC<LedgerTableBaseProps> = ({
  ledger,
  printMode = false,
  className = '',
  language = 'en',
  stickyFooterRow,
  visibleColumns,
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

  const hasTierBreakdown = useMemo(
    () => ledger.some((row) => !!row.tierBreakdown),
    [ledger],
  );

  const allColumns: ColumnDef<LedgerView>[] = useMemo(
    () => [
      {
        accessorKey: 'date',
        header: language === 'ur' ? 'تاریخ' : 'Date',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => <DateCell value={row.original.date} />,
        size: 110,
        // the date and the narration used to be hidden on a narrow
        // screen, which is where the ledger stopped being a ledger: the
        // row said how much, and nothing about when or why
        cardMeta: true,
      },
      {
        id: 'particulars',
        header: language === 'ur' ? 'تفصیل' : 'Particulars',
        cell: renderLedgerParticularsCell,
        size: 180,
        // The account/particulars is what a ledger row is read for, so
        // it heads the card; the debit and credit follow underneath.
        cardHeadline: true,
      },
      ...(hasTierBreakdown
        ? [
            {
              id: 'tierBreakdown',
              header: language === 'ur' ? 'بٹوارا' : 'Tier breakdown',
              accessorFn: (row: LedgerView) => row.tierBreakdown ?? '',
              cell: renderTierBreakdownCell,
              size: 180,
            },
          ]
        : []),
      {
        header: language === 'ur' ? 'تشریح' : 'Narration',
        id: 'narration',
        // The narration is drawn from the row, not from a column
        // value, so the card layout has no value to read and would
        // leave the narration off the card altogether. This accessor
        // gives it one: a row that shows a narration link has a value.
        accessorFn: (row: LedgerView) =>
          row.journalSummary?.narration ??
          (extractJournalIdFromParticulars(row.particulars) ? 'journal' : ''),
        cell: (info) => renderJournalCell(info, printMode),
        size: 200,
      },
      {
        accessorKey: 'debit',
        header: language === 'ur' ? 'ڈیبٹ' : 'Debit',
        cell: ({ row }) => formatDebitCredit(row.original.debit),
        size: 110,
        // a row is a debit or a credit, never both: the empty side is
        // left off the card rather than shown as a label over nothing
        cardHideWhenZero: true,
      },
      {
        accessorKey: 'credit',
        header: language === 'ur' ? 'کریڈٹ' : 'Credit',
        cell: ({ row }) => formatDebitCredit(row.original.credit),
        size: 110,
        cardHideWhenZero: true,
      },
      {
        accessorKey: 'balance',
        header: language === 'ur' ? 'بقایا' : 'Balance',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.balance)
            .replace(currency, '')
            .trim(),
        size: 120,
        // The running balance is the number a ledger is read for; it
        // sits beside the particulars.
        cardAside: true,
      },
      {
        accessorKey: 'balanceType',
        header: language === 'ur' ? 'قسم' : 'Type',
        size: 90,
      },
    ],
    [printMode, formatDebitCredit, hasTierBreakdown, language],
  );

  const columns = useMemo(() => {
    if (!visibleColumns) return allColumns;
    return allColumns.filter((column) => {
      const typedColumn = column as { accessorKey?: string; id?: string };
      const columnId = String(typedColumn.accessorKey ?? typedColumn.id ?? '');
      return visibleColumns.has(columnId);
    });
  }, [allColumns, visibleColumns]);

  return (
    <div
      className={className}
      dir={language === 'ur' ? 'rtl' : 'ltr'}
      lang={language === 'ur' ? 'ur' : 'en'}
    >
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
