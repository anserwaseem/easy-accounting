import { useCallback } from 'react';
import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import {
  Calendar as CalendarIcon,
  Download,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { Calendar } from 'renderer/shad/ui/calendar';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from 'renderer/shad/ui/popover';
import { cn, getFormattedCurrency } from 'renderer/lib/utils';
import { Card } from 'renderer/shad/ui/card';
import { ReportLayout } from 'renderer/components/ReportLayout';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import {
  exportReportToExcel,
  type ReportExportPayload,
} from 'renderer/lib/reportExport';
import type { LedgerView } from '@/types';
import { toast } from 'renderer/shad/ui/use-toast';
import { printStyles } from '../components';
import { useLedgerReport } from './useLedgerReport';
import { LedgerReportTable } from './LedgerReportTable';
import { ledgerPrintStyles } from './ledgerPrintStyles';

type LedgerReportRow = {
  date: string | Date;
  particulars: string;
  debit: number;
  credit: number;
  balance: number;
  balanceType: string;
};

const buildLedgerReportPayload = (
  ledgerEntries: LedgerView[],
  accountName: string,
  selectedDate: Date,
): ReportExportPayload<LedgerReportRow> => ({
  title: 'Ledger Report',
  subtitle: `${accountName} as of ${format(selectedDate, 'PPP')}`,
  sheetName: 'Ledger Report',
  suggestedFileName: `Ledger_${accountName.replace(/\s+/g, '_')}_${format(
    selectedDate,
    'yyyy-MM-dd',
  )}.xlsx`,
  columns: [
    { key: 'date', header: 'Date', format: 'date', width: 14 },
    { key: 'particulars', header: 'Particulars', format: 'string', width: 36 },
    { key: 'debit', header: 'Debit', format: 'currency', width: 14 },
    { key: 'credit', header: 'Credit', format: 'currency', width: 14 },
    { key: 'balance', header: 'Balance', format: 'currency', width: 14 },
    { key: 'balanceType', header: 'Type', format: 'string', width: 8 },
  ],
  rows: ledgerEntries.map((e) => ({
    date: e.date,
    particulars: e.linkedAccountName ?? e.particulars ?? '',
    debit: e.debit,
    credit: e.credit,
    balance: e.balance,
    balanceType: e.balanceType,
  })),
});

const LedgerReportPage = () => {
  const {
    accounts,
    selectedAccount,
    setSelectedAccount,
    selectedDate,
    handleDateChange,
    ledgerEntries,
    isLoading,
    selectedAccountName,
    refreshData,
    handlePrint,
  } = useLedgerReport();

  // Calculate latest balance for header display
  const latestBalance =
    ledgerEntries.length > 0
      ? `${getFormattedCurrency(
          ledgerEntries.at(-1)?.balance ?? 0,
        ).trim()} ${ledgerEntries.at(-1)?.balanceType}`
      : '';

  const handleExportExcel = useCallback(() => {
    try {
      const payload = buildLedgerReportPayload(
        ledgerEntries,
        selectedAccountName,
        selectedDate,
      );
      exportReportToExcel(payload);
      toast({
        title: 'Success',
        description: 'Ledger report exported to Excel.',
        variant: 'success',
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Error',
        description: 'Failed to export ledger report to Excel.',
        variant: 'destructive',
      });
    }
  }, [ledgerEntries, selectedAccountName, selectedDate]);

  const canExport =
    !isLoading && selectedAccount != null && ledgerEntries.length > 0;

  return (
    <ReportLayout
      printStyles={`${printStyles}${ledgerPrintStyles}`}
      header={
        <div className="print-header flex flex-col gap-2 pb-2">
          <div className="flex justify-between items-center pb-2">
            {/* Title */}
            <h1 className="title-new">Ledger Report</h1>
            {/* Filters Section */}
            <div className="flex items-center gap-4">
              {/* Account */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Account:</span>
                <div className="w-[200px]">
                  <VirtualSelect
                    options={accounts || []}
                    value={selectedAccount?.toString()}
                    onChange={(value) => setSelectedAccount(Number(value))}
                    placeholder="Select account"
                    searchPlaceholder="Search accounts..."
                  />
                </div>
              </div>
              {/* As of */}
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
                onClick={refreshData}
                title="Refresh Data"
                disabled={isLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleExportExcel}
                title="Export to Excel"
                disabled={!canExport}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrint}
                title="Print Ledger Report"
              >
                <Printer className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Latest Balance - FIXED in header */}
          {selectedAccount && !isLoading && ledgerEntries.length > 0 && (
            <div className="print:hidden text-right text-sm text-muted-foreground">
              Latest Balance:{' '}
              <span className="font-semibold">{latestBalance}</span>
            </div>
          )}
        </div>
      }
    >
      {selectedAccount && !isLoading ? (
        <LedgerReportTable
          ledger={ledgerEntries}
          isLoading={isLoading}
          selectedDate={selectedDate}
          accountName={selectedAccountName}
        />
      ) : (
        <Card className="p-6 flex items-center justify-center text-muted-foreground h-64">
          Please select an account to view its ledger
        </Card>
      )}
    </ReportLayout>
  );
};

export default LedgerReportPage;
