import { useCallback, useState } from 'react';
import { format } from 'date-fns';
import { trim } from 'lodash';
import {
  CalendarRange,
  ClipboardList,
  Download,
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
import {
  exportReportToExcel,
  type ReportExportPayload,
} from '@/renderer/lib/reportExport';
import { cn } from '@/renderer/lib/utils';
import { toast } from '@/renderer/shad/ui/use-toast';
import { printStyles } from '../components/printStyles';
import { CollectionSheetTable } from './CollectionSheetTable';
import { printCollectionSheetIframe } from './printCollectionSheet';
import { useCollectionSheet } from './useCollectionSheet';
import { ToursSheet } from './tours/ToursSheet';
import {
  collectionSheetHeaders,
  collectionSheetTotals,
  collectionSheetTourTotals,
  collectionSheetUntouredTotal,
  isUntouredCell,
  tourColumnHeader,
  type CollectionSheetLanguage,
  type CollectionSheetRow,
} from './buildCollectionSheetRows';

type TourExportKey = `tour_${number}`;

type CollectionSheetExportRow = {
  serial: number;
  shop: string;
  address: string;
  code: string;
  balance: number | null;
  collected: number | null;
  collection: string;
  billNumber: string;
  billDate: string;
  difference: string;
  remaining: string;
  untoured?: number | null;
} & {
  // 0 on a shop's first row means it paid nothing that tour
  [key: TourExportKey]: number | null;
};

const tourExportKey = (tourId: number): TourExportKey => `tour_${tourId}`;

interface LanguageToggleProps {
  language: CollectionSheetLanguage;
  onChange: (language: CollectionSheetLanguage) => void;
}

const dateLabel = (range: { from?: Date; to?: Date } | undefined): string => {
  if (!range?.from || !range?.to) return '';
  return `${format(range.from, 'PPP')} - ${format(range.to, 'PPP')}`;
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

  const headers = collectionSheetHeaders(language);
  const period = dateLabel(dateRange);
  const headName =
    language === 'ur'
      ? trim(selectedHead?.nameUrdu ?? '') || selectedHead?.name || ''
      : selectedHead?.name ?? '';
  const subtitle = period;
  const title = headName ? `${headers.title} - ${headName}` : headers.title;

  const canExport = !isLoading && rows.length > 0;

  const handleExport = useCallback(() => {
    if (!canExport || !dateRange?.from || !dateRange?.to) return;
    const totals = collectionSheetTotals(rows);
    const tourTotals = collectionSheetTourTotals(
      rows,
      tours.map((tour) => tour.id),
    );
    const payload: ReportExportPayload<CollectionSheetExportRow> = {
      title,
      subtitle,
      sheetName: 'Collection sheet',
      suggestedFileName: `Collection_Sheet_${(
        selectedHead?.name ?? 'agent'
      ).replace(/\s+/g, '_')}_${format(dateRange.from, 'yyyy-MM-dd')}_${format(
        dateRange.to,
        'yyyy-MM-dd',
      )}.xlsx`,
      columns: [
        { key: 'serial', header: headers.serial, format: 'number', width: 6 },
        { key: 'shop', header: headers.shop, format: 'string', width: 28 },
        {
          key: 'address',
          header: headers.address,
          format: 'string',
          width: 28,
        },
        { key: 'code', header: headers.code, format: 'string', width: 18 },
        {
          key: 'billNumber',
          header: headers.bill,
          format: 'string',
          width: 12,
        },
        {
          key: 'billDate',
          header: headers.billDate,
          format: 'string',
          width: 12,
        },
        {
          key: 'balance',
          header: headers.balance,
          format: 'currency',
          width: 16,
        },
        {
          key: 'collected',
          header: headers.collected,
          format: 'currency',
          width: 14,
        },
        ...tours.map((tour) => ({
          key: tourExportKey(tour.id),
          header: `${headers.tours}: ${tourColumnHeader(tour)}`,
          format: 'currency' as const,
          width: 18,
        })),
        ...(showUntoured
          ? [
              {
                key: 'untoured' as const,
                header: headers.untoured,
                format: 'currency' as const,
                width: 16,
              },
            ]
          : []),
        {
          key: 'collection',
          header: headers.collection,
          format: 'string',
          width: 16,
        },
        {
          key: 'difference',
          header: headers.difference,
          format: 'string',
          width: 16,
        },
        {
          key: 'remaining',
          header: headers.remaining,
          format: 'string',
          width: 16,
        },
      ],
      rows: rows.map((row: CollectionSheetRow) => ({
        serial: row.serial,
        shop: row.shop,
        address: row.addressDisplay,
        code: row.code,
        balance: row.balance,
        collected: row.collected,
        collection: '',
        billNumber: row.billNumber,
        billDate: row.billDate,
        difference: '',
        remaining: '',
        // unlike a tour column, 0 here carries no meaning: leave it blank
        untoured: isUntouredCell(row.untoured) ? row.untoured : null,
        ...Object.fromEntries(
          tours.map((tour) => [
            tourExportKey(tour.id),
            row.tourPaid[tour.id] ?? null,
          ]),
        ),
      })),
      footerRow: {
        shop: headers.total,
        balance: totals.balance,
        collected: totals.collected,
        untoured:
          showUntoured && isUntouredCell(collectionSheetUntouredTotal(rows))
            ? collectionSheetUntouredTotal(rows)
            : null,
        ...Object.fromEntries(
          tours.map((tour) => [tourExportKey(tour.id), tourTotals[tour.id]]),
        ),
      },
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
    subtitle,
    title,
    tours,
    showUntoured,
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
    });
  }, [canExport, language, rows, showUntoured, subtitle, title, tours]);

  return (
    <ReportLayout
      printStyles={printStyles}
      header={
        <div className="print-header flex flex-col gap-2 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="title-new flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              {headers.title}
            </h1>
            <div className="flex flex-wrap items-center gap-3">
              <LanguageToggle language={language} onChange={setLanguage} />
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Agent:</span>
                <Select
                  value={selectedChartId || undefined}
                  onValueChange={handleHeadChange}
                  disabled={!catalogReady}
                >
                  <SelectTrigger className="w-[220px]">
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
              <Button
                variant="outline"
                size="icon"
                onClick={refreshData}
                title="Refresh"
                disabled={isLoading}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleExport}
                title="Export to Excel"
                disabled={!canExport}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrint}
                title="Print"
                disabled={!canExport}
              >
                <Printer className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {subtitle ? (
            <p className="text-sm text-muted-foreground" dir="auto">
              {subtitle}
            </p>
          ) : null}
        </div>
      }
    >
      <CollectionSheetTable
        rows={rows}
        tours={tours}
        showUntoured={showUntoured}
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
    </ReportLayout>
  );
};

export default CollectionSheetPage;
