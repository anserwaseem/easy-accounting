import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { format, startOfYear } from 'date-fns';
import {
  Download,
  Printer,
  RefreshCw,
  DollarSign,
  Clock,
  UserCheck,
  Receipt,
} from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Card } from '@/renderer/shad/ui/card';
import { ReportLayout } from '@/renderer/components/ReportLayout';
import {
  DateRangePickerWithPresets,
  type DateRange,
} from '@/renderer/shad/ui/datePicker';
import { type Chart, REPORT_FILTER_KEYS } from 'types';
import {
  loadSavedFilters,
  saveSavedFilters,
  makeSavedState,
} from '@/renderer/lib/reportFilters';
import {
  exportReportToExcel,
  type ReportExportPayload,
} from '@/renderer/lib/reportExport';
import { getFormattedCurrency, cn } from '@/renderer/lib/utils';
import { toast } from '@/renderer/shad/ui/use-toast';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { Badge } from '@/renderer/shad/ui/badge';
import { useNavigate } from 'react-router-dom';

interface ReceivablesResponse {
  kpis: Record<string, number>;
  rows: Array<Record<string, unknown>>;
  anomalies: Array<{
    type: string;
    message: string;
    count: number;
    rows: unknown[];
  }>;
  series: never[];
  exportRows: Array<Record<string, unknown>>;
}

const ReceivablesReportPage: React.FC = () => {
  const navigate = useNavigate();

  const saved = useMemo(
    () => loadSavedFilters(REPORT_FILTER_KEYS.receivables),
    [],
  );

  const defaultDateRange: DateRange = useMemo(() => {
    if (saved.dateRange?.from && saved.dateRange?.to) {
      return {
        from: new Date(saved.dateRange.from),
        to: new Date(saved.dateRange.to),
      };
    }
    return { from: startOfYear(new Date()), to: new Date() };
  }, [saved.dateRange]);

  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    defaultDateRange,
  );
  const [presetValue, setPresetValue] = useState<string>(
    saved.presetValue ?? 'current-year',
  );
  const [selectedHead, setSelectedHead] = useState<string>('');
  const [charts, setCharts] = useState<Chart[]>([]);
  const [response, setResponse] = useState<ReceivablesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<number>>(
    new Set(),
  );
  const filterRef = useRef(0);

  const fetchCharts = useCallback(async () => {
    try {
      const fetched = await window.electron.getCharts();
      const filtered = fetched.filter((c: Chart) => !!c.parentId);
      setCharts(filtered);
      if (!selectedHead && filtered.length > 0) {
        setSelectedHead(filtered[0]?.id?.toString() ?? '');
      }
    } catch (error) {
      console.error('Error fetching charts:', error);
    }
  }, [selectedHead]);

  const fetchData = useCallback(
    async (headId: string, range: DateRange) => {
      if (!headId || !range.from || !range.to) return;
      const chart = charts.find((c) => c.id?.toString() === headId);
      const headName = chart?.name ?? headId;

      setIsLoading(true);
      filterRef.current += 1;
      const thisFilter = filterRef.current;

      const startDate = range.from.toISOString().split('T')[0];
      const endDate = range.to.toISOString().split('T')[0];

      try {
        const resp = await window.electron.reportGetReceivables({
          headName,
          startDate,
          endDate,
        });
        if (thisFilter === filterRef.current) {
          setResponse(resp as unknown as ReceivablesResponse);
        }
      } catch (error) {
        console.error('Error fetching receivables:', error);
      } finally {
        if (thisFilter === filterRef.current) setIsLoading(false);
      }
    },
    [charts],
  );

  useEffect(() => {
    fetchCharts();
  }, [fetchCharts]);

  const handleDateChange = useCallback(
    (range?: DateRange, selectValue?: string) => {
      if (!range) return;
      setDateRange(range);
      if (selectValue) setPresetValue(selectValue);
      saveSavedFilters(
        REPORT_FILTER_KEYS.receivables,
        makeSavedState(range, undefined, {
          presetValue: selectValue ?? presetValue,
        }),
      );
      if (selectedHead) fetchData(selectedHead, range);
    },
    [selectedHead, fetchData, presetValue],
  );

  const refreshData = useCallback(() => {
    fetchCharts();
    if (selectedHead && dateRange) fetchData(selectedHead, dateRange);
  }, [selectedHead, dateRange, fetchData, fetchCharts]);

  const handleExport = useCallback(() => {
    if (!response || !response.rows.length) return;
    try {
      const payload: ReportExportPayload = {
        title: 'Receivables Report',
        subtitle:
          dateRange?.from && dateRange?.to
            ? `${format(dateRange.from, 'PPP')} – ${format(
                dateRange.to,
                'PPP',
              )}`
            : '',
        sheetName: 'Receivables',
        columns: [
          {
            key: 'accountName',
            header: 'Customer',
            format: 'string' as const,
            width: 24,
          },
          {
            key: 'accountCode',
            header: 'Code',
            format: 'string' as const,
            width: 8,
          },
          {
            key: 'billedAmount',
            header: 'Billed',
            format: 'currency' as const,
            width: 14,
          },
          {
            key: 'collectedAmount',
            header: 'Collected',
            format: 'currency' as const,
            width: 14,
          },
          {
            key: 'outstandingAmount',
            header: 'Outstanding',
            format: 'currency' as const,
            width: 14,
          },
          {
            key: 'overdueAmount',
            header: 'Overdue',
            format: 'currency' as const,
            width: 14,
          },
          {
            key: 'billCount',
            header: 'Bill Count',
            format: 'number' as const,
            width: 8,
          },
          {
            key: 'lastBillDate',
            header: 'Last Bill',
            format: 'string' as const,
            width: 12,
          },
          {
            key: 'lastReceiptDate',
            header: 'Last Receipt',
            format: 'string' as const,
            width: 12,
          },
          {
            key: 'avgDaysToClear',
            header: 'Avg Days',
            format: 'number' as const,
            width: 10,
          },
          {
            key: 'unallocatedReceipts',
            header: 'Unallocated',
            format: 'currency' as const,
            width: 14,
          },
        ],
        rows: response.rows,
        suggestedFileName: `Receivables_${format(
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
  }, [response, dateRange]);

  const handlePrint = useCallback(() => window.print(), []);

  const handleDrillDown = useCallback(
    (accountId: number) => {
      navigate(
        `/accounts/${accountId}?range-start=${dateRange?.from?.toISOString()}&range-end=${dateRange?.to?.toISOString()}`,
      );
    },
    [navigate, dateRange],
  );

  const toggleAccountExpand = useCallback(
    (accountId: number) => {
      const next = new Set(expandedAccounts);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      setExpandedAccounts(next);
    },
    [expandedAccounts],
  );

  const kpiCards = response?.kpis
    ? [
        {
          label: 'Total Outstanding',
          value: getFormattedCurrency(response.kpis.totalOutstanding),
          icon: <DollarSign className="h-4 w-4" />,
        },
        {
          label: 'Overdue',
          value: getFormattedCurrency(response.kpis.overdueOutstanding),
          icon: <Clock className="h-4 w-4" />,
          color:
            (response.kpis.overdueOutstanding ?? 0) > 0 ? 'text-red-600' : '',
        },
        {
          label: 'Overdue Accounts',
          value: response.kpis.overdueAccounts,
          icon: <UserCheck className="h-4 w-4" />,
          color:
            (response.kpis.overdueAccounts ?? 0) > 0 ? 'text-amber-600' : '',
        },
        {
          label: 'Unallocated Receipts',
          value: getFormattedCurrency(response.kpis.unallocatedReceipts),
          icon: <Receipt className="h-4 w-4" />,
        },
      ]
    : [];

  const visibleAnomalies =
    response?.anomalies?.filter((a) => a.count > 0) ?? [];

  return (
    <ReportLayout
      header={
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h1 className="title-new">Receivables</h1>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Head:</span>
                <VirtualSelect
                  options={charts}
                  value={selectedHead}
                  onChange={(value) => {
                    const headId = String(value);
                    setSelectedHead(headId);
                    if (dateRange) fetchData(headId, dateRange);
                  }}
                  placeholder="Select head"
                  searchPlaceholder="Search heads..."
                />
              </div>
              <DateRangePickerWithPresets
                $onSelect={handleDateChange}
                presets={[{ label: 'This Month', value: 'current-month' }]}
                initialRange={defaultDateRange}
                initialSelectValue={presetValue}
              />
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
                disabled={!response || !response.rows.length}
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
        {kpiCards.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {kpiCards.map((kpi) => (
              <Card key={kpi.label} className="p-3">
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className={cn('text-xl font-bold', kpi.color)}>
                  {kpi.value}
                </p>
              </Card>
            ))}
          </div>
        )}

        {/* Anomaly Section */}
        {visibleAnomalies.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {visibleAnomalies.map((a) => (
              <Badge
                key={a.type}
                variant={a.count > 5 ? 'destructive' : 'default'}
                className="py-1.5 px-3"
              >
                {a.message}: {a.count}
              </Badge>
            ))}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <Card className="p-6 text-center text-muted-foreground">
            Loading receivables...
          </Card>
        )}

        {/* Receivables Summary Table */}
        {!isLoading && response && response.rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2 px-3" />
                <th className="text-left py-2 px-3 w-48">Customer</th>
                <th className="text-left py-2 px-3 w-20">Code</th>
                <th className="text-right py-2 px-3">Billed</th>
                <th className="text-right py-2 px-3">Collected</th>
                <th className="text-right py-2 px-3">Outstanding</th>
                <th className="text-right py-2 px-3">Overdue</th>
                <th className="text-right py-2 px-3">Bills</th>
                <th className="text-right py-2 px-3">Last Bill</th>
                <th className="text-right py-2 px-3">Last Receipt</th>
                <th className="text-right py-2 px-3">Avg Days</th>
                <th className="text-right py-2 px-3">Unallocated</th>
              </tr>
            </thead>
            <tbody>
              {response.rows.map((row: any) => {
                const isExpanded = expandedAccounts.has(row.accountId);
                const isOverdue = (row.overdueAmount ?? 0) > 0;
                const summaryRow = (
                  <tr
                    key={String(row.accountId)}
                    className={cn(
                      'border-b hover:bg-muted/50',
                      isOverdue && 'bg-red-50/30 dark:bg-red-950/10',
                    )}
                  >
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground text-xs"
                        onClick={() => toggleAccountExpand(row.accountId)}
                      >
                        {isExpanded ? '▼' : '▶'}
                      </button>
                    </td>
                    <td className="py-2 px-3 font-medium">
                      <button
                        type="button"
                        className="text-left w-full font-medium hover:underline"
                        onClick={() => handleDrillDown(row.accountId)}
                      >
                        {row.accountName}
                      </button>
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">
                      {row.accountCode || '—'}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {getFormattedCurrency(row.billedAmount)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {getFormattedCurrency(row.collectedAmount)}
                    </td>
                    <td
                      className={cn(
                        'py-2 px-3 text-right font-semibold',
                        isOverdue && 'text-red-600',
                      )}
                    >
                      {getFormattedCurrency(row.outstandingAmount)}
                    </td>
                    <td
                      className={cn(
                        'py-2 px-3 text-right',
                        isOverdue && 'text-red-600',
                      )}
                    >
                      {row.overdueAmount > 0
                        ? getFormattedCurrency(row.overdueAmount)
                        : '—'}
                    </td>
                    <td className="py-2 px-3 text-right">{row.billCount}</td>
                    <td className="py-2 px-3 text-right text-xs">
                      {row.lastBillDate ?? '—'}
                    </td>
                    <td className="py-2 px-3 text-right text-xs">
                      {row.lastReceiptDate ?? '—'}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {row.avgDaysToClear ?? '—'}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {row.unallocatedReceipts > 0
                        ? getFormattedCurrency(row.unallocatedReceipts)
                        : '—'}
                    </td>
                  </tr>
                );

                const detailRows = isExpanded
                  ? (
                      row.bills as Array<{
                        billNumber: string;
                        billDate: string;
                        discountPercent: number | null;
                        billAmount: number;
                        receipts: Array<{
                          date: string;
                          amount: number;
                          balance: number;
                        }>;
                        remainingBalance: number;
                        daysStatus: string;
                      }>
                    ).map((bill) => {
                      const totalReceipts = bill.receipts.reduce(
                        (s, r) => s + r.amount,
                        0,
                      );
                      return (
                        <tr
                          key={`${row.accountId}-${bill.billNumber}-${bill.billDate}`}
                          className="border-b bg-muted/20 text-xs"
                        >
                          <td />
                          <td
                            colSpan={2}
                            className="py-1.5 px-6 pl-8 font-mono"
                          >
                            {bill.billNumber}
                            <br />
                            <span className="text-[10px] text-muted-foreground">
                              {bill.billDate}
                              {bill.discountPercent != null &&
                                ` · Disc ${bill.discountPercent}%`}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            {getFormattedCurrency(bill.billAmount)}
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            {getFormattedCurrency(totalReceipts)}
                          </td>
                          <td className="py-1.5 px-3 text-right font-semibold">
                            {getFormattedCurrency(bill.remainingBalance)}
                          </td>
                          <td colSpan={5} />
                          <td className="py-1.5 px-3 text-right font-medium">
                            <span
                              className={cn(
                                'italic',
                                bill.daysStatus === 'Cleared'
                                  ? 'text-green-600'
                                  : 'text-amber-600',
                              )}
                            >
                              {bill.daysStatus}
                            </span>
                          </td>
                          <td />
                        </tr>
                      );
                    })
                  : [];

                return (
                  <>
                    {summaryRow}
                    {detailRows}
                  </>
                );
              })}
            </tbody>
          </table>
        )}

        {!isLoading && response && response.rows.length === 0 && (
          <Card className="p-6 text-center text-muted-foreground">
            No receivables found for the selected date range.
          </Card>
        )}

        {!isLoading && !response && (
          <Card className="p-6 text-center text-muted-foreground">
            Select a head and date range to view receivables.
          </Card>
        )}
      </div>
    </ReportLayout>
  );
};

export default ReceivablesReportPage;
