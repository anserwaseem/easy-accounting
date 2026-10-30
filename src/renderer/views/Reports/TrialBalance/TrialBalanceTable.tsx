import { useMemo } from 'react';
import { orderBy } from 'lodash';
import { cn, getFormattedCurrency } from 'renderer/lib/utils';
import { currency } from 'renderer/lib/constants';
import {
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from 'renderer/shad/ui/table';
import { formatDisplayDate } from '@/lib/displayDate';
import type { TrialBalanceItem, TrialBalance } from './types';
import {
  EmptyState,
  LoadingState,
  SortableHeader,
  useSorting,
} from '../components';

type SortField = 'code' | 'name' | 'debit' | 'credit';

interface TrialBalanceTableProps {
  trialBalance: TrialBalance;
  isLoading: boolean;
  /** print and the on-screen grid share this set. omitted means every column. */
  visibleColumns?: ReadonlySet<string>;
}

export const TrialBalanceTable = ({
  trialBalance,
  isLoading,
  visibleColumns,
}: TrialBalanceTableProps) => {
  const { sortField, sortDirection, handleSort } = useSorting<
    TrialBalanceItem,
    SortField
  >({
    initialSortField: 'code',
  });

  const sortedAccounts = useMemo(
    () =>
      orderBy(trialBalance.accounts, [sortField as string], [sortDirection]),
    [trialBalance.accounts, sortField, sortDirection],
  );

  const { debitAccounts, creditAccounts, maxRows } = useMemo(() => {
    const debit = sortedAccounts.filter((a) => a.debit > 0);
    const credit = sortedAccounts.filter((a) => a.credit > 0);
    return {
      debitAccounts: debit,
      creditAccounts: credit,
      maxRows: Math.max(debit.length, credit.length),
    };
  }, [sortedAccounts]);

  const showCode = visibleColumns?.has('code') ?? true;
  const showName = visibleColumns?.has('name') ?? true;
  const showDebit = visibleColumns?.has('debit') ?? true;
  const showCredit = visibleColumns?.has('credit') ?? true;
  // type is an export-only column; this two-sided sheet has no type cell
  const labelSpan = (showCode ? 1 : 0) + (showName ? 1 : 0);
  const creditEdge = 'border-l border-primary pl-6 print-spacing-left';

  if (isLoading) {
    return <LoadingState message="Loading trial balance data..." />;
  }

  if (trialBalance.accounts.length === 0) {
    return <EmptyState message="No trial balance data available." />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
      <h2 className="mb-1 hidden text-center text-lg font-medium print:block print-header">
        Trial Balance as of {formatDisplayDate(trialBalance.date)}
      </h2>
      <div className="relative min-h-0 flex-1 w-full overflow-auto print:overflow-visible">
        <table className="w-full caption-bottom border-collapse text-sm print-table print-tfoot-no-repeat">
          <TableCaption className="mt-4 text-sm text-muted-foreground italic print-caption print:hidden">
            Trial Balance Summary as of {formatDisplayDate(trialBalance.date)}
          </TableCaption>
          <TableHeader>
            <TableRow className="border-b border-primary bg-muted/50">
              {showCode ? (
                <SortableHeader
                  currentSortField={sortField}
                  sortField="code"
                  sortDirection={sortDirection}
                  onSort={() => handleSort('code')}
                  className="text-left py-2 font-bold text-sm"
                >
                  Code
                </SortableHeader>
              ) : null}
              {showName ? (
                <SortableHeader
                  currentSortField={sortField}
                  sortField="name"
                  sortDirection={sortDirection}
                  onSort={() => handleSort('name')}
                  className="text-left py-2 font-bold text-sm"
                >
                  Debit Account
                </SortableHeader>
              ) : null}
              {showDebit ? (
                <SortableHeader
                  currentSortField={sortField}
                  sortField="debit"
                  sortDirection={sortDirection}
                  onSort={() => handleSort('debit')}
                  className="w-24 text-right py-2 font-bold pr-6 print-spacing-right text-sm"
                >
                  Amount
                </SortableHeader>
              ) : null}
              {showCode ? (
                <TableHead
                  className={cn('text-left py-2 font-bold text-sm', creditEdge)}
                >
                  Code
                </TableHead>
              ) : null}
              {showName ? (
                <TableHead
                  className={cn(
                    'text-left py-2 font-bold text-sm',
                    !showCode && creditEdge,
                  )}
                >
                  Credit Account
                </TableHead>
              ) : null}
              {showCredit ? (
                <SortableHeader
                  currentSortField={sortField}
                  sortField="credit"
                  sortDirection={sortDirection}
                  onSort={() => handleSort('credit')}
                  className={cn(
                    'w-24 text-right py-2 font-bold text-sm',
                    labelSpan === 0 && creditEdge,
                  )}
                >
                  Amount
                </SortableHeader>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: maxRows }).map((_, index) => {
              const debitAccount = debitAccounts[index];
              const creditAccount = creditAccounts[index];

              // use actual account IDs for keys when available
              const rowKey = `row-${debitAccount?.id || ''}-${
                creditAccount?.id || ''
              }-${index}`;

              return (
                <TableRow
                  key={rowKey}
                  className={cn(
                    'border-b border-muted hover:bg-muted/30 transition-colors',
                    index % 2 === 0 ? 'bg-background' : 'bg-muted/10',
                  )}
                >
                  {/* Debit side */}
                  {showCode ? (
                    <TableCell className="py-1.5 print:py-0.5 font-mono">
                      {debitAccount ? debitAccount.code : ''}
                    </TableCell>
                  ) : null}
                  {showName ? (
                    <TableCell className="py-1.5 print:py-0.5">
                      {debitAccount ? debitAccount.name : ''}
                    </TableCell>
                  ) : null}
                  {showDebit ? (
                    <TableCell className="text-right py-1.5 print:py-0.5 font-mono pr-6 print-spacing-right">
                      {debitAccount
                        ? getFormattedCurrency(debitAccount.debit)
                            .replace(currency, '')
                            .trim()
                        : ''}
                    </TableCell>
                  ) : null}

                  {/* Credit side */}
                  {showCode ? (
                    <TableCell
                      className={cn(
                        'py-1.5 print:py-0.5 font-mono',
                        creditEdge,
                      )}
                    >
                      {creditAccount ? creditAccount.code : ''}
                    </TableCell>
                  ) : null}
                  {showName ? (
                    <TableCell
                      className={cn(
                        'py-1.5 print:py-0.5',
                        !showCode && creditEdge,
                      )}
                    >
                      {creditAccount ? creditAccount.name : ''}
                    </TableCell>
                  ) : null}
                  {showCredit ? (
                    <TableCell
                      className={cn(
                        'text-right py-1.5 print:py-0.5 font-mono',
                        labelSpan === 0 && creditEdge,
                      )}
                    >
                      {creditAccount
                        ? getFormattedCurrency(creditAccount.credit)
                            .replace(currency, '')
                            .trim()
                        : ''}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter className="border-t-0 print:static [&>tr]:border-t [&>tr]:border-primary">
            <TableRow className="sticky bottom-0 z-10 border-t border-primary bg-muted/95 font-bold hover:bg-muted/95 print:static print:z-auto">
              {labelSpan > 0 ? (
                <TableCell
                  className="bg-inherit py-1.5 print:py-1"
                  colSpan={labelSpan}
                >
                  Total
                </TableCell>
              ) : null}
              {showDebit ? (
                <TableCell className="bg-inherit py-1.5 text-right font-mono pr-6 print-spacing-right print:py-1">
                  {getFormattedCurrency(trialBalance.totalDebit)
                    .replace(currency, '')
                    .trim()}
                </TableCell>
              ) : null}
              {labelSpan > 0 ? (
                <TableCell
                  className={cn('bg-inherit py-1.5 print:py-1', creditEdge)}
                  colSpan={labelSpan}
                >
                  Total
                </TableCell>
              ) : null}
              {showCredit ? (
                <TableCell
                  className={cn(
                    'bg-inherit py-1.5 text-right font-mono print:py-1',
                    labelSpan === 0 && creditEdge,
                  )}
                >
                  {getFormattedCurrency(trialBalance.totalCredit)
                    .replace(currency, '')
                    .trim()}
                </TableCell>
              ) : null}
            </TableRow>
          </TableFooter>
        </table>
      </div>
    </div>
  );
};
