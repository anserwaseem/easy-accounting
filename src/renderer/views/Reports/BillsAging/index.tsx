import React, { useMemo, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Download, Printer, SlidersHorizontal, RefreshCw } from 'lucide-react';
import {
  getFormattedCurrencyInt,
  getFixedNumber,
  formatDaysDuration,
} from 'renderer/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/shad/ui/select';
import { Checkbox } from 'renderer/shad/ui/checkbox';
import { Label } from 'renderer/shad/ui/label';
import { Separator } from '@/renderer/shad/ui/separator';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from 'renderer/shad/ui/popover';
import {
  DateRange,
  DateRangePickerWithPresets,
} from 'renderer/shad/ui/datePicker';
import { ReportLayout } from 'renderer/components/ReportLayout';
import {
  exportReportToExcel,
  type ReportExportPayload,
} from 'renderer/lib/reportExport';
import { toast } from 'renderer/shad/ui/use-toast';
import VirtualMultiSelect from 'renderer/components/VirtualMultiSelect';
import {
  buildPartyTypingContext,
  getHeaderTypedSuffixFromCode,
} from 'renderer/views/NewInvoice/lib/partyAccountTyping';
import {
  useBillsAging,
  ALL_PARTIES_HEAD,
  type PartyOption,
} from './useBillsAging';
import { EmptyState, LoadingState, printStyles } from '../components';
import { BillsAgingTables } from './BillsAgingTables';
import {
  BillsAgingPrintTable,
  buildBillsAgingRows,
} from './BillsAgingPrintTable';
import { BillsAging, BillsAgingRow } from './types';

type BillsAgingExportRow = {
  accountCode?: number | string;
  headName?: string;
  billNumber: string;
  billDate: string;
  billPercentage: number | string;
  balance: number;
  daysStatus?: string;
};

const buildBillsAgingExportPayload = (
  billsAgingData: BillsAging,
  hideZero: boolean,
  hideStatus: boolean,
  selectedHead: string,
  selectedDate: Date,
): ReportExportPayload<BillsAgingExportRow> => {
  const rowsBase: BillsAgingRow[] = buildBillsAgingRows(
    billsAgingData,
    hideZero,
  );

  // all-parties exports carry the agent head so the per-agent split stays
  // readable — but only when the selection actually spans more than one head;
  // a single-head selection needs no Head column
  const distinctHeads = new Set(
    rowsBase.map((row) => row.headName).filter(Boolean),
  );
  const showHeadNames =
    selectedHead === ALL_PARTIES_HEAD && distinctHeads.size > 1;

  const rows: BillsAgingExportRow[] = rowsBase.map((row) => {
    let daysStatusText = '';
    if (!hideStatus && row.daysStatus) {
      const duration = formatDaysDuration(
        row.daysStatus.months,
        row.daysStatus.remainingDays,
      );
      daysStatusText = row.daysStatus.isFullyPaid
        ? `Cleared in ${duration}`
        : `Overdue by ${duration}`;
    }

    return {
      accountCode: row.accountCode,
      headName: showHeadNames ? row.headName : undefined,
      billNumber: row.billNumber,
      billDate: format(new Date(row.billDate), 'dd/MM/yy'),
      billPercentage: row.billPercentage,
      balance: row.balance,
      daysStatus: daysStatusText,
    };
  });

  const columns: ReportExportPayload<BillsAgingExportRow>['columns'] = [
    { key: 'accountCode', header: 'Account', format: 'string', width: 18 },
    ...(showHeadNames
      ? ([
          { key: 'headName', header: 'Head', format: 'string', width: 20 },
        ] as ReportExportPayload<BillsAgingExportRow>['columns'])
      : []),
    { key: 'billNumber', header: 'Bill #', format: 'string', width: 14 },
    { key: 'billDate', header: 'Bill Date', format: 'string', width: 12 },
    { key: 'billPercentage', header: '%', format: 'string', width: 8 },
    { key: 'balance', header: 'Balance', format: 'currency', width: 14 },
  ];

  if (!hideStatus) {
    columns.push({
      key: 'daysStatus',
      header: 'Days Status',
      format: 'string',
      width: 18,
    });
  }

  const title = 'Bills Aging';
  const subtitle = `Report for ${selectedHead} on ${format(
    selectedDate,
    'dd/MM/yy',
  )}`;

  return {
    title,
    subtitle,
    sheetName: 'Bills Aging',
    suggestedFileName: `Bills_Aging_${format(selectedDate, 'yyyy-MM-dd')}.xlsx`,
    columns,
    rows,
  };
};

const BillsAgingPage = () => {
  const {
    selectedHead,
    isAllParties,
    startDate,
    selectedDate,
    charts,
    itemTypes,
    billsAging,
    isLoading,
    handleHeadChange,
    handleStartDateChange,
    handleDateChange,
    refreshData,
    infoMessage,
    selectedCustomerIds,
    handleCustomerFilterChange,
    allPartiesOptions,
  } = useBillsAging();

  const [hideAllFilters, setHideAllFilters] = useState(false);
  const [hideZeroRows, setHideZeroRows] = useState(false);
  const [hideStatus, setHideStatus] = useState(false);
  const [hideNonPositiveOutstanding, setHideNonPositiveOutstanding] =
    useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // overdue follow-up filters
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>('all');
  const [agePreset, setAgePreset] = useState<string>('all');
  const [customDays, setCustomDays] = useState<string>('');
  const [discountPreset, setDiscountPreset] = useState<string>('all');
  const [customDiscount, setCustomDiscount] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('code');

  // build typing context for account variant filtering
  const typingContext = useMemo(() => {
    return buildPartyTypingContext(
      billsAging.accounts.map((a) => ({
        code: a.accountCode,
        name: a.accountName,
      })),
      itemTypes.map((t) => t.name),
    );
  }, [billsAging.accounts, itemTypes]);

  const getAccountTypeInfo = useCallback(
    (acc: { accountCode?: string | number; accountName?: string }) => {
      return getHeaderTypedSuffixFromCode(
        { code: acc.accountCode },
        typingContext,
      );
    },
    [typingContext],
  );

  const minDaysThreshold = useMemo(() => {
    if (agePreset === 'all') return 0;
    if (agePreset === 'custom') {
      const num = Number(customDays);
      return Number.isFinite(num) && num > 0 ? num : 0;
    }
    return Number(agePreset) || 0;
  }, [agePreset, customDays]);

  const discountFilterFn = useCallback(
    (billPercentage: number | string) => {
      if (discountPreset === 'all') return true;

      let numericPct: number | null = null;
      if (typeof billPercentage === 'number') {
        numericPct = billPercentage;
      } else if (typeof billPercentage === 'string') {
        const parsed = parseFloat(billPercentage.replace('%', '').trim());
        if (Number.isFinite(parsed)) numericPct = parsed;
      }

      const targetMin =
        discountPreset === 'custom'
          ? Number(customDiscount)
          : Number(discountPreset);
      if (!Number.isFinite(targetMin)) return true;
      return numericPct !== null && numericPct >= targetMin;
    },
    [discountPreset, customDiscount],
  );

  // all-parties searches the whole account pool (so a report need not be computed
  // first); a specific head keeps offering the accounts in its computed report
  const customerOptions = useMemo<PartyOption[]>(
    () =>
      isAllParties
        ? allPartiesOptions
        : billsAging.accounts.map((acc) => ({
            id: acc.accountId,
            name: acc.accountName,
            code: acc.accountCode,
          })),
    [isAllParties, allPartiesOptions, billsAging.accounts],
  );

  // same shop names recur across heads/cities, so all-parties labels carry
  // name + code + agent head to keep the options distinguishable
  const renderPartyOption = useCallback(
    (item: PartyOption) => (
      <div>
        <h2>
          {item.name}
          {item.code ? ` (${item.code})` : ''}
        </h2>
        {item.headName && (
          <p className="text-xs text-slate-400">{item.headName}</p>
        )}
      </div>
    ),
    [],
  );

  // Check how many filters are applied ('hide all' is just a shortcut for the toggles)
  const activeFilterCount =
    (hideZeroRows ? 1 : 0) +
    (hideStatus ? 1 : 0) +
    (hideNonPositiveOutstanding ? 1 : 0) +
    (selectedCustomerIds.length > 0 ? 1 : 0) +
    (accountTypeFilter !== 'all' ? 1 : 0) +
    (agePreset !== 'all' ? 1 : 0) +
    (discountPreset !== 'all' ? 1 : 0) +
    (sortBy !== 'code' ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  const handlePrint = () => {
    window.print();
  };

  const visibleAccounts = useMemo(() => {
    let filtered = billsAging.accounts;

    // filter by selected customers
    if (selectedCustomerIds.length > 0) {
      filtered = filtered.filter((acc) =>
        selectedCustomerIds.includes(acc.accountId),
      );
    }

    // filter by account variant / item type
    if (accountTypeFilter !== 'all') {
      if (accountTypeFilter === 'main') {
        filtered = filtered.filter(
          (acc) => !getAccountTypeInfo(acc).headerIsTyped,
        );
      } else {
        filtered = filtered.filter((acc) => {
          const info = getAccountTypeInfo(acc);
          return (
            info.headerIsTyped &&
            info.headerSuffix.toLowerCase() === accountTypeFilter.toLowerCase()
          );
        });
      }
    }

    // filter by non-positive outstanding
    if (hideNonPositiveOutstanding) {
      filtered = filtered.filter(
        (acc) =>
          getFixedNumber(acc.totalOutstanding - acc.totalUnallocated, 0) > 0,
      );
    }

    // filter bills within each account by overdue days and discount %
    const isOverdueFiltered = minDaysThreshold > 0;
    const isDiscountFiltered = discountPreset !== 'all';

    if (isOverdueFiltered || isDiscountFiltered) {
      filtered = filtered
        .map((acc) => {
          const matchingBills = acc.bills.filter((bill) => {
            if (isOverdueFiltered) {
              if (bill.daysStatus.isFullyPaid) return false;
              if (bill.daysStatus.days < minDaysThreshold) return false;
            }
            if (isDiscountFiltered) {
              if (!discountFilterFn(bill.billPercentage)) return false;
            }
            return true;
          });

          return {
            ...acc,
            bills: matchingBills,
          };
        })
        .filter((acc) => acc.bills.length > 0);
    }

    // sort visible accounts
    return [...filtered].sort((a, b) => {
      if (sortBy === 'due_desc') {
        const dueA = a.totalOutstanding - (a.totalUnallocated || 0);
        const dueB = b.totalOutstanding - (b.totalUnallocated || 0);
        if (dueB !== dueA) return dueB - dueA;
      } else if (sortBy === 'due_asc') {
        const dueA = a.totalOutstanding - (a.totalUnallocated || 0);
        const dueB = b.totalOutstanding - (b.totalUnallocated || 0);
        if (dueA !== dueB) return dueA - dueB;
      } else if (sortBy === 'overdue_desc') {
        const getMaxDays = (acc: typeof a) => {
          const unpaid = acc.bills.filter(
            (bill) => !bill.daysStatus.isFullyPaid,
          );
          if (unpaid.length === 0) return 0;
          return Math.max(...unpaid.map((bill) => bill.daysStatus.days));
        };
        const daysDiff = getMaxDays(b) - getMaxDays(a);
        if (daysDiff !== 0) return daysDiff;
      } else if (sortBy === 'discount_desc') {
        const getMaxDiscount = (acc: typeof a) => {
          if (acc.bills.length === 0) return 0;
          return Math.max(
            ...acc.bills.map((bill) => {
              if (typeof bill.billPercentage === 'number') {
                return bill.billPercentage;
              }
              if (typeof bill.billPercentage === 'string') {
                const parsed = parseFloat(
                  bill.billPercentage.replace('%', '').trim(),
                );
                return Number.isFinite(parsed) ? parsed : 0;
              }
              return 0;
            }),
          );
        };
        const discDiff = getMaxDiscount(b) - getMaxDiscount(a);
        if (discDiff !== 0) return discDiff;
      } else if (sortBy === 'name_asc') {
        const nameA = a.accountName?.toString()?.trim() || '';
        const nameB = b.accountName?.toString()?.trim() || '';
        const nameDiff = nameA.localeCompare(nameB, undefined, {
          sensitivity: 'base',
        });
        if (nameDiff !== 0) return nameDiff;
      }

      // default or fallback: sort by account code
      const codeA = a.accountCode?.toString()?.trim() || '';
      const codeB = b.accountCode?.toString()?.trim() || '';
      return codeA.localeCompare(codeB, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
  }, [
    billsAging.accounts,
    selectedCustomerIds,
    accountTypeFilter,
    getAccountTypeInfo,
    hideNonPositiveOutstanding,
    minDaysThreshold,
    discountPreset,
    discountFilterFn,
    sortBy,
  ]);

  const canExport = !isLoading && visibleAccounts.length > 0;

  const handleExportExcel = useCallback(() => {
    try {
      const payload = buildBillsAgingExportPayload(
        {
          ...billsAging,
          accounts: visibleAccounts,
        },
        hideZeroRows,
        hideStatus,
        selectedHead,
        selectedDate,
      );
      exportReportToExcel(payload);
      toast({
        title: 'Success',
        description: 'Bills aging exported to Excel.',
        variant: 'success',
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Error',
        description: 'Failed to export bills aging to Excel.',
        variant: 'destructive',
      });
    }
  }, [
    billsAging,
    visibleAccounts,
    hideZeroRows,
    hideStatus,
    selectedHead,
    selectedDate,
  ]);

  // head tags (screen + print) only earn their place when the selection spans
  // more than one head; a single-head selection reads simpler without them
  const selectionSpansHeads = useMemo(
    () =>
      isAllParties &&
      new Set(visibleAccounts.map((acc) => acc.headName || 'Other')).size > 1,
    [isAllParties, visibleAccounts],
  );

  const tableProps = useMemo(
    () => ({
      billsAging: {
        ...billsAging,
        accounts: visibleAccounts,
      },
      hideZeroRows,
      hideStatus,
      // on screen the head is always useful context under All parties;
      // print/export apply the spans-more-than-one-head rule instead
      showHeadNames: isAllParties,
    }),
    [billsAging, visibleAccounts, hideZeroRows, hideStatus, isAllParties],
  );

  // all-parties scope: outstanding per agent head, shown when the current
  // selection spans more than one head so the per-agent split stays visible
  const headSubtotals = useMemo(() => {
    if (!isAllParties) return [];
    const totals = new Map<string, number>();
    visibleAccounts.forEach((acc) => {
      const head = acc.headName || 'Other';
      totals.set(
        head,
        (totals.get(head) ?? 0) + (acc.totalOutstanding - acc.totalUnallocated),
      );
    });
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [isAllParties, visibleAccounts]);

  // Calculate total for header display
  const totalOutstanding = visibleAccounts.reduce(
    (sum, acc) => sum + (acc.totalOutstanding - acc.totalUnallocated),
    0,
  );
  const totalColor =
    getFixedNumber(
      visibleAccounts.reduce(
        (sum, acc) =>
          sum + (acc.totalOutstanding - (acc.totalUnallocated || 0)),
        0,
      ),
      0,
    ) <= 0
      ? 'text-green-600'
      : 'text-red-600';

  return (
    <ReportLayout
      printStyles={printStyles}
      bodyClassName={
        visibleAccounts.length > 10
          ? 'overflow-hidden h-full flex flex-col py-2'
          : 'py-2'
      }
      header={
        <div className="print-header flex flex-col gap-2.5 pb-2">
          {/* Row 1: Title, Summary KPI & Action Buttons */}
          <div className="flex flex-wrap justify-between items-center gap-3 pb-1 border-b border-border/40">
            <div className="flex items-center gap-3">
              <h1 className="title-new text-2xl font-bold tracking-tight">
                Bills Aging
              </h1>
              {!isLoading && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border">
                  {visibleAccounts.length}{' '}
                  {visibleAccounts.length === 1 ? 'account' : 'accounts'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {!isLoading && visibleAccounts.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-card/80 shadow-xs text-sm">
                  <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                    Total Outstanding:
                  </span>
                  <span
                    className={`font-bold font-mono text-base ${totalColor}`}
                  >
                    {getFormattedCurrencyInt(totalOutstanding, {
                      withoutCurrency: true,
                    })}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-1.5">
                <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant={hasActiveFilters ? 'secondary' : 'outline'}
                      className="gap-2"
                      aria-expanded={filtersOpen}
                      title="Filters"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      Filters
                      {activeFilterCount > 0 && (
                        <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                          {activeFilterCount}
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-60">
                    <div className="flex flex-col gap-3 py-1">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Checkbox
                          id="toggle-hide-all"
                          checked={hideAllFilters}
                          onCheckedChange={(v) => {
                            const next = Boolean(v);
                            setHideAllFilters(next);
                            setHideStatus(next);
                            setHideZeroRows(next);
                            setHideNonPositiveOutstanding(next);
                          }}
                        />
                        <Label
                          htmlFor="toggle-hide-all"
                          className="font-medium cursor-pointer"
                        >
                          Hide all
                        </Label>
                      </div>
                      <Separator />
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Checkbox
                          id="toggle-hide-status"
                          checked={hideStatus}
                          onCheckedChange={(v) => {
                            const next = Boolean(v);
                            const nextHideAllFilters =
                              next &&
                              hideZeroRows &&
                              hideNonPositiveOutstanding;
                            setHideStatus(next);
                            setHideAllFilters(nextHideAllFilters);
                          }}
                        />
                        <Label
                          htmlFor="toggle-hide-status"
                          className="cursor-pointer"
                        >
                          Hide status
                        </Label>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Checkbox
                          id="toggle-hide-zero"
                          checked={hideZeroRows}
                          onCheckedChange={(v) => {
                            const next = Boolean(v);
                            const nextHideAllFilters =
                              hideStatus && next && hideNonPositiveOutstanding;
                            setHideZeroRows(next);
                            setHideAllFilters(nextHideAllFilters);
                          }}
                        />
                        <Label
                          htmlFor="toggle-hide-zero"
                          className="cursor-pointer"
                        >
                          Hide settled bills
                        </Label>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Checkbox
                          id="toggle-hide-negative"
                          checked={hideNonPositiveOutstanding}
                          onCheckedChange={(v) => {
                            const next = Boolean(v);
                            const nextHideAllFilters =
                              hideStatus && hideZeroRows && next;
                            setHideNonPositiveOutstanding(next);
                            setHideAllFilters(nextHideAllFilters);
                          }}
                        />
                        <Label
                          htmlFor="toggle-hide-negative"
                          className="cursor-pointer"
                        >
                          Hide settled accounts
                        </Label>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={refreshData}
                  title="Refresh Data"
                  disabled={isLoading}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                  />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleExportExcel}
                  title="Export Bills Aging"
                  disabled={canExport === false}
                >
                  <Download className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handlePrint}
                  title="Print Bills Aging"
                >
                  <Printer className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Row 2: Filter Controls Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <VirtualMultiSelect
              options={customerOptions}
              value={selectedCustomerIds}
              onChange={(ids) =>
                handleCustomerFilterChange(ids.map((id) => Number(id)))
              }
              placeholder="All customers"
              searchPlaceholder="Search customers..."
              searchFields={
                isAllParties ? ['name', 'code', 'headName'] : undefined
              }
              renderSelectItem={isAllParties ? renderPartyOption : undefined}
              disabled={!customerOptions.length}
            />
            <Select value={selectedHead} onValueChange={handleHeadChange}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Select head" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PARTIES_HEAD}>
                  {ALL_PARTIES_HEAD}
                </SelectItem>
                {charts.map((chart) => (
                  <SelectItem key={chart.id} value={chart.name}>
                    {chart.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={accountTypeFilter}
              onValueChange={setAccountTypeFilter}
            >
              <SelectTrigger className="w-[155px]">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="main">Base</SelectItem>
                {itemTypes.map((type) => (
                  <SelectItem key={type.id} value={type.name}>
                    Type {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Select value={agePreset} onValueChange={setAgePreset}>
                <SelectTrigger className="w-[135px]">
                  <SelectValue placeholder="Overdue Age" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Overdue</SelectItem>
                  <SelectItem value="30">&gt; 30 Days</SelectItem>
                  <SelectItem value="45">&gt; 45 Days</SelectItem>
                  <SelectItem value="60">&gt; 60 Days (2M)</SelectItem>
                  <SelectItem value="90">&gt; 90 Days (3M)</SelectItem>
                  <SelectItem value="180">&gt; 180 Days (6M)</SelectItem>
                  <SelectItem value="365">&gt; 1 Year</SelectItem>
                  <SelectItem value="custom">Custom Days</SelectItem>
                </SelectContent>
              </Select>
              {agePreset === 'custom' && (
                <input
                  type="number"
                  min="1"
                  placeholder="Days"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  className="w-16 h-9 px-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              )}
            </div>
            <div className="flex items-center gap-1">
              <Select value={discountPreset} onValueChange={setDiscountPreset}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Discount %" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Discounts</SelectItem>
                  <SelectItem value="15">≥ 15%</SelectItem>
                  <SelectItem value="20">≥ 20%</SelectItem>
                  <SelectItem value="22">≥ 22%</SelectItem>
                  <SelectItem value="25">≥ 25%</SelectItem>
                  <SelectItem value="28">≥ 28%</SelectItem>
                  <SelectItem value="30">≥ 30%</SelectItem>
                  <SelectItem value="custom">Custom %</SelectItem>
                </SelectContent>
              </Select>
              {discountPreset === 'custom' && (
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="Min %"
                  value={customDiscount}
                  onChange={(e) => setCustomDiscount(e.target.value)}
                  className="w-16 h-9 px-2 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              )}
            </div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[155px]">
                <SelectValue placeholder="Sort By" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="code">Code (Default)</SelectItem>
                <SelectItem value="due_desc">Due: Highest First</SelectItem>
                <SelectItem value="due_asc">Due: Lowest First</SelectItem>
                <SelectItem value="overdue_desc">
                  Overdue: Oldest First
                </SelectItem>
                <SelectItem value="discount_desc">
                  Discount: Highest First
                </SelectItem>
                <SelectItem value="name_asc">Name (A–Z)</SelectItem>
              </SelectContent>
            </Select>
            <DateRangePickerWithPresets
              initialRange={{ from: startDate, to: selectedDate }}
              $onSelect={(range?: DateRange) => {
                if (range?.from) handleStartDateChange(range.from);
                if (range?.to) handleDateChange(range.to);
              }}
            />
          </div>

          {/* Row 3: Agent Subtotals Chips (under All Parties) */}
          {!isLoading && isAllParties && headSubtotals.length > 1 && (
            <div className="print:hidden flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider mr-1">
                By Head:
              </span>
              {headSubtotals.map(([head, amount]) => (
                <div
                  key={head}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-muted/60 border border-border/60 text-xs"
                >
                  <span className="text-muted-foreground font-medium">
                    {head}:
                  </span>
                  <span className="font-semibold font-mono text-foreground">
                    {getFormattedCurrencyInt(amount, {
                      withoutCurrency: true,
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      }
    >
      {/* Title that shows when printing */}
      <div className="hidden print:block mb-4 print-header">
        <h1 className="text-left font-black text-2xl mb-1">
          Report for {selectedHead} on {format(selectedDate, 'dd/MM/yy')}
        </h1>
      </div>

      {/* eslint-disable-next-line no-nested-ternary */}
      {isLoading ? (
        <LoadingState variant="skeleton" />
      ) : visibleAccounts.length === 0 ? (
        <EmptyState
          message={
            infoMessage ||
            (isAllParties
              ? 'No accounts found for the selected customers.'
              : 'No accounts found for this head.')
          }
        />
      ) : (
        <React.Fragment
          key={`bills-aging-${selectedCustomerIds.join('-')}-${
            visibleAccounts.length
          }`}
        >
          {/* Screen Display - Original Complex Layout */}
          <div className="print:hidden h-full flex-1">
            <BillsAgingTables {...tableProps} />
          </div>

          {/* Print Display - Flat Excel-like Table */}
          <div className="hidden print:block" aria-hidden="true">
            <BillsAgingPrintTable
              {...{
                ...tableProps,
                hideStatus,
                showHeadNames: selectionSpansHeads,
              }}
            />
          </div>
        </React.Fragment>
      )}
    </ReportLayout>
  );
};

export default BillsAgingPage;
