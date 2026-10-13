import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format, startOfMonth } from 'date-fns';
import {
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Layers,
  ListOrdered,
  Percent,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import type {
  Account,
  AgentCommissionReport,
  Chart,
  CommissionAdjustment,
  CommissionReportItemLine,
} from '@/types';
import { REPORT_FILTER_KEYS } from '@/types';
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
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/renderer/shad/ui/card';
import { Badge } from '@/renderer/shad/ui/badge';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/renderer/shad/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/renderer/shad/ui/table';
import { toast } from '@/renderer/shad/ui/use-toast';
import { ReportLayout } from '@/renderer/components/ReportLayout';
import { ConfirmDialog } from '@/renderer/components/ConfirmDialog';
import {
  loadSavedFilters,
  makeSavedState,
  saveSavedFilters,
} from '@/renderer/lib/reportFilters';
import { TableVirtuoso } from 'react-virtuoso';
import { exportReportWorkbook } from '@/renderer/lib/reportExport';
import { cn } from '@/renderer/lib/utils';
import { printStyles } from '../components/printStyles';
import { AgentCommissionSheet } from '../../Accounts/AgentCommissionSheet';
import { PostSettlementDialog } from './PostSettlementDialog';
import { printAgentCommissionIframe } from './printAgentCommission';

const formatMoney = (val: number | null | undefined): string => {
  if (val == null || Number.isNaN(val)) return '0';
  return Math.round(val).toLocaleString();
};

const formatInvoiceDate = (dateStr: string): string => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr.slice(0, 10);
    return format(d, 'dd MMM yyyy');
  } catch {
    return dateStr.slice(0, 10);
  }
};

const getAdjustmentColorClass = (adj: number) => {
  if (adj < 0) return 'text-destructive';
  if (adj > 0) return 'text-emerald-600';
  return '';
};

interface InvoiceSummary {
  invoiceId: number;
  invoiceNumber: number;
  invoiceDate: string;
  accountName: string;
  accountCode?: string | null;
  totalQty: number;
  totalCharged: number;
  totalCommission: number;
  lines: CommissionReportItemLine[];
}

const VirtuosoTable = forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <table
    ref={ref}
    className={cn('w-full caption-bottom text-xs border-collapse', className)}
    {...props}
  />
));
VirtuosoTable.displayName = 'VirtuosoTable';

const VirtuosoRow = forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn('border-b transition-colors hover:bg-muted/30', className)}
    {...props}
  />
));
VirtuosoRow.displayName = 'VirtuosoRow';

const virtuosoComponents = {
  Table: VirtuosoTable,
  TableRow: VirtuosoRow,
};

const AgentCommissionReportPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const savedFilters = useMemo(
    () => loadSavedFilters(REPORT_FILTER_KEYS.agentCommission),
    [],
  );

  const defaultDateRange: DateRange = useMemo(() => {
    if (savedFilters.dateRange?.from && savedFilters.dateRange?.to) {
      try {
        const from = new Date(savedFilters.dateRange.from);
        const to = new Date(savedFilters.dateRange.to);
        if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
          return { from, to };
        }
      } catch {
        // fallback
      }
    }
    return {
      from: startOfMonth(new Date()),
      to: new Date(),
    };
  }, [savedFilters.dateRange]);

  const [charts, setCharts] = useState<Chart[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedChartId, setSelectedChartId] = useState<number | null>(() => {
    const param = searchParams.get('chartId');
    if (param) return Number(param);
    return savedFilters.chartId ?? null;
  });

  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    defaultDateRange,
  );
  const [presetValue, setPresetValue] = useState<string>(
    savedFilters.presetValue ?? 'current-month',
  );

  const [report, setReport] = useState<AgentCommissionReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Manual adjustments state
  const [adjustments, setAdjustments] = useState<CommissionAdjustment[]>([]);
  const [newAdjDesc, setNewAdjDesc] = useState('');
  const [newAdjAmount, setNewAdjAmount] = useState('');

  // UI state
  const [activeTab, setActiveTab] = useState<string>('statement');
  const [expandedInvoices, setExpandedInvoices] = useState<Set<number>>(
    new Set(),
  );
  const [showConfigSheet, setShowConfigSheet] = useState(false);
  const [showPostDialog, setShowPostDialog] = useState(false);
  const [showUnpostConfirm, setShowUnpostConfirm] = useState(false);
  const [isUnposting, setIsUnposting] = useState(false);
  const [lineSearch, setLineSearch] = useState('');

  const persistFilters = useCallback(
    (
      chartIdVal: number | null,
      rangeVal: DateRange | undefined,
      presetVal: string,
    ) => {
      saveSavedFilters(
        REPORT_FILTER_KEYS.agentCommission,
        makeSavedState(rangeVal, undefined, {
          chartId: chartIdVal ?? undefined,
          presetValue: presetVal,
        }),
      );
    },
    [],
  );

  // 1. Initial load of charts & accounts
  useEffect(() => {
    let isCancelled = false;
    const initPrerequisites = async () => {
      try {
        const [allCharts, allAccounts] = await Promise.all([
          window.electron.getCharts(),
          window.electron.getAccounts(),
        ]);
        if (isCancelled) return;

        setCharts(allCharts);
        setAccounts(allAccounts);

        const agentHeads = (allCharts as Chart[])
          .filter((c: Chart) => c.parentId != null)
          .sort((a: Chart, b: Chart) => a.name.localeCompare(b.name));

        const paramChartId = searchParams.get('chartId');
        let activeChartId: number | null = null;
        if (paramChartId) {
          activeChartId = Number(paramChartId);
        } else if (
          savedFilters.chartId &&
          agentHeads.some((c: Chart) => c.id === savedFilters.chartId)
        ) {
          activeChartId = savedFilters.chartId;
        } else if (agentHeads.length > 0) {
          activeChartId = agentHeads[0].id;
        }

        if (activeChartId != null) {
          setSelectedChartId(activeChartId);
          persistFilters(activeChartId, dateRange, presetValue);
        }
      } catch (error) {
        console.error('Failed to load charts/accounts:', error);
      }
    };

    initPrerequisites();
    return () => {
      isCancelled = true;
    };
  }, [
    searchParams,
    savedFilters.chartId,
    persistFilters,
    dateRange,
    presetValue,
  ]);

  const agentHeads = useMemo(
    () =>
      charts
        .filter((c) => c.parentId != null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [charts],
  );

  // 2. Fetch report data
  const fetchReport = useCallback(async () => {
    if (selectedChartId == null || !dateRange?.from || !dateRange?.to) return;

    setIsLoading(true);
    const d1 = format(dateRange.from, 'yyyy-MM-dd');
    const d2 = format(dateRange.to, 'yyyy-MM-dd');
    const startDateStr = d1 <= d2 ? d1 : d2;
    const endDateStr = d1 <= d2 ? d2 : d1;

    try {
      const data = await window.electron.commissionGetReport(
        selectedChartId,
        startDateStr,
        endDateStr,
      );
      setReport(data);

      if (data.settlement?.adjustments) {
        setAdjustments(data.settlement.adjustments);
      } else {
        setAdjustments([]);
      }
    } catch (error) {
      console.error('Failed to load commission report:', error);
      toast({
        title: 'Error loading report',
        description: 'Could not fetch agent commission report data.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [selectedChartId, dateRange]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Persist filter selection
  const handleHeadChange = (headIdStr: string) => {
    const id = Number(headIdStr);
    setSelectedChartId(id);
    setSearchParams({ chartId: headIdStr });
    persistFilters(id, dateRange, presetValue);
  };

  const handleDateChange = (range: DateRange | undefined, preset?: string) => {
    setDateRange(range);
    const newPreset = preset ?? presetValue;
    if (preset) setPresetValue(preset);
    persistFilters(selectedChartId, range, newPreset);
  };

  // Adjustments handling
  const handleAddAdjustment = () => {
    const desc = newAdjDesc.trim();
    if (!desc) {
      toast({
        title: 'Description required',
        description: 'Please enter a description for this adjustment.',
        variant: 'destructive',
      });
      return;
    }
    const amt = parseFloat(newAdjAmount);
    if (Number.isNaN(amt) || amt === 0) {
      toast({
        title: 'Invalid amount',
        description: 'Please enter a non-zero adjustment amount.',
        variant: 'destructive',
      });
      return;
    }

    const newAdj: CommissionAdjustment = {
      id: `adj_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      description: desc,
      amount: amt,
    };

    setAdjustments((prev) => [...prev, newAdj]);
    setNewAdjDesc('');
    setNewAdjAmount('');
  };

  const handleRemoveAdjustment = (id: string) => {
    setAdjustments((prev) => prev.filter((a) => a.id !== id));
  };

  const totalAdjustments = useMemo(
    () => adjustments.reduce((sum, adj) => sum + (adj.amount || 0), 0),
    [adjustments],
  );

  const netCommission = useMemo(() => {
    if (!report) return 0;
    return Math.round(report.grossCommission + totalAdjustments);
  }, [report, totalAdjustments]);

  // Grouped Invoices for the "By Invoice" view
  const invoicesList: InvoiceSummary[] = useMemo(() => {
    if (!report) return [];
    const map = new Map<number, InvoiceSummary>();
    const all = report.buckets.flatMap((b) => b.lines);
    for (const line of all) {
      let inv = map.get(line.invoiceId);
      if (!inv) {
        inv = {
          invoiceId: line.invoiceId,
          invoiceNumber: line.invoiceNumber,
          invoiceDate: line.invoiceDate,
          accountName: line.accountName,
          accountCode: line.accountCode,
          totalQty: 0,
          totalCharged: 0,
          totalCommission: 0,
          lines: [],
        };
        map.set(line.invoiceId, inv);
      }
      inv.totalQty += line.quantity;
      inv.totalCharged += line.chargedAmount;
      inv.totalCommission += line.commissionAmount;
      inv.lines.push(line);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.invoiceNumber - a.invoiceNumber,
    );
  }, [report]);

  const toggleInvoiceExpanded = useCallback((invoiceId: number) => {
    setExpandedInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceId)) {
        next.delete(invoiceId);
      } else {
        next.add(invoiceId);
      }
      return next;
    });
  }, []);

  const virtualInvoiceRows = useMemo(() => {
    const rows: Array<
      | { type: 'invoice'; invoice: InvoiceSummary }
      | { type: 'detail'; invoice: InvoiceSummary }
    > = [];
    for (const inv of invoicesList) {
      rows.push({ type: 'invoice', invoice: inv });
      if (expandedInvoices.has(inv.invoiceId)) {
        rows.push({ type: 'detail', invoice: inv });
      }
    }
    return rows;
  }, [invoicesList, expandedInvoices]);

  // Unpost settlement
  const handleUnpostSettlement = async () => {
    if (!report?.settlement) return;
    setIsUnposting(true);
    try {
      await window.electron.commissionUnpostSettlement(report.settlement.id);
      toast({
        title: 'Settlement Unposted',
        description: 'The settlement record and journal entry were deleted.',
      });
      setShowUnpostConfirm(false);
      fetchReport();
    } catch (error) {
      console.error('Failed to unpost settlement:', error);
      toast({
        title: 'Unpost failed',
        description:
          error instanceof Error
            ? error.message
            : 'Could not unpost settlement.',
        variant: 'destructive',
      });
    } finally {
      setIsUnposting(false);
    }
  };

  // All lines for full audit table
  const allLineItems = useMemo(() => {
    if (!report) return [];
    return report.buckets.flatMap((b) => b.lines);
  }, [report]);

  const filteredLines = useMemo(() => {
    if (!lineSearch.trim()) return allLineItems;
    const query = lineSearch.toLowerCase();
    return allLineItems.filter(
      (line) =>
        line.accountName.toLowerCase().includes(query) ||
        (line.accountCode &&
          String(line.accountCode).toLowerCase().includes(query)) ||
        line.itemName.toLowerCase().includes(query) ||
        String(line.invoiceNumber).includes(query) ||
        line.itemTypeName.toLowerCase().includes(query),
    );
  }, [allLineItems, lineSearch]);

  // Print
  const handlePrint = () => {
    if (!report) return;
    const title = `Agent Commission Statement: ${report.agentName}`;
    const subtitle = `Period: ${report.startDate} to ${report.endDate}`;
    printAgentCommissionIframe({
      report,
      adjustments,
      title,
      subtitle,
      includeLineItems: true,
    });
  };

  // Excel Export
  const handleExportExcel = () => {
    if (!report) return;
    const title = `Agent Commission: ${report.agentName}`;
    const subtitle = `${report.startDate} to ${report.endDate}`;

    const summaryRows: Array<Record<string, unknown>> = report.buckets.map(
      (b) => ({
        tier: b.title,
        ruleType: b.ruleType.replace('_', ' '),
        qty: b.totalQty,
        charged: Math.round(b.totalCharged),
        commission: Math.round(b.totalCommission),
      }),
    );

    if (adjustments.length > 0) {
      adjustments.forEach((adj) => {
        summaryRows.push({
          tier: `[Adjustment] ${adj.description}`,
          ruleType: 'manual_adj',
          qty: 0,
          charged: 0,
          commission: Math.round(adj.amount),
        });
      });
    }

    const summarySheet = {
      title,
      subtitle,
      sheetName: 'Commission Summary',
      columns: [
        {
          key: 'tier',
          header: 'Tier / Description',
          format: 'string' as const,
          width: 32,
        },
        {
          key: 'ruleType',
          header: 'Rule Type',
          format: 'string' as const,
          width: 16,
        },
        { key: 'qty', header: 'Units', format: 'number' as const, width: 12 },
        {
          key: 'charged',
          header: 'Charged (Rs.)',
          format: 'currency' as const,
          width: 18,
        },
        {
          key: 'commission',
          header: 'Commission (Rs.)',
          format: 'currency' as const,
          width: 18,
        },
      ],
      rows: summaryRows,
      footerRow: {
        tier: 'NET COMMISSION PAYABLE',
        qty: report.totalQty,
        charged: Math.round(report.totalCharged),
        commission: netCommission,
      },
    };

    const lineRows: Array<Record<string, unknown>> = allLineItems.map(
      (line) => ({
        date: formatInvoiceDate(line.invoiceDate),
        invoiceNumber: line.invoiceNumber,
        customer: line.accountCode
          ? `${line.accountName} (${line.accountCode})`
          : line.accountName,
        item: line.itemName,
        itemType: line.itemTypeName,
        quantity: line.quantity,
        price: line.price,
        discount: line.discount,
        netPrice: line.netPrice ?? '',
        charged: Math.round(line.chargedAmount),
        rateType: line.rateType,
        rateValue: line.rateValue,
        commission: Math.round(line.commissionAmount),
      }),
    );

    const detailSheet = {
      title: `${title} - Detailed Lines`,
      subtitle,
      sheetName: 'Line Items Detail',
      columns: [
        { key: 'date', header: 'Date', format: 'string' as const, width: 14 },
        {
          key: 'invoiceNumber',
          header: 'Inv #',
          format: 'number' as const,
          width: 10,
        },
        {
          key: 'customer',
          header: 'Customer',
          format: 'string' as const,
          width: 28,
        },
        { key: 'item', header: 'SKU', format: 'string' as const, width: 16 },
        {
          key: 'itemType',
          header: 'Type',
          format: 'string' as const,
          width: 14,
        },
        {
          key: 'quantity',
          header: 'Qty',
          format: 'number' as const,
          width: 10,
        },
        { key: 'price', header: 'Price', format: 'number' as const, width: 10 },
        {
          key: 'discount',
          header: 'Disc %',
          format: 'number' as const,
          width: 10,
        },
        {
          key: 'netPrice',
          header: 'Net Price',
          format: 'string' as const,
          width: 12,
        },
        {
          key: 'charged',
          header: 'Charged (Rs.)',
          format: 'currency' as const,
          width: 16,
        },
        {
          key: 'rateType',
          header: 'Rate Type',
          format: 'string' as const,
          width: 14,
        },
        {
          key: 'rateValue',
          header: 'Rate Value',
          format: 'number' as const,
          width: 12,
        },
        {
          key: 'commission',
          header: 'Commission (Rs.)',
          format: 'currency' as const,
          width: 16,
        },
      ],
      rows: lineRows,
      footerRow: {
        customer: 'TOTAL',
        quantity: report.totalQty,
        charged: Math.round(report.totalCharged),
        commission: Math.round(report.grossCommission),
      },
    };

    exportReportWorkbook(
      [summarySheet, detailSheet],
      `commission_${report.agentName}_${report.startDate}_${report.endDate}.xlsx`,
    );
  };

  const renderInvoiceHeader = useCallback(
    () => (
      <tr className="bg-muted/80 text-muted-foreground font-semibold border-b text-xs">
        <th className="h-9 px-3 w-10" />
        <th className="h-9 px-3 text-left w-28">Date</th>
        <th className="h-9 px-3 text-left w-24">Invoice #</th>
        <th className="h-9 px-3 text-left">Customer Account</th>
        <th className="h-9 px-3 text-right w-24">Units</th>
        <th className="h-9 px-3 text-right w-36">Invoice Total</th>
        <th className="h-9 px-3 text-right w-36">Commission</th>
      </tr>
    ),
    [],
  );

  const renderInvoiceItem = useCallback(
    (
      _idx: number,
      item: { type: 'invoice' | 'detail'; invoice: InvoiceSummary },
    ) => {
      if (item.type === 'invoice') {
        const inv = item.invoice;
        const isExpanded = expandedInvoices.has(inv.invoiceId);
        return (
          <>
            <td className="p-2.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => toggleInvoiceExpanded(inv.invoiceId)}
                aria-label={isExpanded ? 'Collapse invoice' : 'Expand invoice'}
              >
                {isExpanded ? (
                  <ChevronDown size={14} className="text-muted-foreground" />
                ) : (
                  <ChevronRight size={14} className="text-muted-foreground" />
                )}
              </Button>
            </td>
            <td className="p-2.5 font-mono text-muted-foreground whitespace-nowrap">
              {formatInvoiceDate(inv.invoiceDate)}
            </td>
            <td className="p-2.5 font-mono font-medium">
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-xs font-mono font-semibold"
                onClick={() => toggleInvoiceExpanded(inv.invoiceId)}
              >
                #{inv.invoiceNumber}
              </Button>
            </td>
            <td className="p-2.5 font-semibold">
              {inv.accountName}
              {inv.accountCode && (
                <span className="text-muted-foreground font-mono font-normal text-[11px] ml-1.5">
                  ({inv.accountCode})
                </span>
              )}
            </td>
            <td className="p-2.5 text-right font-mono">
              {inv.totalQty.toLocaleString()}
            </td>
            <td className="p-2.5 text-right font-mono">
              Rs. {formatMoney(inv.totalCharged)}
            </td>
            <td className="p-2.5 text-right font-mono font-bold text-primary">
              Rs. {formatMoney(inv.totalCommission)}
            </td>
          </>
        );
      }

      const inv = item.invoice;
      return (
        <td colSpan={7} className="p-0 bg-muted/20">
          <div className="p-3 pl-10 border-y border-dashed">
            <div className="text-[11px] font-semibold text-muted-foreground mb-2">
              Line items on Invoice #{inv.invoiceNumber}:
            </div>
            <table className="w-full text-xs bg-background rounded border border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b">
                  <th className="p-2 text-left">Item / SKU</th>
                  <th className="p-2 text-left">Type</th>
                  <th className="p-2 text-right">Qty</th>
                  <th className="p-2 text-right">Price</th>
                  <th className="p-2 text-right">Sale Total</th>
                  <th className="p-2 text-right">Rate Applied</th>
                  <th className="p-2 text-right">Commission</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((line) => (
                  <tr
                    key={`${line.invoiceId}_${line.inventoryId}_${line.rateType}_${line.quantity}`}
                    className="border-b last:border-b-0 hover:bg-muted/20"
                  >
                    <td className="p-2 font-medium">
                      {line.itemName}
                      {line.netPrice != null && (
                        <Badge
                          variant="outline"
                          className="ml-1.5 text-[10px] px-1 py-0"
                        >
                          Net Rate
                        </Badge>
                      )}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {line.itemTypeName}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {line.quantity}
                    </td>
                    <td className="p-2 text-right font-mono">
                      Rs. {line.netPrice != null ? line.netPrice : line.price}
                    </td>
                    <td className="p-2 text-right font-mono">
                      Rs. {formatMoney(line.chargedAmount)}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {line.rateValue}
                      {line.rateType === 'sku_override' ? ' Rs/u' : '%'}
                    </td>
                    <td className="p-2 text-right font-mono font-semibold text-primary">
                      Rs. {formatMoney(line.commissionAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </td>
      );
    },
    [expandedInvoices, toggleInvoiceExpanded],
  );

  const renderInvoiceFooter = useCallback(() => {
    if (!report) return null;
    return (
      <tr className="bg-muted/90 font-semibold text-foreground border-t text-xs">
        <td colSpan={4} className="p-2.5">
          Total Across Invoices ({invoicesList.length} invoices)
        </td>
        <td className="p-2.5 text-right font-mono">
          {report.totalQty.toLocaleString()}
        </td>
        <td className="p-2.5 text-right font-mono">
          Rs. {formatMoney(report.totalCharged)}
        </td>
        <td className="p-2.5 text-right font-mono font-bold text-primary">
          Rs. {formatMoney(report.grossCommission)}
        </td>
      </tr>
    );
  }, [report, invoicesList.length]);

  const renderLineHeader = useCallback(
    () => (
      <tr className="bg-muted/80 text-muted-foreground font-semibold border-b text-xs">
        <th className="h-9 px-3 text-left w-24">Date</th>
        <th className="h-9 px-3 text-left w-20">Inv #</th>
        <th className="h-9 px-3 text-left w-48">Customer</th>
        <th className="h-9 px-3 text-left">Item / SKU</th>
        <th className="h-9 px-3 text-left w-20">Type</th>
        <th className="h-9 px-3 text-right w-16">Qty</th>
        <th className="h-9 px-3 text-right w-24">Price</th>
        <th className="h-9 px-3 text-right w-28">Charged</th>
        <th className="h-9 px-3 text-right w-24">Rate</th>
        <th className="h-9 px-3 text-right w-28">Commission</th>
      </tr>
    ),
    [],
  );

  const renderLineItem = useCallback(
    (_idx: number, line: CommissionReportItemLine) => (
      <>
        <td className="p-2.5 font-mono text-muted-foreground whitespace-nowrap">
          {formatInvoiceDate(line.invoiceDate)}
        </td>
        <td className="p-2.5 font-mono font-medium">#{line.invoiceNumber}</td>
        <td
          className="p-2.5 font-medium truncate max-w-[250px]"
          title={line.accountName}
        >
          {line.accountName}
          {line.accountCode && (
            <span className="text-muted-foreground font-mono text-[11px] ml-1">
              ({line.accountCode})
            </span>
          )}
        </td>
        <td className="p-2.5 font-medium text-foreground">
          <span className="whitespace-nowrap"> {line.itemName}</span>
          {line.netPrice != null && (
            <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0">
              net
            </Badge>
          )}
        </td>
        <td className="p-2.5 text-muted-foreground max-w-2">
          {line.itemTypeName}
        </td>
        <td className="p-2.5 text-right font-mono">{line.quantity}</td>
        <td className="p-2.5 text-right font-mono">
          Rs. {line.netPrice != null ? line.netPrice : line.price}
        </td>
        <td className="p-2.5 text-right font-mono">
          Rs. {formatMoney(line.chargedAmount)}
        </td>
        <td className="p-2.5 text-right font-mono text-muted-foreground">
          {line.rateValue}
          {line.rateType === 'sku_override' ? ' Rs' : '%'}
        </td>
        <td className="p-2.5 text-right font-mono font-bold text-primary">
          Rs. {formatMoney(line.commissionAmount)}
        </td>
      </>
    ),
    [],
  );

  const renderLineFooter = useCallback(() => {
    if (!report) return null;
    return (
      <tr className="bg-muted/90 font-semibold text-foreground border-t text-xs">
        <td colSpan={5} className="p-2.5">
          Total ({filteredLines.length} items)
        </td>
        <td className="p-2.5 text-right font-mono">
          {filteredLines.reduce((s, l) => s + l.quantity, 0).toLocaleString()}
        </td>
        <td />
        <td className="p-2.5 text-right font-mono">
          Rs.{' '}
          {formatMoney(filteredLines.reduce((s, l) => s + l.chargedAmount, 0))}
        </td>
        <td />
        <td className="p-2.5 text-right font-mono text-primary font-bold">
          Rs.{' '}
          {formatMoney(
            filteredLines.reduce((s, l) => s + l.commissionAmount, 0),
          )}
        </td>
      </tr>
    );
  }, [report, filteredLines]);

  return (
    <ReportLayout
      printStyles={printStyles}
      header={
        <div className="flex flex-col gap-3 pb-3 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="title-new flex items-center gap-2">
              <Percent className="h-5 w-5 text-primary" />
              Agent Commissions
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {/* Agent Picker */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Agent:
                </span>
                <Select
                  value={selectedChartId ? String(selectedChartId) : undefined}
                  onValueChange={handleHeadChange}
                >
                  <SelectTrigger className="w-[200px] h-9 text-xs">
                    <SelectValue placeholder="Select Agent..." />
                  </SelectTrigger>
                  <SelectContent>
                    {agentHeads.map((head) => (
                      <SelectItem key={head.id} value={String(head.id)}>
                        {head.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date Range Picker with Presets */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Period:
                </span>
                <DateRangePickerWithPresets
                  initialRange={dateRange}
                  initialSelectValue={presetValue}
                  $onSelect={handleDateChange}
                  presets={[
                    { label: 'This month', value: 'current-month' },
                    { label: 'Last month', value: 'last-month' },
                    { label: 'This year', value: 'current-year' },
                    { label: 'All', value: 'all' },
                  ]}
                />
              </div>

              {/* Action Buttons */}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-9"
                onClick={() => {
                  fetchReport();
                }}
                disabled={isLoading}
                title="Refresh report"
              >
                <RefreshCw
                  size={14}
                  className={isLoading ? 'animate-spin' : ''}
                />
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-9"
                onClick={() => setShowConfigSheet(true)}
              >
                <Settings2 size={14} />
                Rates & Settings
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-9"
                onClick={handlePrint}
                disabled={!report}
              >
                <Printer size={14} />
                Print
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-9"
                onClick={handleExportExcel}
                disabled={!report}
              >
                <Download size={14} />
                Excel
              </Button>
            </div>
          </div>
        </div>
      }
    >
      <div className="space-y-5 pb-12">
        {/* Settlement Status Banner */}
        {report?.settlement && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex flex-wrap items-center justify-between gap-3 text-emerald-950 dark:text-emerald-100">
            <div className="flex items-center gap-3">
              <BadgeCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <div className="font-semibold text-sm">
                  Settlement Posted to Ledger
                </div>
                <div className="text-xs text-muted-foreground dark:text-emerald-300/80">
                  Posted on {report.settlement.createdAt?.slice(0, 10)} for Rs.{' '}
                  {formatMoney(report.settlement.netCommission)} (Journal #
                  {report.settlement.journalId})
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {report.settlement.journalId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs bg-background/80"
                  onClick={() =>
                    navigate(`/journals/${report.settlement?.journalId}`)
                  }
                >
                  View Journal #{report.settlement.journalId}
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setShowUnpostConfirm(true)}
              >
                Unpost Settlement
              </Button>
            </div>
          </div>
        )}

        {/* Missing Rates Alert Banner */}
        {report && report.missingRateItemTypes.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 flex flex-wrap items-center justify-between gap-3 text-amber-950 dark:text-amber-100">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div>
                <div className="font-semibold text-sm">
                  Missing Commission Rates
                </div>
                <div className="text-xs text-muted-foreground dark:text-amber-300/80">
                  Sales items exist under:{' '}
                  <span className="font-medium">
                    {report.missingRateItemTypes.join(', ')}
                  </span>{' '}
                  with no rate configured (0% applied).
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs bg-background/80"
              onClick={() => setShowConfigSheet(true)}
            >
              Configure Rates Now
            </Button>
          </div>
        )}

        {/* Clean Executive Statement Card */}
        {report && (
          <Card className="shadow-none border overflow-hidden">
            <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/20">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-foreground">
                    {report.agentName}
                  </h2>
                  <Badge variant={report.settlement ? 'default' : 'outline'}>
                    {report.settlement
                      ? 'Settled & Posted'
                      : 'Draft Settlement'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Statement Period: {formatInvoiceDate(report.startDate)} to{' '}
                  {formatInvoiceDate(report.endDate)}
                </p>
                <div className="text-xs text-muted-foreground pt-1 flex items-center gap-3">
                  <span>
                    Total Sales Charged:{' '}
                    <strong className="text-foreground">
                      Rs. {formatMoney(report.totalCharged)}
                    </strong>
                  </span>
                  <span>•</span>
                  <span>
                    Units:{' '}
                    <strong className="text-foreground">
                      {report.totalQty.toLocaleString()}
                    </strong>
                  </span>
                  <span>•</span>
                  <span>
                    Invoices:{' '}
                    <strong className="text-foreground">
                      {invoicesList.length}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                    Net Commission Payable
                  </div>
                  <div className="text-2xl font-black font-mono text-primary mt-0.5">
                    Rs. {formatMoney(netCommission)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Gross Rs. {formatMoney(report.grossCommission)}{' '}
                    {totalAdjustments !== 0 && (
                      <span
                        className={getAdjustmentColorClass(totalAdjustments)}
                      >
                        ({totalAdjustments >= 0 ? '+' : ''}Rs.{' '}
                        {formatMoney(totalAdjustments)} adj)
                      </span>
                    )}
                  </div>
                </div>

                {!report.settlement && (
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-2 px-4 shadow-sm h-10"
                    onClick={() => setShowPostDialog(true)}
                    disabled={netCommission <= 0}
                  >
                    <BadgeCheck size={16} />
                    Post to Ledger
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Tabbed Navigation */}
        {report && (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="space-y-4"
          >
            <TabsList className="bg-muted/60 p-1">
              <TabsTrigger value="statement" className="gap-2 text-xs">
                <FileText size={14} />
                Statement Overview
              </TabsTrigger>
              <TabsTrigger value="by-invoice" className="gap-2 text-xs">
                <Layers size={14} />
                By Invoice ({invoicesList.length})
              </TabsTrigger>
              <TabsTrigger value="all-lines" className="gap-2 text-xs">
                <ListOrdered size={14} />
                All Line Items ({allLineItems.length})
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: Statement Overview */}
            <TabsContent value="statement" className="space-y-4">
              {/* Rate Tiers Table */}
              <Card className="shadow-none border">
                <CardHeader className="py-3 px-4 border-b bg-muted/10">
                  <CardTitle className="text-sm font-semibold">
                    Commission Earned by Tier
                  </CardTitle>
                </CardHeader>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-64">
                          Commission Tier / Item Type
                        </TableHead>
                        <TableHead className="w-40 whitespace-nowrap">
                          Rule Type
                        </TableHead>
                        <TableHead className="text-right w-24 whitespace-nowrap">
                          Units
                        </TableHead>
                        <TableHead className="text-right w-36 whitespace-nowrap">
                          Sales Charged
                        </TableHead>
                        <TableHead className="text-right w-36 whitespace-nowrap">
                          Commission Earned
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.buckets.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="text-center py-6 text-muted-foreground"
                          >
                            No sales invoices found for this agent in the
                            selected date range.
                          </TableCell>
                        </TableRow>
                      ) : (
                        report.buckets.map((bucket) => (
                          <TableRow key={bucket.key}>
                            <TableCell className="font-medium text-foreground">
                              {bucket.title}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <Badge
                                variant="secondary"
                                className="font-mono text-[11px] capitalize whitespace-nowrap"
                              >
                                {bucket.ruleType.replace('_', ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {bucket.totalQty.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              Rs. {formatMoney(bucket.totalCharged)}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold text-primary">
                              Rs. {formatMoney(bucket.totalCommission)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                    {report.buckets.length > 0 && (
                      <TableFooter>
                        <TableRow className="font-semibold text-foreground">
                          <TableCell colSpan={2}>
                            Gross Commission Subtotal
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {report.totalQty.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            Rs. {formatMoney(report.totalCharged)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-primary font-bold">
                            Rs. {formatMoney(report.grossCommission)}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    )}
                  </Table>
                </div>
              </Card>

              {/* Adjustments Section */}
              <Card className="shadow-none border">
                <CardHeader className="py-3 px-4 border-b bg-muted/10">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    <span>Manual Adjustments</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      Bilty freight deductions, travel allowances, advances
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {!report.settlement && (
                    <div className="flex flex-col sm:flex-row gap-2 items-end border rounded-md p-3 bg-muted/20">
                      <div className="flex-1 space-y-1">
                        <span className="text-xs font-medium">Description</span>
                        <Input
                          className="h-8 text-xs"
                          placeholder="e.g. Return freight bilty deduction, Consignment transport, Advance"
                          value={newAdjDesc}
                          onChange={(e) => setNewAdjDesc(e.target.value)}
                        />
                      </div>
                      <div className="w-full sm:w-36 space-y-1">
                        <span className="text-xs font-medium">
                          Amount (Rs.)
                        </span>
                        <Input
                          type="number"
                          step="1"
                          className="h-8 text-xs"
                          placeholder="-500 or 1000"
                          value={newAdjAmount}
                          onChange={(e) => setNewAdjAmount(e.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        onClick={handleAddAdjustment}
                      >
                        <Plus size={14} /> Add
                      </Button>
                    </div>
                  )}

                  {adjustments.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2 text-center">
                      No manual adjustments recorded for this period.
                    </div>
                  ) : (
                    <div className="border rounded-md overflow-hidden text-xs">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40">
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right w-36">
                              Amount (Rs.)
                            </TableHead>
                            <TableHead className="text-right w-20">
                              Action
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {adjustments.map((adj) => (
                            <TableRow key={adj.id}>
                              <TableCell className="font-medium">
                                {adj.description}
                              </TableCell>
                              <TableCell
                                className={`text-right font-mono font-semibold ${getAdjustmentColorClass(
                                  adj.amount,
                                )}`}
                              >
                                {adj.amount >= 0 ? '+' : ''}Rs.{' '}
                                {Math.round(adj.amount).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right">
                                {!report.settlement ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                    onClick={() =>
                                      handleRemoveAdjustment(adj.id)
                                    }
                                  >
                                    <Trash2 size={12} />
                                  </Button>
                                ) : (
                                  <span className="text-muted-foreground text-[10px]">
                                    Frozen
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        <TableFooter>
                          <TableRow className="font-semibold">
                            <TableCell>Total Adjustments</TableCell>
                            <TableCell
                              className={`text-right font-mono ${getAdjustmentColorClass(
                                totalAdjustments,
                              )}`}
                            >
                              {totalAdjustments >= 0 ? '+' : ''}Rs.{' '}
                              {Math.round(totalAdjustments).toLocaleString()}
                            </TableCell>
                            <TableCell />
                          </TableRow>
                        </TableFooter>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 2: By Invoice (Reconciliation View) */}
            <TabsContent value="by-invoice">
              <Card className="shadow-none border">
                <CardHeader className="py-3 px-4 border-b bg-muted/10">
                  <CardTitle className="text-sm font-semibold">
                    Commission Summary Grouped by Invoice
                  </CardTitle>
                </CardHeader>
                {invoicesList.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No invoices found in this period.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <TableVirtuoso
                      style={{ height: 'min(620px, 70vh)' }}
                      data={virtualInvoiceRows}
                      computeItemKey={(_idx, item) =>
                        item.type === 'invoice'
                          ? `inv_${item.invoice.invoiceId}`
                          : `detail_${item.invoice.invoiceId}`
                      }
                      components={virtuosoComponents}
                      fixedHeaderContent={renderInvoiceHeader}
                      itemContent={renderInvoiceItem}
                      fixedFooterContent={renderInvoiceFooter}
                    />
                  </div>
                )}
              </Card>
            </TabsContent>

            {/* TAB 3: All Line Items (Full Audit Log) */}
            <TabsContent value="all-lines">
              <Card className="shadow-none border">
                <CardHeader className="py-3 px-4 border-b bg-muted/10 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold">
                    Complete Item Lines Audit Log
                  </CardTitle>
                  <div className="flex items-center gap-2 w-72">
                    <Search size={14} className="text-muted-foreground" />
                    <Input
                      className="h-8 text-xs"
                      placeholder="Search customer, code, SKU, inv #..."
                      value={lineSearch}
                      onChange={(e) => setLineSearch(e.target.value)}
                    />
                  </div>
                </CardHeader>
                {filteredLines.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No matching line items found.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <TableVirtuoso
                      style={{ height: 'min(620px, 70vh)' }}
                      data={filteredLines}
                      computeItemKey={(idx, line) =>
                        `${line.invoiceId}_${line.inventoryId}_${line.rateType}_${line.quantity}_${idx}`
                      }
                      components={virtuosoComponents}
                      fixedHeaderContent={renderLineHeader}
                      itemContent={renderLineItem}
                      fixedFooterContent={renderLineFooter}
                    />
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Post to Ledger Dialog */}
      {report && (
        <PostSettlementDialog
          key={report.agentId}
          open={showPostDialog}
          onOpenChange={setShowPostDialog}
          report={report}
          adjustments={adjustments}
          accounts={accounts}
          onSuccess={() => {
            fetchReport();
          }}
        />
      )}

      {/* Unpost Confirmation Dialog */}
      <ConfirmDialog
        open={showUnpostConfirm}
        onOpenChange={setShowUnpostConfirm}
        title="Unpost Commission Settlement"
        description="This will delete the frozen settlement snapshot and remove the posted journal entry. You can review and re-post the settlement anytime. Are you sure?"
        confirmLabel={isUnposting ? 'Unposting...' : 'Yes, Unpost'}
        confirmVariant="destructive"
        onConfirm={handleUnpostSettlement}
      />

      {/* Rates & Settings Sheet */}
      <AgentCommissionSheet
        key={selectedChartId ?? 'settings'}
        open={showConfigSheet}
        onOpenChange={setShowConfigSheet}
        initialChartId={selectedChartId}
        charts={charts}
        accounts={accounts}
        onSaved={(savedChartId) => {
          if (savedChartId != null && savedChartId !== selectedChartId) {
            handleHeadChange(String(savedChartId));
          } else {
            fetchReport();
          }
        }}
      />
    </ReportLayout>
  );
};

export default AgentCommissionReportPage;
