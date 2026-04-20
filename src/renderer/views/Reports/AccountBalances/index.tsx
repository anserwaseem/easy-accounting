import { useCallback, useState } from 'react';
import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Card } from 'renderer/shad/ui/card';
import { Calendar as CalendarIcon, Download, Printer } from 'lucide-react';
import { Calendar } from 'renderer/shad/ui/calendar';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from 'renderer/shad/ui/popover';
import { cn } from 'renderer/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/shad/ui/select';
import { ReportLayout } from 'renderer/components/ReportLayout';
import {
  exportReportToExcel,
  sortDebitCreditRows,
  type DebitCreditExportSortOrder,
  type ReportExportPayload,
} from 'renderer/lib/reportExport';
import { toast } from 'renderer/shad/ui/use-toast';
import { ExportOrderDialog, printStyles } from '../components';
import { useAccountBalances } from './useAccountBalances';
import { AccountBalancesTable } from './AccountBalancesTable';
import type { AccountBalances as AccountBalancesType } from './types';

type AccountBalancesRow = {
  code: string | number;
  name: string;
  debit: number;
  credit: number;
};

const buildAccountBalancesPayload = (
  accountBalances: AccountBalancesType,
  selectedHead: string,
  selectedDate: Date,
  exportSortOrder: DebitCreditExportSortOrder,
): ReportExportPayload<AccountBalancesRow> => {
  const rows = sortDebitCreditRows(
    accountBalances.accounts.map((a) => ({
      code: a.code ?? '',
      name: a.name,
      debit: a.balanceType === 'Dr' ? a.balance : 0,
      credit: a.balanceType === 'Cr' ? a.balance : 0,
    })),
    exportSortOrder,
  );
  return {
    title: 'Account Balances',
    subtitle: `${selectedHead} as of ${format(selectedDate, 'PPP')}`,
    sheetName: 'Account Balances',
    suggestedFileName: `Account_Balances_${selectedHead.replace(
      /\s+/g,
      '_',
    )}_${format(selectedDate, 'yyyy-MM-dd')}.xlsx`,
    columns: [
      { key: 'code', header: 'Account Code', format: 'string', width: 14 },
      { key: 'name', header: 'Account Name', format: 'string', width: 32 },
      { key: 'debit', header: 'Debit', format: 'currency', width: 14 },
      { key: 'credit', header: 'Credit', format: 'currency', width: 14 },
    ],
    rows,
    footerRow: {
      code: '',
      name: 'Total',
      debit: accountBalances.totalDebit,
      credit: accountBalances.totalCredit,
    },
  };
};

const AccountBalancesPage = () => {
  const {
    selectedHead,
    selectedDate,
    charts,
    accountBalances,
    isLoading,
    handleHeadChange,
    handleDateChange,
  } = useAccountBalances();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = useCallback(
    (exportSortOrder: DebitCreditExportSortOrder) => {
      try {
        const payload = buildAccountBalancesPayload(
          accountBalances,
          selectedHead,
          selectedDate,
          exportSortOrder,
        );
        exportReportToExcel(payload);
        toast({
          title: 'Success',
          description: 'Account balances exported to Excel.',
          variant: 'success',
        });
      } catch (error) {
        console.error('Export error:', error);
        toast({
          title: 'Error',
          description: 'Failed to export account balances to Excel.',
          variant: 'destructive',
        });
      }
    },
    [accountBalances, selectedHead, selectedDate],
  );

  const canExport = !isLoading && accountBalances.accounts.length > 0;

  return (
    <ReportLayout
      printStyles={printStyles}
      header={
        <div className="flex justify-between items-center pb-2 print-header">
          <h1 className="title-new">Account Balances</h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Head:</span>
              <Select value={selectedHead} onValueChange={handleHeadChange}>
                <SelectTrigger className="w-[250px]">
                  <SelectValue placeholder="Select a head" />
                </SelectTrigger>
                <SelectContent>
                  {charts.map((chart) => (
                    <SelectItem key={chart.id} value={chart.name}>
                      {chart.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">As of:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-[200px] justify-start text-left font-normal',
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
              onClick={() => setExportDialogOpen(true)}
              title="Export to Excel"
              disabled={!canExport}
            >
              <Download className="h-4 w-4" />
            </Button>
            <ExportOrderDialog
              open={exportDialogOpen}
              onOpenChange={setExportDialogOpen}
              onConfirm={handleExportExcel}
              title="Export Account Balances"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrint}
              title="Print Account Balances"
            >
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        </div>
      }
    >
      {/* Title that shows when printing */}
      <div className="hidden print:block text-center mb-4 print-header">
        <h1 className="text-lg font-medium text-center mb-1">
          Account Balances Report for {selectedHead} as of{' '}
          {format(selectedDate, 'PPP')}
        </h1>
      </div>

      <Card className="shadow-md print-card">
        <AccountBalancesTable
          accountBalances={accountBalances}
          isLoading={isLoading}
        />
      </Card>
    </ReportLayout>
  );
};

export default AccountBalancesPage;
