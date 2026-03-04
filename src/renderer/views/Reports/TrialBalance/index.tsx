import { useCallback, useState } from 'react';
import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Calendar as CalendarIcon, Download, Printer } from 'lucide-react';
import { Calendar } from 'renderer/shad/ui/calendar';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from 'renderer/shad/ui/popover';
import { cn } from 'renderer/lib/utils';
import {
  exportReportToExcel,
  sortDebitCreditRows,
  type DebitCreditExportSortOrder,
  type ReportExportPayload,
} from 'renderer/lib/reportExport';
import { Card } from 'renderer/shad/ui/card';
import { toast } from 'renderer/shad/ui/use-toast';
import { ReportLayout } from 'renderer/components/ReportLayout';
import { ExportOrderDialog, printStyles } from '../components';
import { TrialBalanceTable } from './TrialBalanceTable';
import type { TrialBalance as TrialBalanceType } from './types';
import { useTrialBalance } from './useTrialBalance';

type TrialBalanceRow = {
  code: string | number;
  name: string;
  type: string;
  debit: number;
  credit: number;
};

const buildSortedTrialBalanceRows = (
  trialBalance: TrialBalanceType,
  exportSortOrder: DebitCreditExportSortOrder,
): TrialBalanceRow[] => {
  const baseRows: TrialBalanceRow[] = trialBalance.accounts.map((a) => ({
    code: a.code ?? '',
    name: a.name,
    type: a.type,
    debit: a.debit,
    credit: a.credit,
  }));

  // for trial balance export, "unsorted" means default ordering: type A–Z (then code, then name)
  const typeSortedRows = [...baseRows].sort((a, b) => {
    const aType = String(a.type ?? '');
    const bType = String(b.type ?? '');
    const typeCompare = aType.localeCompare(bType);
    if (typeCompare !== 0) return typeCompare;

    const codeCompare = String(a.code ?? '').localeCompare(
      String(b.code ?? ''),
    );
    if (codeCompare !== 0) return codeCompare;

    return String(a.name ?? '').localeCompare(String(b.name ?? ''));
  });

  if (exportSortOrder === 'unsorted') return typeSortedRows;
  return sortDebitCreditRows(typeSortedRows, exportSortOrder);
};

const buildTrialBalancePayload = (
  trialBalance: TrialBalanceType,
  selectedDate: Date,
  exportSortOrder: DebitCreditExportSortOrder,
): ReportExportPayload<TrialBalanceRow> => {
  const rows = buildSortedTrialBalanceRows(trialBalance, exportSortOrder);
  return {
    title: 'Trial Balance',
    subtitle: `As of ${format(selectedDate, 'PPP')}`,
    sheetName: 'Trial Balance',
    suggestedFileName: `Trial_Balance_${format(
      selectedDate,
      'yyyy-MM-dd',
    )}.xlsx`,
    columns: [
      { key: 'code', header: 'Code', format: 'string', width: 14 },
      { key: 'name', header: 'Account Name', format: 'string', width: 32 },
      { key: 'type', header: 'Type', format: 'string', width: 14 },
      { key: 'debit', header: 'Debit', format: 'currency', width: 14 },
      { key: 'credit', header: 'Credit', format: 'currency', width: 14 },
    ],
    rows,
    footerRow: {
      code: '',
      name: 'Total',
      type: '',
      debit: trialBalance.totalDebit,
      credit: trialBalance.totalCredit,
    },
  };
};

const TrialBalancePage = () => {
  const { selectedDate, trialBalance, isLoading, handleDateChange } =
    useTrialBalance();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = useCallback(
    (exportSortOrder: DebitCreditExportSortOrder) => {
      try {
        const payload = buildTrialBalancePayload(
          trialBalance,
          selectedDate,
          exportSortOrder,
        );
        exportReportToExcel(payload);
        toast({
          title: 'Success',
          description: 'Trial balance exported to Excel.',
          variant: 'success',
        });
      } catch (error) {
        console.error('Export error:', error);
        toast({
          title: 'Error',
          description: 'Failed to export trial balance to Excel.',
          variant: 'destructive',
        });
      }
    },
    [trialBalance, selectedDate],
  );

  const canExport = !isLoading && trialBalance.accounts.length > 0;

  return (
    <ReportLayout
      printStyles={printStyles}
      header={
        <div className="flex justify-between items-center pb-2 print-header">
          <h1 className="text-2xl font-semibold text-primary">Trial Balance</h1>
          <div className="flex items-center gap-4">
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
              title="Export Trial Balance"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrint}
              title="Print Trial Balance"
            >
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        </div>
      }
    >
      <Card className="p-6 shadow-md print-card">
        {!trialBalance.isBalanced && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive rounded-md text-sm text-destructive print:hidden">
            Trial balance is not balanced! Difference:{' '}
            {Math.abs(
              trialBalance.totalDebit - trialBalance.totalCredit,
            ).toFixed(2)}
          </div>
        )}

        <TrialBalanceTable trialBalance={trialBalance} isLoading={isLoading} />
      </Card>
    </ReportLayout>
  );
};

export default TrialBalancePage;
