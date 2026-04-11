import { useCallback, useState } from 'react';
import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { cn, getFormattedCurrency } from 'renderer/lib/utils';
import { Card } from 'renderer/shad/ui/card';
import { ReportLayout } from 'renderer/components/ReportLayout';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import {
  exportReportToExcel,
  type LedgerParticularsExportMode,
  type ReportExportPayload,
} from 'renderer/lib/reportExport';
import { toast } from 'renderer/shad/ui/use-toast';
import {
  DateRangePickerWithPresets,
  type DateRange,
} from '@/renderer/shad/ui/datePicker';
import type { LedgerView } from '@/types';
import { extractJournalIdFromParticulars } from '@/shared/journalParticulars';
import { LedgerParticularsExportDialog, printStyles } from '../components';
import { formatLedgerParticularsForExport } from './formatLedgerParticulars';
import { ledgerPrintStyles } from './ledgerPrintStyles';
import { LedgerReportTable } from './LedgerReportTable';
import { useLedgerReport } from './useLedgerReport';

type LedgerReportRow = {
  date: string | Date;
  particulars: string;
  narration: string;
  debit: number;
  credit: number;
  balance: number;
  balanceType: string;
};

const buildLedgerReportPayload = (
  ledgerEntries: LedgerReportRow[],
  accountName: string,
  dateRange?: DateRange,
): ReportExportPayload<LedgerReportRow> => {
  const fromStr = dateRange?.from ? format(dateRange.from, 'PPP') : '';
  const toStr = dateRange?.to ? format(dateRange.to, 'PPP') : '';
  const subtitle = `${accountName} — ${fromStr} to ${toStr}`;

  return {
    title: 'Ledger Report',
    subtitle,
    sheetName: 'Ledger Report',
    suggestedFileName: `Ledger_${accountName.replace(/\s+/g, '_')}_${format(
      dateRange?.from ?? new Date(),
      'yyyy-MM-dd',
    )}.xlsx`,
    columns: [
      { key: 'date', header: 'Date', format: 'date', width: 14 },
      {
        key: 'particulars',
        header: 'Particulars',
        format: 'string',
        width: 36,
      },
      {
        key: 'narration',
        header: 'Narration',
        format: 'string',
        width: 44,
      },
      { key: 'debit', header: 'Debit', format: 'currency', width: 14 },
      { key: 'credit', header: 'Credit', format: 'currency', width: 14 },
      { key: 'balance', header: 'Balance', format: 'currency', width: 14 },
      { key: 'balanceType', header: 'Type', format: 'string', width: 8 },
    ],
    rows: ledgerEntries,
  };
};

const buildNarrationForExport = (row: LedgerView): string => {
  const jid = extractJournalIdFromParticulars(row.particulars);
  const narrationBase =
    row.journalSummary?.narration ||
    (jid != null ? `View Journal #${jid}` : '');
  if (!row.journalSummary) return narrationBase;

  const isSaleInvoice =
    typeof row.journalSummary.narration === 'string' &&
    /^sale invoice\b/i.test(row.journalSummary.narration);

  const parts: string[] = [narrationBase];
  if (!isSaleInvoice && row.journalSummary.billNumber != null) {
    parts.push(`Bill#: ${row.journalSummary.billNumber}`);
  }
  if (row.journalSummary.discountPercentage != null) {
    parts.push(`Discount: ${row.journalSummary.discountPercentage}%`);
  }
  // keep it one-line so it shows well in excel without special cell wrapping
  return parts.filter(Boolean).join(' | ');
};

const buildLedgerReportExportRows = (
  rows: LedgerView[],
  particularsMode: LedgerParticularsExportMode,
): LedgerReportRow[] =>
  rows.map((row) => ({
    date: row.date,
    particulars: formatLedgerParticularsForExport(row, particularsMode),
    narration: buildNarrationForExport(row),
    debit: row.debit,
    credit: row.credit,
    balance: row.balance,
    balanceType: row.balanceType,
  }));

const LedgerReportPage = () => {
  const {
    accounts,
    selectedAccount,
    setSelectedAccount,
    dateRange,
    handleDateChange,
    ledgerEntries,
    isLoading,
    selectedAccountName,
    refreshData,
    handlePrint,
    presetValue,
    rangeResponse,
    totals,
  } = useLedgerReport();

  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const latestBalance = rangeResponse?.closingBalance
    ? `${getFormattedCurrency(rangeResponse.closingBalance.balance).trim()} ${
        rangeResponse.closingBalance.balanceType
      }`
    : '';

  const runLedgerExcelExport = useCallback(
    (particularsMode: LedgerParticularsExportMode) => {
      if (!ledgerEntries.length) return;
      try {
        const exportRows = buildLedgerReportExportRows(
          ledgerEntries,
          particularsMode,
        );
        const payload = buildLedgerReportPayload(
          exportRows,
          selectedAccountName,
          dateRange ?? undefined,
        );
        payload.footerRow = {
          date: '',
          particulars: '',
          narration: '',
          debit: totals.totalDebit,
          credit: totals.totalCredit,
          balance: totals.totalDifference,
          balanceType: totals.totalType,
        };
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
    },
    [ledgerEntries, selectedAccountName, dateRange, totals],
  );

  const canExport =
    !isLoading && selectedAccount != null && ledgerEntries.length > 0;

  const dateSubtitle =
    dateRange?.from && dateRange?.to
      ? `${format(dateRange.from, 'PP')} – ${format(dateRange.to, 'PP')}`
      : '';

  return (
    <ReportLayout
      printStyles={`${printStyles}${ledgerPrintStyles}`}
      header={
        <div className="print-header flex flex-col gap-2 pb-2">
          <div className="flex justify-between items-center pb-2">
            <h1 className="title-new">Ledger Report</h1>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Account:</span>
                <div className="w-[200px]">
                  <VirtualSelect
                    options={accounts || []}
                    value={selectedAccount?.toString()}
                    onChange={(value) => setSelectedAccount(Number(value))}
                    placeholder="Select account"
                    searchPlaceholder="Search accounts..."
                    autoFocusTrigger={selectedAccount == null}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Range:</span>
                <DateRangePickerWithPresets
                  $onSelect={handleDateChange}
                  presets={[{ label: 'All', value: 'all' }]}
                  initialRange={dateRange ?? undefined}
                  initialSelectValue={presetValue}
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={refreshData}
                title="Refresh Data"
                disabled={isLoading}
              >
                <RefreshCw
                  className={cn('h-4 w-4', isLoading && 'animate-spin')}
                />
              </Button>
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
                title="Print Ledger Report"
              >
                <Printer className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {selectedAccount && !isLoading && latestBalance && (
            <div className="print:hidden text-right text-sm text-muted-foreground">
              Closing Balance:{' '}
              <span className="font-semibold">{latestBalance}</span>
            </div>
          )}
        </div>
      }
    >
      <LedgerParticularsExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        onConfirm={runLedgerExcelExport}
        title="Export ledger to Excel"
      />
      {selectedAccount && !isLoading && (
        <LedgerReportTable
          ledger={ledgerEntries}
          isLoading={isLoading}
          accountName={selectedAccountName}
          dateSubtitle={dateSubtitle}
          totals={totals}
        />
      )}
      {!selectedAccount && !isLoading && (
        <Card className="p-6 flex items-center justify-center text-muted-foreground h-64">
          Please select an account to view its ledger
        </Card>
      )}
      {isLoading && (
        <Card className="p-6 flex items-center justify-center text-muted-foreground h-64">
          Loading...
        </Card>
      )}
    </ReportLayout>
  );
};

export default LedgerReportPage;
