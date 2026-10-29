import { useCallback, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { cn, getFormattedCurrency } from 'renderer/lib/utils';
import { Card } from 'renderer/shad/ui/card';
import { ReportLayout } from 'renderer/components/ReportLayout';
import { ReportFilter, ReportHeader } from 'renderer/components/ReportHeader';
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
import { formatDisplayDate } from '@/lib/displayDate';
import { ReportColumnsMenu } from '@/renderer/components/ReportColumnsMenu';
import { useReportColumnVisibility } from '@/renderer/hooks/useReportColumnVisibility';
import { loadSavedFilters } from '@/renderer/lib/reportFilters';
import { REPORT_FILTER_KEYS } from 'types';
import { LedgerParticularsExportDialog, printStyles } from '../components';
import { formatLedgerParticularsForExport } from './formatLedgerParticulars';
import { ledgerPrintStyles } from './ledgerPrintStyles';
import { LedgerReportTable } from './LedgerReportTable';
import { useLedgerReport } from './useLedgerReport';

type LedgerReportRow = {
  date: string | Date;
  particulars: string;
  tierBreakdown: string;
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
  visibleColumns?: ReadonlySet<string>,
  includeTierBreakdown: boolean = false,
): ReportExportPayload<LedgerReportRow> => {
  const fromStr = dateRange?.from ? formatDisplayDate(dateRange.from) : '';
  const toStr = dateRange?.to ? formatDisplayDate(dateRange.to) : '';
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
        key: 'tierBreakdown',
        header: 'Tier breakdown',
        format: 'string',
        width: 40,
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
    ].filter((column) => {
      const hasTierBreakdown = ledgerEntries.some(
        (r: any) => !!r.tierBreakdown,
      );
      if (column.key === 'tierBreakdown') {
        if (!includeTierBreakdown || !hasTierBreakdown) return false;
      }
      return visibleColumns ? visibleColumns.has(String(column.key)) : true;
    }) as ReportExportPayload<LedgerReportRow>['columns'],
    rows: ledgerEntries,
  };
};

const buildNarrationForExport = (row: LedgerView): string => {
  const jid = extractJournalIdFromParticulars(row.particulars);
  const narrationBase =
    row.journalSummary?.narration ||
    (jid != null ? `View Journal #${jid}` : '');
  // keep it one-line so it shows well in excel without special cell wrapping
  return narrationBase;
};

const buildLedgerReportExportRows = (
  rows: LedgerView[],
  particularsMode: LedgerParticularsExportMode,
): LedgerReportRow[] =>
  rows.map((row) => ({
    date: row.date,
    particulars: formatLedgerParticularsForExport(row, particularsMode),
    tierBreakdown: row.tierBreakdown ?? '',
    narration: buildNarrationForExport(row),
    debit: row.debit,
    credit: row.credit,
    balance: row.balance,
    balanceType: row.balanceType,
  }));

const LedgerReportPage = () => {
  const ledgerSaved = useMemo(
    () => loadSavedFilters(REPORT_FILTER_KEYS.ledger),
    [],
  );
  const [familyMode, setFamilyMode] = useState<boolean>(
    ledgerSaved.familyMode ?? false,
  );

  const ledgerColumnSpecs = useMemo(
    () => [
      { id: 'date', label: 'Date' },
      { id: 'particulars', label: 'Particulars' },
      ...(familyMode ? [{ id: 'tierBreakdown', label: 'Tier breakdown' }] : []),
      { id: 'narration', label: 'Narration' },
      { id: 'debit', label: 'Debit' },
      { id: 'credit', label: 'Credit' },
      { id: 'balance', label: 'Balance' },
      { id: 'balanceType', label: 'Type' },
    ],
    [familyMode],
  );
  const ledgerColumnIds = useMemo(
    () => ledgerColumnSpecs.map((column) => column.id),
    [ledgerColumnSpecs],
  );
  const columnVisibility = useReportColumnVisibility(
    'ledger-report',
    ledgerColumnIds,
  );
  const visibleLedgerColumns = columnVisibility.included;

  const {
    accounts,
    selectedAccount,
    setSelectedAccount,
    dateRange,
    handleDateChange,
    ledgerEntries,
    isLoading,
    selectedAccountName,
    printAccountName,
    refreshData,
    handlePrint,
    presetValue,
    rangeResponse,
    totals,
    familyAccountIds,
  } = useLedgerReport(visibleLedgerColumns, familyMode, setFamilyMode);

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
          printAccountName,
          dateRange ?? undefined,
          visibleLedgerColumns,
          familyMode,
        );
        payload.footerRow = {
          date: '',
          particulars: '',
          tierBreakdown: '',
          narration: '',
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
    [
      ledgerEntries,
      printAccountName,
      dateRange,
      totals,
      visibleLedgerColumns,
      familyMode,
    ],
  );

  const canExport =
    !isLoading && selectedAccount != null && ledgerEntries.length > 0;

  const dateSubtitle =
    dateRange?.from && dateRange?.to
      ? `${formatDisplayDate(dateRange.from)} – ${formatDisplayDate(
          dateRange.to,
        )}`
      : '';

  return (
    <ReportLayout
      printStyles={`${printStyles}${ledgerPrintStyles}`}
      header={
        <>
          <ReportHeader
            title={familyMode ? 'Consolidated Ledger Report' : 'Ledger Report'}
            filters={
              <>
                <ReportFilter label="Mode:">
                  <Button
                    variant={familyMode ? 'default' : 'outline'}
                    size="sm"
                    className="h-9"
                    title="Combine base and tier accounts"
                    onClick={() => setFamilyMode((value) => !value)}
                  >
                    {familyMode ? 'Combined' : 'Single'}
                  </Button>
                </ReportFilter>
                <ReportFilter label="Account:">
                  <div className="min-w-0 flex-1 sm:w-[200px] sm:flex-none">
                    <VirtualSelect
                      options={accounts || []}
                      value={selectedAccount?.toString()}
                      onChange={(value) => setSelectedAccount(Number(value))}
                      placeholder="Select account"
                      searchPlaceholder="Search accounts..."
                      autoFocusTrigger={selectedAccount == null}
                    />
                  </div>
                </ReportFilter>
                <ReportFilter label="Range:">
                  <DateRangePickerWithPresets
                    $onSelect={handleDateChange}
                    presets={[{ label: 'All', value: 'all' }]}
                    initialRange={dateRange ?? undefined}
                    initialSelectValue={presetValue}
                  />
                </ReportFilter>
              </>
            }
            actions={
              <>
                <ReportColumnsMenu
                  columns={ledgerColumnSpecs}
                  included={columnVisibility.included}
                  onToggle={columnVisibility.toggle}
                  onToggleAll={columnVisibility.toggleAll}
                />
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
              </>
            }
          />
          {selectedAccount && !isLoading && latestBalance && (
            <div className="print:hidden text-right text-sm text-muted-foreground">
              Closing Balance:{' '}
              <span className="font-semibold">{latestBalance}</span>
            </div>
          )}
          {familyMode && selectedAccount && !isLoading && (
            <div className="print:hidden text-xs text-muted-foreground">
              Included accounts:{' '}
              {(accounts ?? [])
                .filter((a: any) => familyAccountIds.includes(a.id))
                .map((a: any) => String(a.code ?? a.id))
                .join(', ')}
            </div>
          )}
        </>
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
          visibleColumns={visibleLedgerColumns}
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
