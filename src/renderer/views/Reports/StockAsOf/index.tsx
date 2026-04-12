import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  Calendar as CalendarIcon,
  Download,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Card } from '@/renderer/shad/ui/card';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Label } from '@/renderer/shad/ui/label';
import { Calendar } from '@/renderer/shad/ui/calendar';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/renderer/shad/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/shad/ui/select';
import { cn, createListPositionSortingFn } from '@/renderer/lib/utils';
import {
  exportReportToExcel,
  type ReportExportPayload,
} from '@/renderer/lib/reportExport';
import {
  loadSavedFilters,
  saveSavedFilters,
  makeSavedState,
} from '@/renderer/lib/reportFilters';
import { toast } from '@/renderer/shad/ui/use-toast';
import { ReportLayout } from '@/renderer/components/ReportLayout';
import { DataTable, type ColumnDef } from '@/renderer/shad/ui/dataTable';
import { REPORT_FILTER_KEYS } from 'types';
import type { StockAsOfReportResponse, StockAsOfRow } from 'types';
import { printStyles } from '../components/printStyles';
import { printStockAsOfReportIframe } from './printStockAsOfReport';
import { stockAsOfPrintStyles } from './stockAsOfPrintStyles';

type StockAsOfTableRow = StockAsOfRow & {
  quantityDiff: number;
};

const StockAsOfReportPage: React.FC = () => {
  const saved = useMemo(
    () => loadSavedFilters(REPORT_FILTER_KEYS.stockAsOf),
    [],
  );

  const defaultDate = useMemo(() => {
    if (saved.dateRange?.from) {
      return new Date(saved.dateRange.from);
    }
    return new Date();
  }, [saved.dateRange?.from]);

  const [selectedDate, setSelectedDate] = useState<Date>(defaultDate);
  const [filterItemType, setFilterItemType] = useState<string>('all');
  const [itemTypes, setItemTypes] = useState<
    Array<{ id: number; name: string }>
  >([]);
  const [response, setResponse] = useState<StockAsOfReportResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [hideZeroQuantity, setHideZeroQuantity] = useState(true);
  const [hideZeroPrice, setHideZeroPrice] = useState(true);
  const [hideNegativeQuantity, setHideNegativeQuantity] = useState(true);
  const [hideNoType, setHideNoType] = useState(true);
  /** rows after grid search + sort; null until DataTable syncs (export/print parity) */
  const [gridViewRows, setGridViewRows] = useState<StockAsOfTableRow[] | null>(
    null,
  );

  const fetchItemTypes = useCallback(async () => {
    try {
      const types = await window.electron.getItemTypes();
      setItemTypes(types);
    } catch (e) {
      console.error('Error fetching item types:', e);
    }
  }, []);

  useEffect(() => {
    fetchItemTypes();
  }, [fetchItemTypes]);

  const persistAndFetch = useCallback(
    (date: Date, itemType: string, typeList: typeof itemTypes) => {
      const ids =
        itemType !== 'all'
          ? typeList.filter((t) => t.name === itemType).map((t) => t.id)
          : [];
      saveSavedFilters(
        REPORT_FILTER_KEYS.stockAsOf,
        makeSavedState(
          { from: date, to: date },
          undefined,
          ids.length > 0 ? { itemTypeIds: ids } : {},
        ),
      );
    },
    [],
  );

  const fetchReport = useCallback(async () => {
    const asOfDate = format(selectedDate, 'yyyy-MM-dd');
    const selectedIds =
      filterItemType !== 'all'
        ? itemTypes.filter((t) => t.name === filterItemType).map((t) => t.id)
        : [];
    setIsLoading(true);
    try {
      const data = await window.electron.reportGetStockAsOf({
        asOfDate,
        ...(selectedIds.length > 0 ? { itemTypeIds: selectedIds } : {}),
      });
      setResponse(data);
    } catch (e) {
      console.error('Stock as-of report failed:', e);
      toast({
        title: 'Error',
        description: 'Failed to load stock as-of report.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [filterItemType, itemTypes, selectedDate]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleDateChange = useCallback((date?: Date) => {
    if (!date) return;
    setSelectedDate(date);
  }, []);

  const handleItemTypeChange = useCallback((value: string) => {
    setFilterItemType(value);
  }, []);

  useEffect(() => {
    persistAndFetch(selectedDate, filterItemType, itemTypes);
  }, [filterItemType, itemTypes, persistAndFetch, selectedDate]);

  const tableRows: StockAsOfTableRow[] = useMemo(() => {
    if (!response?.rows.length) return [];
    return response.rows.map((r) => ({
      ...r,
      quantityDiff: r.currentQuantity - r.quantityAsOf,
    }));
  }, [response?.rows]);

  const filteredTableData = useMemo(() => {
    if (!tableRows.length) return undefined;
    return tableRows.filter((r) => {
      if (hideNegativeQuantity && r.currentQuantity < 0) return false;
      if (hideZeroQuantity && r.currentQuantity === 0) return false;
      if (hideZeroPrice && (r.unitPrice ?? 0) === 0) return false;
      if (hideNoType && (r.itemTypeId == null || r.itemTypeId === 0))
        return false;
      return true;
    });
  }, [
    tableRows,
    hideNegativeQuantity,
    hideZeroQuantity,
    hideZeroPrice,
    hideNoType,
  ]);

  useEffect(() => {
    setGridViewRows(null);
  }, [response]);

  useEffect(() => {
    if (filteredTableData == null) {
      setGridViewRows(null);
      return;
    }
    if (filteredTableData.length === 0) {
      setGridViewRows([]);
    }
  }, [filteredTableData]);

  const handleTableViewModelChange = useCallback(
    (next: StockAsOfTableRow[]) => {
      setGridViewRows((prev) => {
        if (
          prev &&
          prev.length === next.length &&
          next.every((r, i) => r.itemId === prev[i]?.itemId)
        ) {
          return prev;
        }
        return next;
      });
    },
    [],
  );

  const exportPrintRows = useMemo(
    () => gridViewRows ?? filteredTableData ?? [],
    [gridViewRows, filteredTableData],
  );

  const reportSubtitle = useMemo(() => {
    const asOf = format(selectedDate, 'PPP');
    if (filterItemType === 'all') return asOf;
    return `${asOf} — Type: ${filterItemType}`;
  }, [filterItemType, selectedDate]);

  const columns = useMemo<ColumnDef<StockAsOfTableRow, unknown>[]>(
    () => [
      {
        accessorKey: 'listPosition',
        header: 'List #',
        size: 24,
        sortingFn: createListPositionSortingFn<StockAsOfTableRow>(
          (r) => r.itemId,
        ),
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.listPosition != null
              ? String(row.original.listPosition)
              : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'item',
        header: 'Item',
        size: 160,
      },
      {
        accessorKey: 'itemType',
        header: 'Type',
        size: 72,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.itemType || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'unitPrice',
        header: 'Price',
        size: 72,
        headerTooltip: 'Current price (not historical).',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {String(row.original.unitPrice ?? 0)}
          </span>
        ),
      },
      {
        accessorKey: 'currentQuantity',
        header: 'Current',
        size: 80,
        headerTooltip: 'Live quantity in inventory (today).',
        cell: ({ row }) => String(row.original.currentQuantity),
      },
      {
        accessorKey: 'quantityAsOf',
        header: 'Qty (as of)',
        size: 96,
        headerTooltip:
          'On-hand at the end of your selected day (backward from today using posted activity). See "How the numbers are built" in the header.',
        cell: ({ row }) => String(row.original.quantityAsOf),
      },
      {
        accessorKey: 'quantityDiff',
        header: 'Δ vs as of',
        size: 88,
        headerTooltip: 'Current minus as-of quantity.',
        cell: ({ row }) => String(row.original.quantityDiff),
      },
    ],
    [],
  );

  const handleExport = useCallback(() => {
    if (!exportPrintRows.length) return;
    try {
      const exportRows = exportPrintRows.map((r) => ({
        listPosition: r.listPosition == null ? '' : String(r.listPosition),
        item: r.item,
        itemType: r.itemType ?? '',
        unitPrice: r.unitPrice ?? 0,
        currentQuantity: r.currentQuantity,
        quantityAsOf: r.quantityAsOf,
        quantityDiff: r.quantityDiff,
      }));
      const payload: ReportExportPayload<Record<string, unknown>> = {
        title: 'Stock as of date',
        subtitle: `As of ${reportSubtitle}`,
        sheetName: 'Stock as of',
        columns: [
          { key: 'listPosition', header: 'List #', format: 'string', width: 8 },
          { key: 'item', header: 'Item', format: 'string', width: 28 },
          { key: 'itemType', header: 'Type', format: 'string', width: 14 },
          { key: 'unitPrice', header: 'Price', format: 'number', width: 10 },
          {
            key: 'currentQuantity',
            header: 'Current',
            format: 'number',
            width: 10,
          },
          {
            key: 'quantityAsOf',
            header: 'Qty (as of)',
            format: 'number',
            width: 12,
          },
          {
            key: 'quantityDiff',
            header: 'Delta vs as of',
            format: 'number',
            width: 12,
          },
        ],
        rows: exportRows,
        suggestedFileName: `Stock_As_Of_${format(
          selectedDate,
          'yyyy-MM-dd',
        )}.xlsx`,
      };
      exportReportToExcel(payload);
      toast({
        title: 'Success',
        description: 'Stock as of exported to Excel.',
        variant: 'success',
      });
    } catch (e) {
      console.error(e);
      toast({
        title: 'Error',
        description: 'Failed to export stock as of to Excel.',
        variant: 'destructive',
      });
    }
  }, [exportPrintRows, reportSubtitle, selectedDate]);

  const handlePrint = useCallback(() => {
    if (!exportPrintRows.length) return;
    printStockAsOfReportIframe({
      rows: exportPrintRows.map((r) => ({
        listPosition: r.listPosition,
        item: r.item,
        itemType: r.itemType,
        unitPrice: r.unitPrice ?? 0,
        currentQuantity: r.currentQuantity,
        quantityAsOf: r.quantityAsOf,
        quantityDiff: r.quantityDiff,
      })),
      subtitle: reportSubtitle,
    });
  }, [exportPrintRows, reportSubtitle]);

  return (
    <ReportLayout
      printStyles={`${printStyles}${stockAsOfPrintStyles}`}
      header={
        <div className="flex flex-col gap-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="title-new">Stock as of date</h1>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground shrink-0">
                  As of:
                </span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-[200px] justify-start text-left font-normal',
                        isLoading && 'opacity-70',
                      )}
                      disabled={isLoading}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                      {format(selectedDate, 'PPP')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={handleDateChange}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <Select
                value={filterItemType}
                onValueChange={handleItemTypeChange}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {itemTypes.map((t) => (
                    <SelectItem key={t.id} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={fetchReport}
                title="Refresh"
                disabled={isLoading}
              >
                <RefreshCw
                  className={cn('h-4 w-4', isLoading && 'animate-spin')}
                />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleExport}
                title="Export to Excel"
                disabled={!exportPrintRows.length}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrint}
                title="Print stock as of (PDF)"
                disabled={!exportPrintRows.length}
              >
                <Printer className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="max-w-3xl space-y-2">
            <p className="text-sm text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">
                What this report shows:{' '}
              </span>
              For each item, on-hand quantity at the end of the day you pick.
              The figure starts from{' '}
              <span className="font-medium text-foreground">today&apos;s</span>{' '}
              recorded stock, then steps backward through posted sales,
              purchases, and stock adjustments.
            </p>
            <details className="group text-xs text-muted-foreground [&_summary::-webkit-details-marker]:hidden">
              <summary className="cursor-pointer list-none font-medium text-foreground underline-offset-2 hover:underline">
                How the numbers are built
              </summary>
              <ul className="mt-2 ml-4 list-disc space-y-1.5 leading-relaxed">
                <li>
                  Posted sales, purchases, and stock changes that fall after the
                  end of the day you picked are backed out of today&apos;s
                  quantity.
                </li>
                <li>Quotations are not counted.</li>
                <li>
                  For returned invoices, the return date/time matters as well as
                  the original invoice date.
                </li>
                <li>
                  The price column is each item&apos;s current sale price, not
                  historical price.
                </li>
              </ul>
            </details>
          </div>
        </div>
      }
    >
      {isLoading && (
        <Card className="p-6 text-center text-muted-foreground">Loading…</Card>
      )}

      {!isLoading && tableRows.length > 0 && (
        <div className="print:hidden flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-muted/30 px-4 py-3 mb-3">
          <span className="text-sm font-medium text-muted-foreground">
            Hide items:
          </span>
          <Label
            htmlFor="sa-filter-hide-all"
            className="flex cursor-pointer items-center gap-2 text-sm font-normal"
          >
            <Checkbox
              id="sa-filter-hide-all"
              checked={
                hideNegativeQuantity &&
                hideZeroQuantity &&
                hideZeroPrice &&
                hideNoType
              }
              onCheckedChange={(checked) => {
                const value = checked === true;
                setHideNegativeQuantity(value);
                setHideZeroQuantity(value);
                setHideZeroPrice(value);
                setHideNoType(value);
              }}
            />
            <span>All</span>
          </Label>
          <Label
            htmlFor="sa-filter-hide-negative-qty"
            className="flex cursor-pointer items-center gap-2 text-sm font-normal"
          >
            <Checkbox
              id="sa-filter-hide-negative-qty"
              checked={hideNegativeQuantity}
              onCheckedChange={(checked) =>
                setHideNegativeQuantity(checked === true)
              }
            />
            <span>Negative quantity</span>
          </Label>
          <Label
            htmlFor="sa-filter-hide-zero-qty"
            className="flex cursor-pointer items-center gap-2 text-sm font-normal"
          >
            <Checkbox
              id="sa-filter-hide-zero-qty"
              checked={hideZeroQuantity}
              onCheckedChange={(checked) =>
                setHideZeroQuantity(checked === true)
              }
            />
            <span>Zero quantity</span>
          </Label>
          <Label
            htmlFor="sa-filter-hide-zero-price"
            className="flex cursor-pointer items-center gap-2 text-sm font-normal"
          >
            <Checkbox
              id="sa-filter-hide-zero-price"
              checked={hideZeroPrice}
              onCheckedChange={(checked) => setHideZeroPrice(checked === true)}
            />
            <span>Zero price</span>
          </Label>
          <Label
            htmlFor="sa-filter-hide-no-type"
            className="flex cursor-pointer items-center gap-2 text-sm font-normal"
          >
            <Checkbox
              id="sa-filter-hide-no-type"
              checked={hideNoType}
              onCheckedChange={(checked) => setHideNoType(checked === true)}
            />
            <span>No type</span>
          </Label>
        </div>
      )}

      {!isLoading && filteredTableData && filteredTableData.length > 0 && (
        <DataTable<StockAsOfTableRow, unknown>
          columns={columns}
          data={filteredTableData}
          virtual
          compact
          defaultSortField="listPosition"
          defaultSortDirection="asc"
          searchFields={['listPosition', 'item', 'itemType']}
          searchPlaceholder="Search list #, items, types…"
          searchPersistenceKey="stock-as-of-search"
          onViewModelChange={handleTableViewModelChange}
        />
      )}

      {!isLoading &&
        tableRows.length > 0 &&
        filteredTableData &&
        filteredTableData.length === 0 && (
          <Card className="p-6 text-center text-muted-foreground">
            No rows match your hide filters. Uncheck some options above.
          </Card>
        )}

      {!isLoading && response && tableRows.length === 0 && (
        <Card className="p-6 text-center text-muted-foreground">
          No inventory items match the filters.
        </Card>
      )}
    </ReportLayout>
  );
};

export default StockAsOfReportPage;
