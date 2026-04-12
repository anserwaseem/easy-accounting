import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { format, subDays } from 'date-fns';
import {
  Download,
  Info,
  Printer,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Card } from '@/renderer/shad/ui/card';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Label } from '@/renderer/shad/ui/label';
import { ReportLayout } from '@/renderer/components/ReportLayout';
import {
  DateRangePickerWithPresets,
  type DateRange,
} from '@/renderer/shad/ui/datePicker';
import { type ReportResponse, REPORT_FILTER_KEYS } from 'types';
import {
  loadSavedFilters,
  saveSavedFilters,
  makeSavedState,
  LAST_30_DAYS_PRESETS,
  LAST_30_DAYS_PRESET,
} from '@/renderer/lib/reportFilters';
import {
  exportReportToExcel,
  type ReportExportPayload,
} from '@/renderer/lib/reportExport';
import { toast } from '@/renderer/shad/ui/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/shad/ui/select';
import { Badge, badgeVariants } from '@/renderer/shad/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/renderer/shad/ui/tooltip';
import { DataTable, type ColumnDef } from '@/renderer/shad/ui/dataTable';
import { cn } from '@/renderer/lib/utils';
import { printStyles } from '../components/printStyles';
import { inventoryHealthPrintStyles } from './inventoryHealthPrintStyles';
import { printInventoryHealthReportIframe } from './printInventoryHealthReport';

interface InventoryHealthRow {
  itemId: number;
  itemTypeId: number | null;
  item: string;
  itemType: string | null;
  price: number;
  onHandQty: number;
  soldQtyInDate: number;
  purchasedQtyInDate: number;
  adjustmentQtyInDate: number;
  lastSaleDate: string | null;
  lastPurchaseDate: string | null;
  daysSinceMovement: number | null;
  daysOfCover: number | null;
  flags: string;
}

// maps API flag strings (hyphenated) and anomaly `type` keys to badge display
const HEALTH_ISSUE_LABELS: Record<
  string,
  {
    label: string;
    variant: 'destructive' | 'amber' | 'secondary' | 'default' | 'outline';
  }
> = {
  'dead-stock': { label: 'Dead Stock', variant: 'default' },
  'negative-stock': { label: 'Negative Stock', variant: 'destructive' },
  'zero-stock': { label: 'Out of Stock', variant: 'outline' },
  'low-coverage': { label: 'Low Coverage', variant: 'amber' },
  'critical-coverage': { label: 'Critical Coverage', variant: 'destructive' },
  'no-type': { label: 'No type', variant: 'secondary' },
  'zero-price': { label: 'No Price', variant: 'secondary' },
};

// longer help for anomaly chips only (small info icon + tooltip)
const HEALTH_ISSUE_TOOLTIPS: Record<string, string> = {
  'dead-stock':
    'You still have quantity on hand, but this SKU had no sale, purchase, or stock adjustment in the selected date range, or its last movement was at least 90 days ago. Usually worth reviewing as slow-moving or stale stock.',
  'low-coverage':
    'Days of cover (on-hand quantity divided by average daily sales in the selected range) is below 14. Plan replenishment so you do not run out if sales continue at this pace.',
  'critical-coverage':
    'Days of cover is below 7 at the sales rate in the selected range. High risk of stocking out soon unless you restock or demand drops.',
};

const rowHasIssueFlag = (flags: string, flag: string): boolean =>
  String(flags ?? '')
    .split(', ')
    .map((t) => t.trim())
    .filter(Boolean)
    .includes(flag);

const InventoryHealthPage: React.FC = () => {
  const saved = useMemo(
    () => loadSavedFilters(REPORT_FILTER_KEYS.inventoryHealth),
    [],
  );

  const defaultDateRange: DateRange = useMemo(() => {
    if (saved.dateRange?.from && saved.dateRange?.to) {
      return {
        from: new Date(saved.dateRange.from),
        to: new Date(saved.dateRange.to),
      };
    }
    return { from: subDays(new Date(), 30), to: new Date() };
  }, [saved.dateRange]);

  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    defaultDateRange,
  );
  const [presetValue, setPresetValue] = useState<string>(
    saved.presetValue ?? LAST_30_DAYS_PRESET,
  );
  const [response, setResponse] = useState<ReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [filterItemType, setFilterItemType] = useState<string>('all');
  const [itemTypes, setItemTypes] = useState<
    Array<{ id: number; name: string }>
  >([]);
  const [hideZeroQuantity, setHideZeroQuantity] = useState(false);
  const [hideZeroPrice, setHideZeroPrice] = useState(false);
  const [hideNegativeQuantity, setHideNegativeQuantity] = useState(false);
  const [hideNoType, setHideNoType] = useState(false);
  /** click anomaly chip → table shows only rows with that flag; stacks with hide checkboxes */
  const [issueChipFilter, setIssueChipFilter] = useState<string | null>(null);
  /** rows as shown in grid (hide + chip + search + column sort); null until table syncs */
  const [gridViewRows, setGridViewRows] = useState<InventoryHealthRow[] | null>(
    null,
  );
  const filterRef = useRef(0);

  const handleGridViewModelChange = useCallback(
    (rows: InventoryHealthRow[]) => setGridViewRows(rows),
    [],
  );

  const fetchItemTypes = useCallback(async () => {
    try {
      const types = await window.electron.getItemTypes();
      setItemTypes(types);
    } catch (error) {
      console.error('Error fetching item types:', error);
    }
  }, []);

  useEffect(() => {
    fetchItemTypes();
  }, [fetchItemTypes]);

  useEffect(() => {
    setIssueChipFilter(null);
  }, [response]);

  const fetchData = useCallback(
    async (range: DateRange, itemType?: string, ids?: number[]) => {
      if (!range.from || !range.to) return;
      setIsLoading(true);
      filterRef.current += 1;
      const thisFilter = filterRef.current;

      const startDate = range.from.toISOString().split('T')[0];
      const endDate = range.to.toISOString().split('T')[0];

      const getSelectedIds = () => {
        if (ids) return ids;
        if (itemType !== 'all') {
          const matchedType = itemTypes.find((t) => t.name === itemType);
          return matchedType?.id ? [matchedType.id] : [];
        }
        return [];
      };

      const selectedIds = getSelectedIds();

      try {
        const resp = await window.electron.reportGetInventoryHealth({
          startDate,
          endDate,
          ...(selectedIds.length > 0 ? { itemTypeIds: selectedIds } : {}),
        });
        if (thisFilter === filterRef.current) {
          let { rows } = resp;
          if (selectedIds.length > 0) {
            rows = rows.filter((r) => {
              const rowTypeId = (r as Record<string, unknown>).itemTypeId;
              return selectedIds.includes(rowTypeId as number);
            });
          }
          setResponse({ ...resp, rows, exportRows: rows });
        }
      } catch (error) {
        console.error('Error fetching inventory health:', error);
      } finally {
        if (thisFilter === filterRef.current) setIsLoading(false);
      }
    },
    [itemTypes],
  );

  const handleDateChange = useCallback(
    (range?: DateRange, selectValue?: string) => {
      if (!range) return;
      setDateRange(range);
      if (selectValue) setPresetValue(selectValue);
      saveSavedFilters(
        REPORT_FILTER_KEYS.inventoryHealth,
        makeSavedState(range, undefined, {
          itemTypeIds:
            filterItemType !== 'all'
              ? itemTypes
                  .filter((t) => t.name === filterItemType)
                  .map((t) => t.id)
              : [],
          presetValue: selectValue ?? presetValue,
        }),
      );
      fetchData(range, filterItemType);
    },
    [filterItemType, itemTypes, fetchData, presetValue],
  );

  useEffect(() => {
    if (dateRange) {
      fetchData(dateRange, filterItemType);
    }
  }, [dateRange, fetchData, filterItemType]);

  const handleItemTypeChange = useCallback(
    (value: string) => {
      setFilterItemType(value);
      if (dateRange) fetchData(dateRange, value);
    },
    [dateRange, fetchData],
  );

  const refreshData = useCallback(() => {
    fetchItemTypes();
    if (dateRange) fetchData(dateRange, filterItemType);
  }, [dateRange, fetchData, fetchItemTypes, filterItemType]);

  const tableData = useMemo(
    () => response?.rows as unknown as InventoryHealthRow[] | undefined,
    [response?.rows],
  );

  const afterHideFilters = useMemo(() => {
    if (!tableData) return undefined;
    return tableData.filter((r) => {
      if (hideNegativeQuantity && r.onHandQty < 0) return false;
      if (hideZeroQuantity && r.onHandQty === 0) return false;
      if (hideZeroPrice && (r.price ?? 0) === 0) return false;
      if (hideNoType && (r.itemTypeId == null || r.itemTypeId === 0))
        return false;
      return true;
    });
  }, [
    tableData,
    hideNegativeQuantity,
    hideZeroQuantity,
    hideZeroPrice,
    hideNoType,
  ]);

  const filteredTableData = useMemo(() => {
    if (!afterHideFilters) return undefined;
    if (!issueChipFilter) return afterHideFilters;
    return afterHideFilters.filter((r) =>
      rowHasIssueFlag(r.flags, issueChipFilter),
    );
  }, [afterHideFilters, issueChipFilter]);

  useEffect(() => {
    if (filteredTableData == null) {
      setGridViewRows(null);
      return;
    }
    if (filteredTableData.length === 0) {
      setGridViewRows([]);
    }
  }, [filteredTableData]);

  const exportPrintRows = useMemo(
    () => gridViewRows ?? filteredTableData ?? [],
    [gridViewRows, filteredTableData],
  );

  const showAdjustedColumn = useMemo(
    () =>
      Boolean(tableData?.some((r) => Math.abs(r.adjustmentQtyInDate ?? 0) > 0)),
    [tableData],
  );

  const handlePrint = useCallback(() => {
    if (!exportPrintRows.length || !dateRange?.from || !dateRange?.to) return;
    printInventoryHealthReportIframe({
      rows: exportPrintRows,
      dateSubtitle: `${format(dateRange.from, 'PP')} – ${format(
        dateRange.to,
        'PP',
      )}`,
      showAdjustedColumn,
    });
  }, [exportPrintRows, dateRange, showAdjustedColumn]);

  const handleExport = useCallback(() => {
    if (!response || !exportPrintRows.length) return;
    try {
      const exportCols: ReportExportPayload['columns'] = [
        { key: 'item', header: 'Item', format: 'string' as const, width: 24 },
        {
          key: 'itemType',
          header: 'Type',
          format: 'string' as const,
          width: 14,
        },
        { key: 'price', header: 'Price', format: 'number' as const, width: 10 },
        {
          key: 'onHandQty',
          header: 'On Hand',
          format: 'number' as const,
          width: 10,
        },
        {
          key: 'soldQtyInDate',
          header: 'Sold',
          format: 'number' as const,
          width: 10,
        },
        {
          key: 'purchasedQtyInDate',
          header: 'Purchased',
          format: 'number' as const,
          width: 10,
        },
      ];
      if (showAdjustedColumn) {
        exportCols.push({
          key: 'adjustmentQtyInDate',
          header: 'Adjusted',
          format: 'number' as const,
          width: 10,
        });
      }
      exportCols.push(
        {
          key: 'lastSaleDate',
          header: 'Last Sale',
          format: 'date' as const,
          width: 12,
        },
        {
          key: 'lastPurchaseDate',
          header: 'Last Purchase',
          format: 'date' as const,
          width: 14,
        },
        {
          key: 'daysSinceMovement',
          header: 'Days Since Movement',
          format: 'number' as const,
          width: 12,
        },
        {
          key: 'daysOfCover',
          header: 'Days of Cover',
          format: 'number' as const,
          width: 12,
        },
        {
          key: 'flags',
          header: 'Flags',
          format: 'string' as const,
          width: 20,
        },
      );

      const payload: ReportExportPayload = {
        title: 'Inventory Health Report',
        subtitle:
          dateRange?.from && dateRange?.to
            ? `${format(dateRange.from, 'PPP')} - ${format(
                dateRange.to,
                'PPP',
              )}`
            : '',
        sheetName: 'Inventory Health',
        columns: exportCols,
        rows: exportPrintRows as unknown as Record<string, unknown>[],
        suggestedFileName: `Inventory_Health_${format(
          new Date(),
          'yyyy-MM-dd',
        )}.xlsx`,
      };
      exportReportToExcel(payload);
      toast({
        title: 'Success',
        description: 'Exported to Excel.',
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to export.',
        variant: 'destructive',
      });
    }
  }, [response, dateRange, exportPrintRows, showAdjustedColumn]);

  const columns = useMemo<ColumnDef<InventoryHealthRow, unknown>[]>(() => {
    const base: ColumnDef<InventoryHealthRow, unknown>[] = [
      {
        accessorKey: 'item',
        header: 'Item',
        size: 120,
      },
      {
        accessorKey: 'itemType',
        header: 'Type',
        size: 40,
        cell: ({ row }) => row.original.itemType || '—',
      },
      {
        accessorKey: 'price',
        header: 'Price',
        size: 72,
        cell: ({ row }) => String(row.original.price ?? 0),
      },
      {
        accessorKey: 'onHandQty',
        header: 'On Hand',
        size: 76,
        cell: ({ row }) => String(row.original.onHandQty ?? 0),
      },
      {
        accessorKey: 'soldQtyInDate',
        header: 'Sold',
        size: 60,
        cell: ({ row }) => String(row.original.soldQtyInDate ?? 0),
      },
      {
        accessorKey: 'purchasedQtyInDate',
        header: 'Purchased',
        size: 70,
        cell: ({ row }) => String(row.original.purchasedQtyInDate ?? 0),
      },
    ];
    if (showAdjustedColumn) {
      base.push({
        accessorKey: 'adjustmentQtyInDate',
        header: 'Adjusted',
        size: 70,
        cell: ({ row }) => String(row.original.adjustmentQtyInDate ?? 0),
      });
    }
    base.push(
      {
        accessorKey: 'lastSaleDate',
        header: 'Last Sale',
        size: 100,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => {
          const v = row.original.lastSaleDate;
          return (
            <span className="text-xs text-muted-foreground">
              {v ? format(new Date(v), 'PP') : '—'}
            </span>
          );
        },
      },
      {
        accessorKey: 'lastPurchaseDate',
        header: 'Last Purchase',
        size: 110,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => {
          const v = row.original.lastPurchaseDate;
          return (
            <span className="text-xs text-muted-foreground">
              {v ? format(new Date(v), 'PP') : '—'}
            </span>
          );
        },
      },
      {
        accessorKey: 'daysSinceMovement',
        header: 'Days Movement',
        size: 90,
        headerTooltip:
          'Days since last stock movement (sale, purchase, or adjustment). ≥90 days is considered dead stock.',
        cell: ({ row }) =>
          row.original.daysSinceMovement != null
            ? String(row.original.daysSinceMovement)
            : '—',
      },
      {
        accessorKey: 'daysOfCover',
        header: 'Days Cover',
        size: 80,
        headerTooltip:
          'Estimated days current stock will last at the average sales rate. <14 = low coverage, <7 = critical.',
        cell: ({ row }) =>
          row.original.daysOfCover != null
            ? String(row.original.daysOfCover)
            : '—',
      },
      {
        accessorKey: 'flags',
        header: 'Issues',
        size: 160,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => {
          const v = row.original.flags;
          if (!v)
            return <span className="text-muted-foreground text-xs">None</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {v.split(', ').map((f: string) => {
                const config = HEALTH_ISSUE_LABELS[f] || {
                  label: f,
                  variant: 'default' as const,
                };
                return (
                  <Badge
                    key={f}
                    variant={config.variant}
                    className="text-[10px] py-0.5 px-1.5 font-medium"
                  >
                    {config.label}
                  </Badge>
                );
              })}
            </div>
          );
        },
      },
    );
    return base;
  }, [showAdjustedColumn]);

  const visibleAnomalies = useMemo(
    () => response?.anomalies.filter((a) => a.count > 0) ?? [],
    [response?.anomalies],
  );
  const itemsWithAnyIssue = response?.kpis.itemsWithAnyIssue ?? 0;
  const totalItemsCount = response?.kpis.totalItems ?? 0;

  return (
    <ReportLayout
      printStyles={`${printStyles}${inventoryHealthPrintStyles}`}
      header={
        <div className="flex flex-col gap-3 pb-3">
          <div className="flex items-center justify-between">
            <h1 className="title-new">Inventory Health</h1>
            <div className="flex items-center gap-3">
              <DateRangePickerWithPresets
                $onSelect={handleDateChange}
                presets={LAST_30_DAYS_PRESETS}
                initialRange={defaultDateRange}
                initialSelectValue={presetValue}
              />
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
                onClick={refreshData}
                title="Refresh"
                disabled={isLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleExport}
                title="Export"
                disabled={!exportPrintRows.length}
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
        </div>
      }
    >
      <TooltipProvider>
        <div className="space-y-3">
          {/* issue summary + chip filters (counts match table badges; click = narrow table) */}
          {visibleAnomalies.length > 0 && itemsWithAnyIssue > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1 p-3 bg-red-50 border border-red-200 rounded-lg dark:bg-red-950/30 dark:border-red-900">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
                  <span className="font-medium text-red-900 dark:text-red-100">
                    {itemsWithAnyIssue} of {totalItemsCount}{' '}
                    {totalItemsCount === 1 ? 'item' : 'items'}{' '}
                    {itemsWithAnyIssue === 1 ? 'has' : 'have'} at least one
                    issue
                  </span>
                </div>
                <p className="text-xs text-red-900/80 dark:text-red-100/80 pl-7">
                  Click chip → filter table to that issue; click again to clear.
                  Hide checkboxes stack (narrow first, then chip).
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                {visibleAnomalies.map((a) => {
                  const flagConfig = HEALTH_ISSUE_LABELS[a.type] || {
                    label: a.message,
                    variant: a.count > 5 ? 'destructive' : 'default',
                  };
                  const selected = issueChipFilter === a.type;
                  const chipTip = HEALTH_ISSUE_TOOLTIPS[a.type];
                  const chipButton = (
                    <button
                      type="button"
                      onClick={(e) => {
                        setIssueChipFilter((prev) =>
                          prev === a.type ? null : a.type,
                        );
                        e.currentTarget.blur(); // drop focus so selection ring is only state, not stuck :focus ring
                      }}
                      className={cn(
                        badgeVariants({ variant: flagConfig.variant }),
                        'cursor-pointer py-1 px-2.5 outline-none ring-offset-background transition-shadow',
                        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        selected &&
                          'ring-2 ring-primary ring-offset-2 shadow-sm',
                      )}
                    >
                      {flagConfig.label}: {a.count}
                    </button>
                  );
                  return (
                    <span
                      key={a.type}
                      className="inline-flex items-center gap-0.5"
                    >
                      {chipButton}
                      {chipTip ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={(e) => e.currentTarget.blur()}
                              className="inline-flex shrink-0 rounded-full p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                              aria-label={`What ${flagConfig.label} means`}
                            >
                              <Info className="h-3.5 w-3.5" strokeWidth={2.5} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            className="max-w-xs text-left"
                          >
                            {chipTip}
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <Card className="p-6 text-center text-muted-foreground">
              Loading inventory health data...
            </Card>
          )}

          {/* hide rows (same idea as inventory list; default off so issues stay visible) */}
          {!isLoading && tableData && tableData.length > 0 && (
            <div className="print:hidden flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-muted/30 px-4 py-3">
              <span className="text-sm font-medium text-muted-foreground">
                Hide items:
              </span>
              <Label
                htmlFor="ih-filter-hide-all"
                className="flex cursor-pointer items-center gap-2 text-sm font-normal"
              >
                <Checkbox
                  id="ih-filter-hide-all"
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
                htmlFor="ih-filter-hide-negative-qty"
                className="flex cursor-pointer items-center gap-2 text-sm font-normal"
              >
                <Checkbox
                  id="ih-filter-hide-negative-qty"
                  checked={hideNegativeQuantity}
                  onCheckedChange={(checked) =>
                    setHideNegativeQuantity(checked === true)
                  }
                />
                <span>Negative quantity</span>
              </Label>
              <Label
                htmlFor="ih-filter-hide-zero-qty"
                className="flex cursor-pointer items-center gap-2 text-sm font-normal"
              >
                <Checkbox
                  id="ih-filter-hide-zero-qty"
                  checked={hideZeroQuantity}
                  onCheckedChange={(checked) =>
                    setHideZeroQuantity(checked === true)
                  }
                />
                <span>Zero quantity</span>
              </Label>
              <Label
                htmlFor="ih-filter-hide-zero-price"
                className="flex cursor-pointer items-center gap-2 text-sm font-normal"
              >
                <Checkbox
                  id="ih-filter-hide-zero-price"
                  checked={hideZeroPrice}
                  onCheckedChange={(checked) =>
                    setHideZeroPrice(checked === true)
                  }
                />
                <span>Zero price</span>
              </Label>
              <Label
                htmlFor="ih-filter-hide-no-type"
                className="flex cursor-pointer items-center gap-2 text-sm font-normal"
              >
                <Checkbox
                  id="ih-filter-hide-no-type"
                  checked={hideNoType}
                  onCheckedChange={(checked) => setHideNoType(checked === true)}
                />
                <span>No type</span>
              </Label>
            </div>
          )}

          {/* Inventory Table */}
          {!isLoading && filteredTableData && filteredTableData.length > 0 && (
            <DataTable<InventoryHealthRow, unknown>
              columns={columns}
              data={filteredTableData}
              virtual
              compact
              defaultSortField="onHandQty"
              defaultSortDirection="desc"
              searchFields={['item', 'itemType', 'price', 'flags']}
              searchPlaceholder="Search items, types, price, issues..."
              searchPersistenceKey="inventory-health-search"
              onViewModelChange={handleGridViewModelChange}
            />
          )}

          {!isLoading &&
            tableData &&
            tableData.length > 0 &&
            afterHideFilters &&
            afterHideFilters.length === 0 && (
              <Card className="p-6 text-center text-muted-foreground">
                No rows match your hide filters. Uncheck some options above.
              </Card>
            )}

          {!isLoading &&
            afterHideFilters &&
            afterHideFilters.length > 0 &&
            filteredTableData &&
            filteredTableData.length === 0 && (
              <Card className="p-6 text-center text-muted-foreground">
                No rows match selected issue chip under current hide rules.
                Clear chip (click again) or adjust hide checkboxes.
              </Card>
            )}

          {!isLoading && response && response.rows.length === 0 && (
            <Card className="p-6 text-center text-muted-foreground">
              No inventory items found.
            </Card>
          )}

          {!isLoading && !response && (
            <Card className="p-6 text-center text-muted-foreground">
              Select a date range to view inventory health.
            </Card>
          )}
        </div>
      </TooltipProvider>
    </ReportLayout>
  );
};

export default InventoryHealthPage;
