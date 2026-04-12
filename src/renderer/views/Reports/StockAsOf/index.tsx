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
import { cn } from '@/renderer/lib/utils';
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

  const columns = useMemo<ColumnDef<StockAsOfTableRow, unknown>[]>(
    () => [
      {
        accessorKey: 'item',
        header: 'Item',
        size: 160,
      },
      {
        accessorKey: 'itemType',
        header: 'Type',
        size: 72,
        cell: ({ row }) => row.original.itemType || '—',
      },
      {
        accessorKey: 'unitPrice',
        header: 'Price',
        size: 72,
        headerTooltip: 'Current master price (not historical).',
        cell: ({ row }) => String(row.original.unitPrice ?? 0),
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
          'Starts from current inventory.quantity, then undoes posted purchases, sales, and stock adjustments with timestamps strictly after the end of the selected day. Returned invoices undo the line when returnedAt is after that moment too. Requires current quantity to match posted movements.',
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
    if (!response?.rows.length) return;
    try {
      const exportRows = response.rows.map((r) => ({
        item: r.item,
        itemType: r.itemType ?? '',
        quantityAsOf: r.quantityAsOf,
        currentQuantity: r.currentQuantity,
        quantityDiff: r.currentQuantity - r.quantityAsOf,
        unitPrice: r.unitPrice,
      }));
      const payload: ReportExportPayload<Record<string, unknown>> = {
        title: 'Stock as of date',
        subtitle: `As of ${format(selectedDate, 'PPP')}`,
        sheetName: 'Stock as of',
        columns: [
          { key: 'item', header: 'Item', format: 'string', width: 28 },
          { key: 'itemType', header: 'Type', format: 'string', width: 14 },
          {
            key: 'quantityAsOf',
            header: 'Qty (as of)',
            format: 'number',
            width: 12,
          },
          {
            key: 'currentQuantity',
            header: 'Current',
            format: 'number',
            width: 10,
          },
          {
            key: 'quantityDiff',
            header: 'Delta vs as of',
            format: 'number',
            width: 12,
          },
          { key: 'unitPrice', header: 'Price', format: 'number', width: 10 },
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
        description: 'Exported to Excel.',
        variant: 'success',
      });
    } catch (e) {
      console.error(e);
      toast({
        title: 'Error',
        description: 'Export failed.',
        variant: 'destructive',
      });
    }
  }, [response?.rows, selectedDate]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  return (
    <ReportLayout
      printStyles={printStyles}
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
                title="Export"
                disabled={!response?.rows.length}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrint}
                title="Print"
              >
                <Printer className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground max-w-3xl">
            Quantity as of the selected day is derived by starting from current
            stock and reversing every posted purchase, sale, and adjustment
            dated strictly after the end of that day. Quotations are excluded;
            for returned invoices, the return leg is reversed only if its
            timestamp is after that moment. Current price is from the item
            master, not historical.
          </p>
        </div>
      }
    >
      <div className="hidden print:block print:mb-4 text-center">
        <h2 className="text-lg font-semibold">
          Stock as of {format(selectedDate, 'PPP')}
        </h2>
      </div>

      {isLoading && (
        <Card className="p-6 text-center text-muted-foreground">Loading…</Card>
      )}

      {!isLoading && response && tableRows.length > 0 && (
        <DataTable<StockAsOfTableRow, unknown>
          columns={columns}
          data={tableRows}
          virtual
          compact
          defaultSortField="quantityAsOf"
          defaultSortDirection="desc"
          searchFields={['item', 'itemType']}
          searchPlaceholder="Search items or types…"
          searchPersistenceKey="stock-as-of-search"
        />
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
