import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, subDays, subYears } from 'date-fns';
import {
  Download,
  Printer,
  RefreshCw,
  TrendingUp,
  FileText,
  Clock,
  DollarSign,
} from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Card } from '@/renderer/shad/ui/card';
import { ReportLayout } from '@/renderer/components/ReportLayout';
import {
  DateRangePickerWithPresets,
  type DateRange,
} from '@/renderer/shad/ui/datePicker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/shad/ui/select';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Label } from '@/renderer/shad/ui/label';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
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
import { getFormattedCurrency } from '@/renderer/lib/utils';
import { toast } from '@/renderer/shad/ui/use-toast';
import { Badge } from '@/renderer/shad/ui/badge';
import { useNavigate } from 'react-router-dom';
import { DataTable, type ColumnDef } from '@/renderer/shad/ui/dataTable';
import type { Row } from '@tanstack/react-table';
import { REPORT_FILTER_KEYS } from '@/types';

interface SalesPerformanceResponse {
  kpis: Record<string, number>;
  series: Array<{
    dataPoints: Array<{ date: string; value: number }>;
    granularity: string;
  }>;
  rows: Array<Record<string, unknown>>;
  topItems: Array<Record<string, unknown>>;
  returns: Array<Record<string, unknown>>;
  quotationBacklog: Array<Record<string, unknown>>;
  anomalies: Array<{
    type: string;
    message: string;
    count: number;
    rows: unknown[];
  }>;
  exportRows: Array<Record<string, unknown>>;
  comparisonKpis?: Record<string, number>;
  comparisonSeries?: Array<{
    dataPoints: Array<{ date: string; value: number }>;
    granularity: string;
  }>;
  comparisonRows?: Array<Record<string, unknown>>;
  comparisonTopItems?: Array<Record<string, unknown>>;
}

const TABS = ['customers', 'items', 'returns', 'quotations'] as const;
type TabType = (typeof TABS)[number];

const SERIES_LABELS = ['Total Sales', 'Qty Sold', 'Invoice Count'];

const EXPORT_COLUMNS: Record<TabType, ReportExportPayload['columns']> = {
  customers: [
    { key: 'customerName', header: 'Customer', format: 'string', width: 24 },
    {
      key: 'totalAmount',
      header: 'Total Amount',
      format: 'currency',
      width: 14,
    },
    { key: 'invoiceCount', header: 'Invoices', format: 'number', width: 10 },
  ],
  items: [
    { key: 'itemName', header: 'Item', format: 'string', width: 24 },
    { key: 'totalQty', header: 'Qty Sold', format: 'number', width: 10 },
    {
      key: 'totalAmount',
      header: 'Total Amount',
      format: 'currency',
      width: 14,
    },
  ],
  returns: [
    { key: 'invoiceNumber', header: 'Invoice #', format: 'number', width: 12 },
    { key: 'date', header: 'Return Date', format: 'date', width: 12 },
    { key: 'customerName', header: 'Customer', format: 'string', width: 24 },
    { key: 'amount', header: 'Return Amount', format: 'currency', width: 14 },
  ],
  quotations: [
    {
      key: 'invoiceNumber',
      header: 'Quotation #',
      format: 'number',
      width: 12,
    },
    { key: 'date', header: 'Date', format: 'date', width: 12 },
    { key: 'customerName', header: 'Customer', format: 'string', width: 24 },
    { key: 'amount', header: 'Amount', format: 'currency', width: 14 },
  ],
};

const TAB_LABELS: Record<TabType, string> = {
  customers: 'Top Customers',
  items: 'Top Items',
  returns: 'Returns',
  quotations: 'Quotation Backlog',
};

const computeDelta = (
  current: number,
  previous: number,
): { pct: string; up: boolean } => {
  if (previous === 0)
    return current > 0 ? { pct: '∞', up: true } : { pct: '0', up: true };
  const delta = ((current - previous) / Math.abs(previous)) * 100;
  return { pct: Math.abs(delta).toFixed(1), up: delta >= 0 };
};

interface DeltaBadgeProps {
  current: number;
  previous: number;
  inverse?: boolean;
  enableComparison: boolean;
}

const DeltaBadge: React.FC<DeltaBadgeProps> = ({
  current,
  previous,
  inverse,
  enableComparison,
}: DeltaBadgeProps) => {
  if (!enableComparison || previous == null) return null;
  const { pct, up } = computeDelta(current, previous);
  const isGood = inverse ? !up : up;
  return (
    <span className={`text-xs ${isGood ? 'text-green-600' : 'text-red-600'}`}>
      {isGood ? '△' : '▽'} {pct}%
    </span>
  );
};

const SalesPerformanceReportPage: React.FC = () => {
  const navigate = useNavigate();

  const saved = useMemo(
    () => loadSavedFilters(REPORT_FILTER_KEYS.salesPerformance),
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
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>(
    saved.groupBy ?? 'day',
  );
  const [groupByPolicy, setGroupByPolicy] = useState<boolean>(
    saved.groupByPolicy ?? false,
  );
  const [enableComparison, setEnableComparison] = useState<boolean>(false);
  const [comparisonPeriod, setComparisonPeriod] = useState<string>('previous');
  const [response, setResponse] = useState<SalesPerformanceResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('customers');
  const [seriesIndex, setSeriesIndex] = useState(0);
  const filterRef = useRef(0);

  const computeComparisonDates = useCallback(
    (range: DateRange, mode: string) => {
      if (!range?.from || !range?.to) {
        return { compareStart: undefined, compareEnd: undefined };
      }

      const durationDays = Math.ceil(
        (range.to.getTime() - range.from.getTime()) / 86400000,
      );

      if (mode === 'previous') {
        const compareEnd = subDays(range.from, 1);
        const compareStart = subDays(compareEnd, durationDays);
        return {
          compareStart: format(compareStart, 'yyyy-MM-dd'),
          compareEnd: format(compareEnd, 'yyyy-MM-dd'),
        };
      }
      if (mode === 'previous_year') {
        return {
          compareStart: format(subYears(range.from, 1), 'yyyy-MM-dd'),
          compareEnd: format(subYears(range.to, 1), 'yyyy-MM-dd'),
        };
      }
      return { compareStart: undefined, compareEnd: undefined };
    },
    [],
  );

  const fetchData = useCallback(
    async (
      range: DateRange,
      gb: 'day' | 'week' | 'month',
      groupByPolicyParam: boolean = false,
      comparisonModeParam: string = 'previous',
      comparisonEnabled: boolean = false,
    ) => {
      if (!range.from || !range.to) return;
      setIsLoading(true);
      filterRef.current += 1;
      const thisFilter = filterRef.current;

      const startDate = range.from.toISOString().split('T')[0];
      const endDate = range.to.toISOString().split('T')[0];

      const { compareStart, compareEnd } = comparisonEnabled
        ? computeComparisonDates(range, comparisonModeParam)
        : { compareStart: undefined, compareEnd: undefined };

      try {
        const resp = await window.electron.reportGetSalesPerformance({
          startDate,
          endDate,
          groupBy: gb,
          groupByPolicy: groupByPolicyParam,
          ...(compareStart && compareEnd
            ? { compareStartDate: compareStart, compareEndDate: compareEnd }
            : {}),
        });

        if (thisFilter === filterRef.current) {
          setResponse(resp as unknown as SalesPerformanceResponse);
        }
      } catch (error) {
        console.error('Error fetching sales performance:', error);
      } finally {
        if (thisFilter === filterRef.current) setIsLoading(false);
      }
    },
    [computeComparisonDates],
  );

  const handleDateChange = useCallback(
    (range?: DateRange, selectValue?: string) => {
      if (!range) return;
      setDateRange(range);
      if (selectValue) setPresetValue(selectValue);
      saveSavedFilters(
        REPORT_FILTER_KEYS.salesPerformance,
        makeSavedState(range, groupBy, {
          groupByPolicy,
          presetValue: selectValue ?? presetValue,
          ...(enableComparison
            ? computeComparisonDates(range, comparisonPeriod)
            : {}),
        }),
      );
      fetchData(
        range,
        groupBy,
        groupByPolicy,
        comparisonPeriod,
        enableComparison,
      );
    },
    [
      groupBy,
      groupByPolicy,
      fetchData,
      enableComparison,
      comparisonPeriod,
      computeComparisonDates,
      presetValue,
    ],
  );

  const handleGroupByChange = useCallback(
    (value: string) => {
      const gb = value as 'day' | 'week' | 'month';
      setGroupBy(gb);
      saveSavedFilters(
        REPORT_FILTER_KEYS.salesPerformance,
        makeSavedState(dateRange, gb, { groupByPolicy, presetValue }),
      );
      if (dateRange)
        fetchData(
          dateRange,
          gb,
          groupByPolicy,
          comparisonPeriod,
          enableComparison,
        );
    },
    [
      dateRange,
      groupByPolicy,
      fetchData,
      comparisonPeriod,
      enableComparison,
      presetValue,
    ],
  );

  const handleGroupByPolicyChange = useCallback(
    (checked: boolean) => {
      setGroupByPolicy(checked);
      saveSavedFilters(
        REPORT_FILTER_KEYS.salesPerformance,
        makeSavedState(dateRange, groupBy, {
          groupByPolicy: checked,
          presetValue,
        }),
      );
      if (dateRange) fetchData(dateRange, groupBy, checked);
    },
    [dateRange, groupBy, fetchData, presetValue],
  );

  const handleEnableComparison = useCallback(
    (checked: boolean) => {
      setEnableComparison(checked);
      saveSavedFilters(
        REPORT_FILTER_KEYS.salesPerformance,
        makeSavedState(dateRange, groupBy, {
          groupByPolicy,
          presetValue,
          comparisonMode: comparisonPeriod,
          ...(checked && dateRange
            ? computeComparisonDates(dateRange, comparisonPeriod)
            : {}),
        }),
      );
      if (dateRange)
        fetchData(dateRange, groupBy, groupByPolicy, comparisonPeriod, checked);
    },
    [
      dateRange,
      groupBy,
      groupByPolicy,
      comparisonPeriod,
      computeComparisonDates,
      fetchData,
      presetValue,
    ],
  );

  const handleComparisonPeriodChange = useCallback(
    (value: string) => {
      setComparisonPeriod(value);
      saveSavedFilters(
        REPORT_FILTER_KEYS.salesPerformance,
        makeSavedState(dateRange, groupBy, {
          groupByPolicy,
          presetValue,
          comparisonMode: value,
          ...(enableComparison && dateRange
            ? computeComparisonDates(dateRange, value)
            : {}),
        }),
      );
      if (dateRange)
        fetchData(dateRange, groupBy, groupByPolicy, value, enableComparison);
    },
    [
      dateRange,
      groupBy,
      groupByPolicy,
      enableComparison,
      computeComparisonDates,
      fetchData,
      presetValue,
    ],
  );

  const refreshData = useCallback(() => {
    if (dateRange)
      fetchData(
        dateRange,
        groupBy,
        groupByPolicy,
        comparisonPeriod,
        enableComparison,
      );
  }, [
    dateRange,
    groupBy,
    groupByPolicy,
    comparisonPeriod,
    enableComparison,
    fetchData,
  ]);

  const handleExport = useCallback(() => {
    if (!response) return;
    try {
      let tabRows: Array<Record<string, unknown>>;
      let columns: ReportExportPayload['columns'];
      if (activeTab === 'customers') {
        tabRows = response.rows;
        columns = groupByPolicy
          ? [
              {
                key: 'groupName',
                header: 'Policy',
                format: 'string' as const,
                width: 24,
              },
              {
                key: 'totalAmount',
                header: 'Total Amount',
                format: 'currency' as const,
                width: 14,
              },
              {
                key: 'invoiceCount',
                header: 'Invoices',
                format: 'number' as const,
                width: 10,
              },
              {
                key: 'customerCount',
                header: 'Customers',
                format: 'number' as const,
                width: 10,
              },
            ]
          : [
              {
                key: 'groupName',
                header: 'Customer',
                format: 'string' as const,
                width: 24,
              },
              {
                key: 'totalAmount',
                header: 'Total Amount',
                format: 'currency' as const,
                width: 14,
              },
              {
                key: 'invoiceCount',
                header: 'Invoices',
                format: 'number' as const,
                width: 10,
              },
            ];
      } else if (activeTab === 'items') {
        tabRows = response.topItems;
        columns = EXPORT_COLUMNS[activeTab];
      } else if (activeTab === 'returns') {
        tabRows = response.returns;
        columns = EXPORT_COLUMNS[activeTab];
      } else {
        tabRows = response.quotationBacklog;
        columns = EXPORT_COLUMNS[activeTab];
      }

      const payload: ReportExportPayload = {
        title: 'Sales Performance Report',
        subtitle:
          dateRange?.from && dateRange?.to
            ? `${format(dateRange.from, 'PPP')} – ${format(
                dateRange.to,
                'PPP',
              )}`
            : '',
        sheetName: 'Sales Performance',
        columns,
        rows: tabRows,
        suggestedFileName: `Sales_Performance_${format(
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
  }, [response, dateRange, activeTab, groupByPolicy]);

  const handlePrint = useCallback(() => window.print(), []);

  const handleDrillDown = useCallback(
    (invoiceId: number) => {
      navigate(`/sale/invoices/${invoiceId}`);
    },
    [navigate],
  );

  const mergedSeriesData = useMemo(() => {
    const current = response?.series?.[seriesIndex]?.dataPoints ?? [];
    const comparison = response?.comparisonSeries?.[seriesIndex]?.dataPoints;

    if (!enableComparison || !comparison?.length) {
      return current.map((d) => ({
        date: d.date,
        value: d.value,
        comparisonValue: undefined,
      }));
    }

    const compByDay = new Map<string, number>();
    if (comparison.length > 0) {
      const compStart = new Date(comparison[0].date).getTime();
      for (const d of comparison) {
        const dayOffset = Math.floor(
          (new Date(d.date).getTime() - compStart) / 86400000,
        );
        compByDay.set(`day_${dayOffset}`, d.value);
      }
    }

    const currStart = new Date(current[0]?.date).getTime();
    return current.map((d) => {
      const dayOffset = Math.floor(
        (new Date(d.date).getTime() - currStart) / 86400000,
      );
      return {
        date: d.date,
        value: d.value,
        comparisonValue: compByDay.get(`day_${dayOffset}`),
      };
    });
  }, [response, seriesIndex, enableComparison]);

  const tooltipFormatter = useCallback(
    (value: unknown): string | number | null => {
      if (typeof value === 'number') {
        return seriesIndex === 1 ? value : getFormattedCurrency(value);
      }
      return String(value);
    },
    [seriesIndex],
  );

  // Initial fetch and refetch when dependencies change
  useEffect(() => {
    if (dateRange) {
      fetchData(
        dateRange,
        groupBy,
        groupByPolicy,
        comparisonPeriod,
        enableComparison,
      );
    }
  }, [
    dateRange,
    groupBy,
    groupByPolicy,
    comparisonPeriod,
    enableComparison,
    fetchData,
  ]);

  // Helper renderers for DataTable
  const renderCellNum = (row: Record<string, unknown>, key: string): string =>
    String(row[key] ?? 0);

  const renderCellDate = (
    row: Record<string, unknown>,
    key: string,
  ): string => {
    const val = row[key];
    if (typeof val === 'string' && val) {
      try {
        return format(new Date(val), 'PP');
      } catch {
        return '—';
      }
    }
    return '—';
  };

  // Define columns for customers/policies table
  // eslint-disable-next-line react/no-unstable-nested-components
  const customerColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    const baseCols: ColumnDef<Record<string, unknown>>[] = [
      {
        accessorKey: 'groupName',
        header: groupByPolicy ? 'Policy' : 'Customer',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <span className="font-medium">
            {String(row.original.groupName ?? '')}
          </span>
        ),
      },
      {
        accessorKey: 'totalAmount',
        header: 'Total Amount',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.totalAmount as number),
      },
      {
        accessorKey: 'invoiceCount',
        header: 'Invoices',
        cell: ({ row }) => String(row.original.invoiceCount ?? 0),
      },
    ];

    // When grouping by individual customers (not policy), show account code column
    if (!groupByPolicy) {
      baseCols.splice(1, 0, {
        accessorKey: 'groupCode',
        header: 'Code',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => {
          const code = (row.original as any).groupCode;
          return code != null ? String(code) : '—';
        },
      });
    }

    // When grouping by policy, show customer count column
    if (groupByPolicy) {
      baseCols.push({
        accessorKey: 'customerCount',
        header: 'Customers',
        cell: ({ row }) => String((row.original as any).customerCount ?? 0),
      });
    }

    return baseCols;
  }, [groupByPolicy]);

  // Columns for top items
  // eslint-disable-next-line react/no-unstable-nested-components
  const itemColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      {
        accessorKey: 'itemName',
        header: 'Item',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <span className="font-medium">
            {String(row.original.itemName ?? '')}
          </span>
        ),
        onClick: (row: Row<Record<string, unknown>>) => {
          const itemId = row.original.itemId as number;
          navigate(`/inventory?highlight=${itemId}`);
        },
      },
      {
        accessorKey: 'totalQty',
        header: 'Qty Sold',
        cell: ({ row }) => renderCellNum(row.original, 'totalQty'),
      },
      {
        accessorKey: 'totalAmount',
        header: 'Total Amount',
        cell: ({ row }) =>
          getFormattedCurrency(row.original.totalAmount as number),
      },
    ],
    [navigate],
  );

  // Columns for returns
  // eslint-disable-next-line react/no-unstable-nested-components
  const returnsColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      {
        accessorKey: 'invoiceNumber',
        header: 'Invoice #',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <span className="font-medium">
            #{row.original.invoiceNumber as number}
          </span>
        ),
        onClick: (row: Row<Record<string, unknown>>) => {
          const invoiceId = row.original.invoiceId as number;
          handleDrillDown(invoiceId);
        },
      },
      {
        accessorKey: 'date',
        header: 'Return Date',
        cell: ({ row }) => renderCellDate(row.original, 'date'),
      },
      {
        accessorKey: 'customerName',
        header: 'Customer',
        cell: ({ row }) => String(row.original.customerName ?? ''),
      },
      {
        accessorKey: 'amount',
        header: 'Return Amount',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <span className="text-red-600">
            {getFormattedCurrency(row.original.amount as number)}
          </span>
        ),
      },
    ],
    [handleDrillDown],
  );

  // Columns for quotation backlog
  // eslint-disable-next-line react/no-unstable-nested-components
  const quotationColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      {
        accessorKey: 'invoiceNumber',
        header: 'Quotation #',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <span className="font-medium">
            #{row.original.invoiceNumber as number}
          </span>
        ),
        onClick: (row) => {
          const invoiceId = row.original.invoiceId as number;
          handleDrillDown(invoiceId);
        },
      },
      {
        accessorKey: 'date',
        header: 'Date',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => renderCellDate(row.original, 'date'),
      },
      {
        accessorKey: 'customerName',
        header: 'Customer',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => String(row.original.customerName ?? ''),
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => getFormattedCurrency(row.original.amount as number),
      },
    ],
    [handleDrillDown],
  );

  return (
    <ReportLayout
      header={
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h1 className="title-new">Sales Performance</h1>
            <div className="flex items-center gap-3">
              <DateRangePickerWithPresets
                $onSelect={handleDateChange}
                presets={[
                  { label: 'All', value: 'all' },
                  ...LAST_30_DAYS_PRESETS,
                ]}
                initialRange={defaultDateRange}
                initialSelectValue={presetValue}
              />
              <Select value={groupBy} onValueChange={handleGroupByChange}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">By Day</SelectItem>
                  <SelectItem value="week">By Week</SelectItem>
                  <SelectItem value="month">By Month</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="groupByPolicy"
                  checked={groupByPolicy}
                  onCheckedChange={handleGroupByPolicyChange}
                />
                <Label htmlFor="groupByPolicy">Group by policy</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="enableComparison"
                  checked={enableComparison}
                  onCheckedChange={handleEnableComparison}
                />
                <Label htmlFor="enableComparison">Compare with</Label>
                {enableComparison && (
                  <Select
                    value={comparisonPeriod}
                    onValueChange={handleComparisonPeriodChange}
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="Previous period" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="previous">Previous period</SelectItem>
                      <SelectItem value="previous_year">
                        Same period last year
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
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
                disabled={!response}
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
      <div className="p-4 space-y-4">
        {/* KPI Cards */}
        {response?.kpis && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <Card className="p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                Posted Sales
              </p>
              <p className="text-xl font-bold">
                {getFormattedCurrency(response.kpis.postedSalesAmount)}
              </p>
              <DeltaBadge
                current={response.kpis.postedSalesAmount}
                previous={response.comparisonKpis?.postedSalesAmount ?? 0}
                enableComparison={enableComparison}
              />
            </Card>
            <Card className="p-3">
              <p className="text-xs text-muted-foreground">Qty Sold</p>
              <p className="text-xl font-bold">{response.kpis.qtySold}</p>
              <DeltaBadge
                current={response.kpis.qtySold}
                previous={response.comparisonKpis?.qtySold ?? 0}
                enableComparison={enableComparison}
              />
            </Card>
            <Card className="p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Invoices
              </p>
              <p className="text-xl font-bold">{response.kpis.invoiceCount}</p>
              <DeltaBadge
                current={response.kpis.invoiceCount}
                previous={response.comparisonKpis?.invoiceCount ?? 0}
                enableComparison={enableComparison}
              />
            </Card>
            <Card className="p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                Avg Amount
              </p>
              <p className="text-xl font-bold">
                {getFormattedCurrency(response.kpis.avgInvoiceAmount)}
              </p>
              <DeltaBadge
                current={response.kpis.avgInvoiceAmount}
                previous={response.comparisonKpis?.avgInvoiceAmount ?? 0}
                enableComparison={enableComparison}
              />
            </Card>
            <Card className="p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Returns
              </p>
              <p className="text-xl font-bold">
                {response.kpis.returnedInvoiceCount}
              </p>
              <DeltaBadge
                current={response.kpis.returnedInvoiceCount}
                previous={response.comparisonKpis?.returnedInvoiceCount ?? 0}
                inverse
                enableComparison={enableComparison}
              />
            </Card>
          </div>
        )}

        {/* Chart */}
        {response?.series && response.series.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex gap-2">
                {SERIES_LABELS.map((label) => {
                  const idx = SERIES_LABELS.indexOf(label);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setSeriesIndex(idx)}
                      className={`text-xs px-2 py-1 rounded transition ${
                        idx === seriesIndex
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={mergedSeriesData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={tooltipFormatter} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name={SERIES_LABELS[seriesIndex]}
                />
                {enableComparison &&
                  mergedSeriesData.some((d) => d.comparisonValue != null) && (
                    <Line
                      type="monotone"
                      dataKey="comparisonValue"
                      stroke="#f59e0b"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={false}
                      name={`Previous ${
                        comparisonPeriod === 'previous_year' ? 'Year' : 'Period'
                      }`}
                    />
                  )}
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Sub-tabs */}
        {response && (
          <div className="flex gap-2">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`text-sm px-3 py-1.5 rounded transition ${
                  tab === activeTab
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {TAB_LABELS[tab]}
                {tab === 'returns' &&
                  response.kpis.returnedInvoiceCount > 0 && (
                    <Badge variant="destructive" className="ml-1 text-xs">
                      {response.kpis.returnedInvoiceCount}
                    </Badge>
                  )}
              </button>
            ))}
          </div>
        )}

        {/* Tables */}
        {isLoading && (
          <Card className="p-6 text-center text-muted-foreground">
            Loading sales data...
          </Card>
        )}

        {!isLoading && response && activeTab === 'customers' && (
          <DataTable
            columns={customerColumns}
            data={response.rows}
            defaultSortField="totalAmount"
            defaultSortDirection="desc"
            searchFields={['groupName', 'groupCode']}
            searchPlaceholder="Search customers..."
            searchPersistenceKey={`${REPORT_FILTER_KEYS.salesPerformance}.customersSearch`}
            virtual
          />
        )}

        {!isLoading && response && activeTab === 'items' && (
          <DataTable
            columns={itemColumns}
            data={response.topItems}
            defaultSortField="totalAmount"
            defaultSortDirection="desc"
            searchFields={['groupName', 'groupCode']}
            searchPlaceholder="Search items..."
            searchPersistenceKey={`${REPORT_FILTER_KEYS.salesPerformance}.itemsSearch`}
            virtual
          />
        )}

        {!isLoading &&
          response &&
          activeTab === 'returns' &&
          response.returns.length > 0 && (
            <DataTable
              columns={returnsColumns}
              data={response.returns}
              defaultSortField="date"
              defaultSortDirection="desc"
              searchFields={['invoiceNumber', 'customerName']}
              searchPlaceholder="Search returns..."
              searchPersistenceKey={`${REPORT_FILTER_KEYS.salesPerformance}.returnsSearch`}
              virtual
            />
          )}

        {!isLoading &&
          response &&
          activeTab === 'quotations' &&
          response.quotationBacklog.length > 0 && (
            <DataTable
              columns={quotationColumns}
              data={response.quotationBacklog}
              defaultSortField="date"
              defaultSortDirection="desc"
              searchFields={['invoiceNumber', 'customerName']}
              searchPlaceholder="Search quotations..."
              searchPersistenceKey={`${REPORT_FILTER_KEYS.salesPerformance}.quotationsSearch`}
              virtual
            />
          )}

        {!isLoading && !response && (
          <Card className="p-6 text-center text-muted-foreground">
            Select a date range to view sales performance.
          </Card>
        )}
      </div>
    </ReportLayout>
  );
};

export default SalesPerformanceReportPage;
