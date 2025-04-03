import { format } from 'date-fns';
import { cn, getFormattedCurrency } from 'renderer/lib/utils';
import { currency } from 'renderer/lib/constants';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from 'renderer/shad/ui/table';
import type { TrialBalanceTableProps, TrialBalanceItem } from './types';
import {
  EmptyState,
  LoadingState,
  SortableHeader,
  useSorting,
} from '../components';

type SortField = 'code' | 'name' | 'debit' | 'credit';

export const TrialBalanceTable = ({
  trialBalance,
  isLoading,
}: TrialBalanceTableProps) => {
  const { sortField, sortDirection, handleSort, sortItems } = useSorting<
    TrialBalanceItem,
    SortField
  >({
    initialSortField: 'code',
  });

  if (isLoading) {
    return <LoadingState message="Loading trial balance data..." />;
  }

  if (trialBalance.accounts.length === 0) {
    return <EmptyState message="No trial balance data available." />;
  }

  // Sort accounts based on current sort settings
  const sortedAccounts = sortItems(trialBalance.accounts);

  // Split into debit and credit accounts after sorting
  const debitAccounts = sortedAccounts.filter((a) => a.debit > 0);
  const creditAccounts = sortedAccounts.filter((a) => a.credit > 0);
  const maxRows = Math.max(debitAccounts.length, creditAccounts.length);

  return (
    <div className="overflow-hidden print:overflow-visible">
      <h2 className="text-lg font-medium text-center mb-1 hidden print:block print-header">
        Trial Balance as of {format(trialBalance.date, 'PPP')}
      </h2>
      <Table className="border-collapse print-table">
        <TableCaption className="mt-4 text-sm text-muted-foreground italic print-caption print:hidden">
          Trial Balance Summary as of {format(trialBalance.date, 'PPP')}
        </TableCaption>
        <TableHeader>
          <TableRow className="border-b border-primary bg-muted/50">
            <SortableHeader
              currentSortField={sortField}
              sortField="code"
              sortDirection={sortDirection}
              onSort={() => handleSort('code')}
              className="text-left py-2 font-bold text-sm"
            >
              Code
            </SortableHeader>
            <SortableHeader
              currentSortField={sortField}
              sortField="name"
              sortDirection={sortDirection}
              onSort={() => handleSort('name')}
              className="text-left py-2 font-bold text-sm"
            >
              Debit Account
            </SortableHeader>
            <SortableHeader
              currentSortField={sortField}
              sortField="debit"
              sortDirection={sortDirection}
              onSort={() => handleSort('debit')}
              className="w-24 text-right py-2 font-bold pr-6 print-spacing-right text-sm"
            >
              Amount
            </SortableHeader>
            <TableHead className="text-left py-2 font-bold border-l border-primary pl-6 print-spacing-left text-sm">
              Code
            </TableHead>
            <TableHead className="text-left py-2 font-bold text-sm">
              Credit Account
            </TableHead>
            <SortableHeader
              currentSortField={sortField}
              sortField="credit"
              sortDirection={sortDirection}
              onSort={() => handleSort('credit')}
              className="w-24 text-right py-2 font-bold text-sm"
            >
              Amount
            </SortableHeader>
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
                <TableCell className="py-1.5 print:py-0.5 font-mono">
                  {debitAccount ? debitAccount.code : ''}
                </TableCell>
                <TableCell className="py-1.5 print:py-0.5">
                  {debitAccount ? debitAccount.name : ''}
                </TableCell>
                <TableCell className="text-right py-1.5 print:py-0.5 font-mono pr-6 print-spacing-right">
                  {debitAccount
                    ? getFormattedCurrency(debitAccount.debit)
                        .replace(currency, '')
                        .trim()
                    : ''}
                </TableCell>

                {/* Credit side */}
                <TableCell className="py-1.5 print:py-0.5 border-l border-primary pl-6 print-spacing-left font-mono">
                  {creditAccount ? creditAccount.code : ''}
                </TableCell>
                <TableCell className="py-1.5 print:py-0.5">
                  {creditAccount ? creditAccount.name : ''}
                </TableCell>
                <TableCell className="text-right py-1.5 print:py-0.5 font-mono">
                  {creditAccount
                    ? getFormattedCurrency(creditAccount.credit)
                        .replace(currency, '')
                        .trim()
                    : ''}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow className="border-t border-primary font-bold bg-muted/20">
            <TableCell className="py-1.5 print:py-1" colSpan={2}>
              Total
            </TableCell>
            <TableCell className="text-right py-1.5 print:py-1 font-mono pr-6 print-spacing-right">
              {getFormattedCurrency(trialBalance.totalDebit)
                .replace(currency, '')
                .trim()}
            </TableCell>
            <TableCell
              className="border-l border-primary pl-6 print-spacing-left"
              colSpan={2}
            >
              Total
            </TableCell>
            <TableCell className="text-right py-1.5 print:py-1 font-mono">
              {getFormattedCurrency(trialBalance.totalCredit)
                .replace(currency, '')
                .trim()}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
};
