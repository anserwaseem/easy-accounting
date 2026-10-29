import { useCallback, useState } from 'react';
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
  language: 'en' | 'ur' = 'en',
): ReportExportPayload<LedgerReportRow> => {
  const labels =
    language === 'ur'
      ? {
          date: 'تاریخ',
          particulars: 'تفصیل',
          tierBreakdown: 'طبقہ وار بٹوارہ',
          narration: 'تشریح',
          debit: 'نام',
          credit: 'جمع',
          balance: 'بقایا',
          balanceType: 'قسم',
        }
      : {
          date: 'Date',
          particulars: 'Particulars',
          tierBreakdown: 'Tier breakdown',
          narration: 'Narration',
          debit: 'Debit',
          credit: 'Credit',
          balance: 'Balance',
          balanceType: 'Type',
        };
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
      { key: 'date', header: labels.date, format: 'date', width: 14 },
      {
        key: 'particulars',
        header: labels.particulars,
        format: 'string',
        width: 36,
      },
      {
        key: 'tierBreakdown',
        header: labels.tierBreakdown,
        format: 'string',
        width: 40,
      },
      {
        key: 'narration',
        header: labels.narration,
        format: 'string',
        width: 44,
      },
      { key: 'debit', header: labels.debit, format: 'currency', width: 14 },
      { key: 'credit', header: labels.credit, format: 'currency', width: 14 },
      { key: 'balance', header: labels.balance, format: 'currency', width: 14 },
      {
        key: 'balanceType',
        header: labels.balanceType,
        format: 'string',
        width: 8,
      },
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
  const ledgerSaved = loadSavedFilters(REPORT_FILTER_KEYS.ledger);
  const [familyMode, setFamilyMode] = useState<boolean>(
    ledgerSaved.familyMode ?? false,
  );
  const [language, setLanguage] = useState<'en' | 'ur'>(
    ledgerSaved.language === 'ur' ? 'ur' : 'en',
  );

  const labels =
    language === 'ur'
      ? {
          date: 'تاریخ',
          particulars: 'تفصیل',
          tierBreakdown: 'طبقہ وار بٹوارہ',
          narration: 'تشریح',
          debit: 'نام',
          credit: 'جمع',
          balance: 'بقایا',
          balanceType: 'قسم',
        }
      : {
          date: 'Date',
          particulars: 'Particulars',
          tierBreakdown: 'Tier breakdown',
          narration: 'Narration',
          debit: 'Debit',
          credit: 'Credit',
          balance: 'Balance',
          balanceType: 'Type',
        };
  const ledgerColumnSpecs = [
    { id: 'date', label: labels.date },
    { id: 'particulars', label: labels.particulars },
    ...(familyMode
      ? [{ id: 'tierBreakdown', label: labels.tierBreakdown }]
      : []),
    { id: 'narration', label: labels.narration },
    { id: 'debit', label: labels.debit },
    { id: 'credit', label: labels.credit },
    { id: 'balance', label: labels.balance },
    { id: 'balanceType', label: labels.balanceType },
  ];
  const ledgerColumnIds = ledgerColumnSpecs.map((column) => column.id);
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
  } = useLedgerReport(
    visibleLedgerColumns,
    familyMode,
    setFamilyMode,
    language,
    setLanguage,
  );

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
          language,
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
      language,
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
            title={familyMode ? 'Combined Ledger Report' : 'Ledger Report'}
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
                <ReportFilter label="Language:">
                  <div className="flex rounded-md border">
                    <Button
                      type="button"
                      size="sm"
                      variant={language === 'en' ? 'default' : 'ghost'}
                      className={cn(
                        'rounded-r-none',
                        language === 'en' && 'pointer-events-none',
                      )}
                      onClick={() => setLanguage('en')}
                    >
                      Eng
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={language === 'ur' ? 'default' : 'ghost'}
                      className={cn(
                        'rounded-l-none',
                        language === 'ur' && 'pointer-events-none',
                      )}
                      onClick={() => setLanguage('ur')}
                    >
                      اردو
                    </Button>
                  </div>
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
          language={language}
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
