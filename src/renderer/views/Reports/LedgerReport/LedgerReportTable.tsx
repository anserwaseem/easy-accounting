import { useMemo } from 'react';
import type { LedgerView } from '@/types';
import { Card } from '@/renderer/shad/ui/card';
import { LedgerTableBase } from '@/renderer/components/ledger/LedgerTableBase';
import { currency } from '@/renderer/lib/constants';
import { getFormattedCurrency } from '@/renderer/lib/utils';
import { localizedBalanceType } from './ledgerLabels';
import { EmptyState, LoadingState } from '../components';

interface LedgerReportTableProps {
  ledger: LedgerView[];
  isLoading: boolean;
  dateSubtitle: string;
  accountName: string;
  language?: 'en' | 'ur';
  totals: {
    totalDebit: number;
    totalCredit: number;
    totalDifference: number;
    totalType: string;
  };
  visibleColumns?: ReadonlySet<string>;
}

export const LedgerReportTable: React.FC<LedgerReportTableProps> = ({
  ledger,
  isLoading,
  dateSubtitle,
  accountName,
  language = 'en',
  totals,
  visibleColumns,
}: LedgerReportTableProps) => {
  const allColumns = useMemo(
    () =>
      [
        'date',
        'particulars',
        'tierBreakdown',
        'narration',
        'debit',
        'credit',
        'balance',
        'balanceType',
      ] as const,
    [],
  );
  const hasTierBreakdown = useMemo(
    () => ledger.some((row) => !!row.tierBreakdown),
    [ledger],
  );

  const effectiveVisibleColumns = useMemo(() => {
    if (!visibleColumns) return undefined;
    if (hasTierBreakdown) return visibleColumns;
    const next = new Set(visibleColumns);
    next.delete('tierBreakdown');
    return next;
  }, [visibleColumns, hasTierBreakdown]);

  const stickyFooterRow = useMemo(() => {
    const visible = effectiveVisibleColumns ?? new Set(allColumns);
    const cells: React.ReactNode[] = [];
    if (visible.has('date')) cells.push(null);
    if (visible.has('particulars')) cells.push(null);
    if (visible.has('tierBreakdown')) cells.push(null);
    if (visible.has('narration')) cells.push(null);
    if (visible.has('debit'))
      cells.push(
        <span className="block font-semibold whitespace-nowrap">
          {getFormattedCurrency(totals.totalDebit).replace(currency, '').trim()}
        </span>,
      );
    if (visible.has('credit'))
      cells.push(
        <span className="block font-semibold whitespace-nowrap">
          {getFormattedCurrency(totals.totalCredit)
            .replace(currency, '')
            .trim()}
        </span>,
      );
    if (visible.has('balance'))
      cells.push(
        <span className="block font-semibold whitespace-nowrap">
          {getFormattedCurrency(totals.totalDifference)
            .replace(currency, '')
            .trim()}
        </span>,
      );
    if (visible.has('balanceType'))
      cells.push(
        <span className="block font-semibold whitespace-nowrap">
          {localizedBalanceType(language ?? 'en', totals.totalType)}
        </span>,
      );
    return cells;
  }, [totals, effectiveVisibleColumns, allColumns, language]);

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

  return (
    <>
      {/* Print-only report header */}
      <div className="hidden print:block print:mb-4">
        <h1 className="text-center font-semibold text-lg">
          Ledger Report for {accountName} - {dateSubtitle}
        </h1>
      </div>

      <LedgerTableBase
        ledger={ledger}
        className="print-table"
        printMode
        language={language}
        stickyFooterRow={stickyFooterRow}
        visibleColumns={effectiveVisibleColumns}
      />
    </>
  );
};
