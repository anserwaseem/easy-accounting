import { format } from 'date-fns';
import { cn } from 'renderer/lib/utils';
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
import type { TrialBalanceTableProps } from './types';

export const TrialBalanceTable = ({
  trialBalance,
  isLoading,
}: TrialBalanceTableProps) => {
  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64 print-loading-state">
        <p className="text-muted-foreground animate-pulse">
          Loading trial balance data...
        </p>
      </div>
    );
  }

  if (trialBalance.accounts.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <p className="text-muted-foreground">
          No trial balance data available.
        </p>
      </div>
    );
  }

  const debitAccounts = trialBalance.accounts.filter((a) => a.debit > 0);
  const creditAccounts = trialBalance.accounts.filter((a) => a.credit > 0);
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
            <TableHead className="text-left py-2 font-bold text-sm">
              Code
            </TableHead>
            <TableHead className="text-left py-2 font-bold text-sm">
              Debit Account
            </TableHead>
            <TableHead className="w-24 text-right py-2 font-bold pr-6 print-spacing-right text-sm">
              Amount
            </TableHead>
            <TableHead className="text-left py-2 font-bold border-l border-primary pl-6 print-spacing-left text-sm">
              Code
            </TableHead>
            <TableHead className="text-left py-2 font-bold text-sm">
              Credit Account
            </TableHead>
            <TableHead className="w-24 text-right py-2 font-bold text-sm">
              Amount
            </TableHead>
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
                  {debitAccount ? debitAccount.debit.toFixed(2) : ''}
                </TableCell>

                {/* Credit side */}
                <TableCell className="py-1.5 print:py-0.5 border-l border-primary pl-6 print-spacing-left font-mono">
                  {creditAccount ? creditAccount.code : ''}
                </TableCell>
                <TableCell className="py-1.5 print:py-0.5">
                  {creditAccount ? creditAccount.name : ''}
                </TableCell>
                <TableCell className="text-right py-1.5 print:py-0.5 font-mono">
                  {creditAccount ? creditAccount.credit.toFixed(2) : ''}
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
              {trialBalance.totalDebit.toFixed(2)}
            </TableCell>
            <TableCell
              className="border-l border-primary pl-6 print-spacing-left"
              colSpan={2}
            >
              Total
            </TableCell>
            <TableCell className="text-right py-1.5 print:py-1 font-mono">
              {trialBalance.totalCredit.toFixed(2)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
};
