import { useCallback, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { trim } from 'lodash';
import {
  ArrowUpDown,
  CalendarRange,
  ClipboardList,
  Download,
  HelpCircle,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/shad/ui/select';
import { DateRangePickerWithPresets } from '@/renderer/shad/ui/datePicker';
import { ReportLayout } from '@/renderer/components/ReportLayout';
import { ReportHeader } from '@/renderer/components/ReportHeader';
import { ReportColumnsMenu } from '@/renderer/components/ReportColumnsMenu';
import { useReportColumnVisibility } from '@/renderer/hooks/useReportColumnVisibility';
import {
  exportReportToExcel,
  type ReportExportPayload,
} from '@/renderer/lib/reportExport';
import { cn } from '@/renderer/lib/utils';
import { toast } from '@/renderer/shad/ui/use-toast';
import { formatDisplayDate } from '@/lib/displayDate';
import { printStyles } from '../components/printStyles';
import { CollectionSheetTable } from './CollectionSheetTable';
import { CollectionSheetGuideDialog } from './CollectionSheetGuideDialog';
import { printCollectionSheetIframe } from './printCollectionSheet';
import { useCollectionSheet } from './useCollectionSheet';
import { ToursSheet } from './tours/ToursSheet';
import {
  collectionSheetDiscountText,
  collectionSheetHeaders,
  collectionSheetTotals,
  collectionSheetTourTotals,
  collectionSheetUntouredTotal,
  tourColumnHeader,
  type CollectionSheetLanguage,
  type CollectionSheetRow,
  type CollectionSheetSortBy,
} from './buildCollectionSheetRows';

type TourExportKey = `tour_${number}`;
type TourBalanceExportKey = `tourBal_${number}`;

const SORT_FILENAME_SUFFIX: Record<CollectionSheetSortBy, string> = {
  code: '',
  'outstanding-desc': '_highest_outstanding',
  'unpaid-tours-desc': '_most_unpaid_tours',
  'bills-desc': '_highest_billed',
};

type CollectionSheetExportRow = {
  shop: string;
  city: string;
  code: string;
  balance: number | null;
  collection: string;
  billNumber: string;
  billDate: string;
  billPercentage: string;
  difference: string;
  remaining: string;
  untoured: number | null;
} & {
  // 0 on a shop's first row means it paid nothing that tour
  [key: TourExportKey]: number | null;
} & {
  // running balance at that tour's end, first row only
  [key: TourBalanceExportKey]: number | null;
};

const tourExportKey = (tourId: number): TourExportKey => `tour_${tourId}`;
const tourBalanceExportKey = (tourId: number): TourBalanceExportKey =>
  `tourBal_${tourId}`;

interface LanguageToggleProps {
  language: CollectionSheetLanguage;
  onChange: (language: CollectionSheetLanguage) => void;
}

const dateLabel = (range: { from?: Date; to?: Date } | undefined): string => {
  if (!range?.from || !range?.to) return '';
  return `${formatDisplayDate(range.from)} - ${formatDisplayDate(range.to)}`;
};

const LanguageToggle: React.FC<LanguageToggleProps> = ({
  language,
  onChange,
}: LanguageToggleProps) => (
  <div className="flex rounded-md border">
    <Button
      type="button"
      size="sm"
      variant={language === 'en' ? 'default' : 'ghost'}
      className={cn(
        'rounded-r-none',
        language === 'en' && 'pointer-events-none',
      )}
      onClick={() => onChange('en')}
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
      onClick={() => onChange('ur')}
    >
      اردو
    </Button>
  </div>
);

const CollectionSheetPage: React.FC = () => {
  const {
    charts,
    selectedChartId,
    selectedHead,
    dateRange,
    presetValue,
    language,
    setLanguage,
    sortBy,
    setSortBy,
    rows,
    tours,
    showUntoured,
    range,
    isLoading,
    handleHeadChange,
    handleDateChange,
    refreshData,
    catalogReady,
  } = useCollectionSheet();
  const [toursOpen, setToursOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const headers = collectionSheetHeaders(language);
  const period = dateLabel(dateRange);
  const headName =
    language === 'ur'
      ? trim(selectedHead?.nameUrdu ?? '') || selectedHead?.name || ''
      : selectedHead?.name ?? '';
  const hasClippedTour = tours.some((t) => t.clipped);
  const subtitle = hasClippedTour
    ? `${period} (Tours marked '(part)' reflect receipts within this date range only)`
    : period;
  const title = headName ? `${headers.title} - ${headName}` : headers.title;

  // column choices for export/print/screen, persisted per report
  const collectionSheetColumnSpecs = useMemo(
    () => [
      { id: 'shop', label: headers.shop },
      { id: 'city', label: headers.city },
      { id: 'code', label: headers.code },
      { id: 'billNumber', label: headers.bill },
      { id: 'billDate', label: headers.billDate },
      { id: 'billPercentage', label: headers.billPercentage },
      { id: 'balance', label: headers.balance },
      ...tours.map((tour) => ({
        id: `tour_${tour.id}`,
        label: `${headers.tours}: ${tourColumnHeader(tour)}`,
      })),
      ...(showUntoured ? [{ id: 'untoured', label: headers.untoured }] : []),
      { id: 'collection', label: headers.collection },
      { id: 'difference', label: headers.difference },
      { id: 'remaining', label: headers.remaining },
    ],
    [headers, tours, showUntoured],
  );
  const collectionSheetColumnIds = useMemo(
    () => collectionSheetColumnSpecs.map((column) => column.id),
    [collectionSheetColumnSpecs],
  );
  const columnVisibility = useReportColumnVisibility(
    'collection-sheet',
    collectionSheetColumnIds,
  );
  const visibleColumns = columnVisibility.included;

  const canExport = !isLoading && rows.length > 0;

  const handleExport = useCallback(() => {
    if (!canExport || !dateRange?.from || !dateRange?.to) return;
    const totals = collectionSheetTotals(rows);
    const tourTotals = collectionSheetTourTotals(
      rows,
      tours.map((tour) => tour.id),
    );
    const untouredTotal = collectionSheetUntouredTotal(rows);
    const sortSuffix = SORT_FILENAME_SUFFIX[sortBy] ?? '';
    const totalLabelColumn = (
      ['shop', 'city', 'code', 'billNumber', 'billDate'] as const
    ).find((id) => visibleColumns.has(id));
    const footerRow: Partial<CollectionSheetExportRow> = {
      balance: totals.balance,
      ...Object.fromEntries(
        tours.map((tour) => [tourExportKey(tour.id), tourTotals[tour.id]]),
      ),
      ...(showUntoured ? { untoured: untouredTotal } : {}),
    };
    if (totalLabelColumn) footerRow[totalLabelColumn] = headers.total;
    const payload: ReportExportPayload<CollectionSheetExportRow> = {
      title,
      subtitle,
      sheetName: 'Collection sheet',
      suggestedFileName: `Collection_Sheet_${(
        selectedHead?.name ?? 'agent'
      ).replace(/\s+/g, '_')}_${format(dateRange.from, 'yyyy-MM-dd')}_${format(
        dateRange.to,
        'yyyy-MM-dd',
      )}${sortSuffix}.xlsx`,
      columns: [
        ...(visibleColumns.has('shop')
          ? [
              {
                key: 'shop',
                header: headers.shop,
                format: 'string' as const,
                width: 20,
              },
            ]
          : []),
        ...(visibleColumns.has('city')
          ? [
              {
                key: 'city',
                header: headers.city,
                format: 'string' as const,
                width: 14,
              },
            ]
          : []),
        ...(visibleColumns.has('code')
          ? [
              {
                key: 'code',
                header: headers.code,
                format: 'string' as const,
                width: 20,
              },
            ]
          : []),
        ...(visibleColumns.has('billNumber')
          ? [
              {
                key: 'billNumber',
                header: headers.bill,
                format: 'string' as const,
                width: 12,
              },
            ]
          : []),
        ...(visibleColumns.has('billDate')
          ? [
              {
                key: 'billDate',
                header: headers.billDate,
                format: 'string' as const,
                width: 12,
              },
            ]
          : []),
        ...(visibleColumns.has('billPercentage')
          ? [
              {
                key: 'billPercentage',
                header: headers.billPercentage,
                format: 'string' as const,
                width: 10,
              },
            ]
          : []),
        ...(visibleColumns.has('balance')
          ? [
              {
                key: 'balance',
                header: headers.balance,
                format: 'currency' as const,
                width: 14,
              },
            ]
          : []),
        ...tours.flatMap((tour) =>
          visibleColumns.has(`tour_${tour.id}`)
            ? [
                {
                  key: tourExportKey(tour.id),
                  header: `${headers.tours}: ${tourColumnHeader(tour)}`,
                  format: 'currency' as const,
                  width: 16,
                },
                {
                  key: tourBalanceExportKey(tour.id),
                  header: `${headers.tourBalance}: ${tourColumnHeader(tour)}`,
                  format: 'currency' as const,
                  width: 14,
                },
              ]
            : [],
        ),
        ...(showUntoured && visibleColumns.has('untoured')
          ? [
              {
                key: 'untoured' as const,
                header: headers.untoured,
                format: 'currency' as const,
                width: 14,
              },
            ]
          : []),
        ...(visibleColumns.has('collection')
          ? [
              {
                key: 'collection',
                header: headers.collection,
                format: 'string' as const,
                width: 14,
              },
            ]
          : []),
        ...(visibleColumns.has('difference')
          ? [
              {
                key: 'difference',
                header: headers.difference,
                format: 'string' as const,
                width: 14,
              },
            ]
          : []),
        ...(visibleColumns.has('remaining')
          ? [
              {
                key: 'remaining',
                header: headers.remaining,
                format: 'string' as const,
                width: 14,
              },
            ]
          : []),
      ] as ReportExportPayload<CollectionSheetExportRow>['columns'],
      rows: rows.map((row: CollectionSheetRow) => ({
        shop: row.billIndex === 1 ? row.shop : '//',
        city: row.billIndex === 1 ? row.city : '//',
        code: row.billIndex === 1 ? row.code : '//',
        balance: row.balance,
        collection: '',
        billNumber: row.billNumber,
        billDate: row.billDate,
        billPercentage: collectionSheetDiscountText(row.discountPortions),
        difference: '',
        remaining: '',
        untoured: showUntoured ? row.untoured : null,
        ...Object.fromEntries(
          tours.flatMap((tour) => [
            [tourExportKey(tour.id), row.tourPaid[tour.id] ?? null],
            [tourBalanceExportKey(tour.id), row.tourBalance[tour.id] ?? null],
          ]),
        ),
      })),
      footerRow,
    };
    try {
      exportReportToExcel(payload);
    } catch (error) {
      console.error('Error exporting collection sheet:', error);
      toast({
        title: 'Export failed',
        description: 'Could not write the collection sheet workbook.',
        variant: 'destructive',
      });
    }
  }, [
    canExport,
    dateRange,
    headers,
    rows,
    selectedHead?.name,
    showUntoured,
    sortBy,
    subtitle,
    title,
    tours,
    visibleColumns,
  ]);

  const handlePrint = useCallback(() => {
    if (!canExport) return;
    printCollectionSheetIframe({
      rows,
      tours,
      showUntoured,
      title,
      subtitle,
      language,
      visibleColumns,
    });
  }, [
    canExport,
    language,
    rows,
    showUntoured,
    subtitle,
    title,
    tours,
    visibleColumns,
  ]);

  return (
    <ReportLayout
      printStyles={printStyles}
      bodyClassName="overflow-hidden h-full flex flex-col print:p-0 print:overflow-visible"
      header={
        <ReportHeader
          title={
            <span className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              {headers.title}
            </span>
          }
          badge={
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              title="How to read this report"
              aria-label="How to read this report"
              onClick={() => setGuideOpen(true)}
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          }
          filters={
            <div className="flex flex-wrap items-center gap-3">
              <LanguageToggle language={language} onChange={setLanguage} />
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Agent:</span>
                <Select
                  value={selectedChartId || undefined}
                  onValueChange={handleHeadChange}
                  disabled={!catalogReady}
                >
                  <SelectTrigger className="w-full sm:w-[220px]">
                    <SelectValue placeholder="Select an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {charts.map((chart) => (
                      <SelectItem key={chart.id} value={String(chart.id)}>
                        {chart.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setToursOpen(true)}
                  disabled={!selectedHead}
                  title="Agent tours"
                >
                  <CalendarRange className="mr-1 h-4 w-4" />
                  Tours
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Range:</span>
                <DateRangePickerWithPresets
                  $onSelect={handleDateChange}
                  presets={[
                    { label: 'This month', value: 'current-month' },
                    { label: 'This year', value: 'current-year' },
                    { label: 'All', value: 'all' },
                  ]}
                  initialRange={dateRange}
                  initialSelectValue={presetValue}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Sort:</span>
                <Select
                  value={sortBy}
                  onValueChange={(val) =>
                    setSortBy(val as CollectionSheetSortBy)
                  }
                >
                  <SelectTrigger className="w-[170px]">
                    <ArrowUpDown className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="code">Code</SelectItem>
                    <SelectItem value="outstanding-desc">
                      Highest Outstanding
                    </SelectItem>
                    <SelectItem value="unpaid-tours-desc">
                      Most Unpaid Tours
                    </SelectItem>
                    <SelectItem value="bills-desc">Highest Billed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          }
          actions={
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={refreshData}
                title="Refresh"
                aria-label="Refresh"
                disabled={isLoading}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleExport}
                title="Export to Excel"
                aria-label="Export to Excel"
                disabled={!canExport}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrint}
                title="Print"
                aria-label="Print"
                disabled={!canExport}
              >
                <Printer className="h-4 w-4" />
              </Button>
              <ReportColumnsMenu
                columns={collectionSheetColumnSpecs}
                included={columnVisibility.included}
                onToggle={columnVisibility.toggle}
                onToggleAll={columnVisibility.toggleAll}
              />
            </>
          }
          summary={
            subtitle ? (
              <p className="text-sm text-muted-foreground" dir="auto">
                {subtitle}
              </p>
            ) : null
          }
        />
      }
    >
      <CollectionSheetTable
        rows={rows}
        tours={tours}
        showUntoured={showUntoured}
        visibleColumns={visibleColumns}
        isLoading={isLoading}
        hasAgent={selectedChartId.length > 0}
        language={language}
      />
      {selectedHead ? (
        <ToursSheet
          head={selectedHead}
          range={range}
          open={toursOpen}
          onOpenChange={setToursOpen}
          onToursChanged={refreshData}
        />
      ) : null}
      <CollectionSheetGuideDialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        language={language}
      />
    </ReportLayout>
  );
};

export default CollectionSheetPage;
