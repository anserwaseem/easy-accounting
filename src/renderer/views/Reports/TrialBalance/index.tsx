/* eslint-disable react/prop-types */
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { isEmpty, sum } from 'lodash';
import type {
  TrialBalance,
  TrialBalanceItem,
  Account,
  LedgerView,
} from '@/types';
import { Card } from 'renderer/shad/ui/card';
import { Button } from 'renderer/shad/ui/button';
import { Calendar as CalendarIcon, Printer } from 'lucide-react';
import { Calendar } from 'renderer/shad/ui/calendar';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from 'renderer/shad/ui/popover';
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

// print-specific styles for compact trial balance display
const printStyles = `
  @media print {
    html, body {
      font-size: 9px !important;
      margin: 0 !important;
      padding: 0 !important;
      color: #000 !important;
    }

    .print-container {
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      color: #000 !important;
    }

    .print-card {
      padding: 0 !important;
      box-shadow: none !important;
      border: none !important;
      color: #000 !important;
    }

    .print-table {
      width: 100% !important;
      border-collapse: collapse !important;
      color: #000 !important;
      table-layout: auto !important;
    }

    .print-table th,
    .print-table td {
      padding: 1px 2px !important;
      line-height: 1 !important;
      color: #000 !important;
      white-space: nowrap !important;
    }

    .print-table th {
      font-weight: 700 !important;
    }

    .print-table .print-spacing-right {
      padding-right: 3px !important;
    }

    .print-table .print-spacing-left {
      padding-left: 3px !important;
    }

    .print-header {
      margin-bottom: 4px !important;
      font-size: 12px !important;
      color: #000 !important;
    }

    .print-caption {
      margin-top: 4px !important;
      font-size: 8px !important;
      color: #000 !important;
    }

    /* Only show the footer on the last page */
    .print-table tfoot {
      display: table-row-group !important;
    }

    /* Remove hover effects in print */
    .print-table tr:hover {
      background: none !important;
    }

    /* Force black text for all elements */
    .print-table tr,
    .print-table td,
    .print-table th,
    .print-table tfoot td {
      color: #000 !important;
      border-color: #000 !important;
    }

    /* Reduce height of rows */
    .print-table tr {
      height: auto !important;
      max-height: 1em !important;
    }

    /* Clear any background colors */
    .print-table tr,
    .print-table th,
    .print-table td,
    .print-table tfoot td {
      background-color: transparent !important;
    }

    /* Set proper margins for portrait mode */
    @page {
      margin: 0.5cm;
    }

    /* Hide loading states in print */
    .print-loading-state {
      display: none !important;
    }

    /* Force black text for specific elements that might have custom colors */
    .text-primary,
    .text-muted-foreground,
    .font-mono,
    .font-medium,
    h1, h2, h3, h4, h5, h6 {
      color: #000 !important;
    }
  }
`;

// trial balance table component
type TrialBalanceTableProps = {
  trialBalance: TrialBalance;
  isLoading: boolean;
};

const TrialBalanceTable: React.FC<TrialBalanceTableProps> = ({
  trialBalance,
  isLoading,
}) => {
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

// main trial balance page component
const TrialBalancePage: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [trialBalance, setTrialBalance] = useState<TrialBalance>({
    date: new Date(),
    accounts: [],
    totalDebit: 0,
    totalCredit: 0,
    isBalanced: true,
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchTrialBalance = async (date: Date) => {
    setIsLoading(true);
    try {
      // fetch all accounts with their balances
      const accounts = (await window.electron.getAccounts()) as Account[];

      // get all account IDs
      const accountIds = accounts.map((account: Account) => account.id);

      // fetch all ledgers in a single batch operation
      const ledgersPromises = accountIds.map((id: number) =>
        window.electron.getLedger(id),
      );
      const ledgersResults = await Promise.all(ledgersPromises);

      // map accounts to ledgers
      const accountLedgers = accounts.reduce(
        (
          acc: Record<number, LedgerView[]>,
          account: Account,
          index: number,
        ) => {
          acc[account.id] = ledgersResults[index];
          return acc;
        },
        {} as Record<number, LedgerView[]>,
      );

      // transform accounts into trial balance format
      const trialBalanceItems: TrialBalanceItem[] = [];
      const selectedDateEnd = new Date(date);
      selectedDateEnd.setHours(23, 59, 59, 999); // set to end of day for comparison

      for (const account of accounts) {
        const ledger = accountLedgers[account.id];

        if (isEmpty(ledger)) continue;

        // filter ledger entries up to the selected date
        const entriesUpToSelectedDate = ledger.filter(
          (entry) => new Date(entry.date) <= selectedDateEnd,
        );

        if (isEmpty(entriesUpToSelectedDate)) continue;

        const latestEntry =
          entriesUpToSelectedDate[entriesUpToSelectedDate.length - 1];
        const { balance, balanceType } = latestEntry;

        if (balance === 0) continue; // skip accounts with zero balance

        trialBalanceItems.push({
          id: account.id,
          name: account.name,
          code: account.code,
          type: account.type,
          debit: balanceType === 'Dr' ? balance : 0,
          credit: balanceType === 'Cr' ? balance : 0,
        });
      }

      const totalDebit = sum(trialBalanceItems.map((item) => item.debit));
      const totalCredit = sum(trialBalanceItems.map((item) => item.credit));

      setTrialBalance({
        date,
        accounts: trialBalanceItems,
        totalDebit,
        totalCredit,
        isBalanced: totalDebit === totalCredit,
      });
    } catch (error) {
      console.error('Error fetching trial balance:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTrialBalance(selectedDate);
  }, [selectedDate]);

  const handleDateChange = (date: Date | undefined) => {
    if (!date) return;
    setSelectedDate(date);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <style>{printStyles}</style>
      <div className="w-full mx-auto print-container">
        <div className="flex justify-between items-center mb-6 print-header">
          <h1 className="text-2xl font-semibold text-primary print:hidden">
            Trial Balance
          </h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground print:hidden">
                As of:
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-[200px] justify-start text-left font-normal print:hidden',
                      isLoading && 'opacity-70 cursor-not-allowed',
                    )}
                    disabled={isLoading}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(selectedDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={handleDateChange}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrint}
              title="Print Trial Balance"
              className="print:hidden"
            >
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Card className="p-6 shadow-md print-card">
          {!trialBalance.isBalanced && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive rounded-md text-sm text-destructive print:hidden">
              Trial balance is not balanced! Difference:{' '}
              {Math.abs(
                trialBalance.totalDebit - trialBalance.totalCredit,
              ).toFixed(2)}
            </div>
          )}

          <TrialBalanceTable
            trialBalance={trialBalance}
            isLoading={isLoading}
          />
        </Card>
      </div>
    </>
  );
};

export default TrialBalancePage;
