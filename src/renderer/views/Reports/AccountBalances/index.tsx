import { useCallback, useMemo, useState } from 'react';
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
import { formatDisplayDate } from '@/lib/displayDate';
import { ReportFilter, ReportHeader } from '@/renderer/components/ReportHeader';
import { ReportColumnsMenu } from '@/renderer/components/ReportColumnsMenu';
import { useReportColumnVisibility } from '@/renderer/hooks/useReportColumnVisibility';
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
  visibleColumns?: ReadonlySet<string>,
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
    subtitle: `${selectedHead} as of ${formatDisplayDate(selectedDate)}`,
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
    ].filter((column) =>
      (visibleColumns ?? new Set(['code', 'name', 'debit', 'credit'])).has(
        String(column.key),
      ),
    ) as ReportExportPayload<AccountBalancesRow>['columns'],
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

  const accountBalancesColumnSpecs = useMemo(
    () => [
      { id: 'code', label: 'Account Code' },
      { id: 'name', label: 'Account Name' },
      { id: 'debit', label: 'Debit' },
      { id: 'credit', label: 'Credit' },
    ],
    [],
  );
  const accountBalancesColumnIds = useMemo(
    () => accountBalancesColumnSpecs.map((column) => column.id),
    [accountBalancesColumnSpecs],
  );
  const columnVisibility = useReportColumnVisibility(
    'account-balances',
    accountBalancesColumnIds,
  );
  const visibleAccountBalancesColumns = columnVisibility.included;

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
          visibleAccountBalancesColumns,
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
    [
      accountBalances,
      selectedHead,
      selectedDate,
      visibleAccountBalancesColumns,
    ],
  );

  const canExport = !isLoading && accountBalances.accounts.length > 0;

  return (
    <ReportLayout
      printStyles={printStyles}
      header={
        // The filters were a single non-wrapping row: a 250px head
        // select, a 200px date button and an icon button needed ~522px,
        // so on a phone the date control and the export button were
        // pushed off-screen and clipped.
        <ReportHeader
          title="Account Balances"
          filters={
            <>
              <ReportFilter label="Head:">
                <Select value={selectedHead} onValueChange={handleHeadChange}>
                  <SelectTrigger className="w-full sm:w-[250px]">
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
              </ReportFilter>
              <ReportFilter label="As of:">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal sm:w-[200px]',
                        isLoading && 'opacity-70 cursor-not-allowed',
                      )}
                      disabled={isLoading}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formatDisplayDate(selectedDate)}
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
              </ReportFilter>
            </>
          }
          actions={
            <>
              <ReportColumnsMenu
                columns={accountBalancesColumnSpecs}
                included={columnVisibility.included}
                onToggle={columnVisibility.toggle}
                onToggleAll={columnVisibility.toggleAll}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setExportDialogOpen(true)}
                title="Export to Excel"
                disabled={!canExport}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrint}
                title="Print Account Balances"
              >
                <Printer className="h-4 w-4" />
              </Button>
            </>
          }
        />
      }
    >
      <ExportOrderDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        onConfirm={handleExportExcel}
        title="Export Account Balances"
      />

      {/* Title that shows when printing */}
      <div className="hidden print:block text-center mb-4 print-header">
        <h1 className="text-lg font-medium text-center mb-1">
          Account Balances Report for {selectedHead} as of{' '}
          {formatDisplayDate(selectedDate)}
        </h1>
      </div>

      <Card className="shadow-md print-card">
        <AccountBalancesTable
          accountBalances={accountBalances}
          isLoading={isLoading}
          visibleColumns={visibleAccountBalancesColumns}
        />
      </Card>
    </ReportLayout>
  );
};

export default AccountBalancesPage;
