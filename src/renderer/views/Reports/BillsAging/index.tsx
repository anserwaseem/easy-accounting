import React, { useMemo, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Download, Printer, SlidersHorizontal, RefreshCw } from 'lucide-react';
import { getFormattedCurrencyInt, getFixedNumber } from 'renderer/lib/utils';
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
import { useBillsAging } from './useBillsAging';
import { EmptyState, LoadingState, printStyles } from '../components';
import { BillsAgingTables } from './BillsAgingTables';
import {
  BillsAgingPrintTable,
  buildBillsAgingRows,
} from './BillsAgingPrintTable';
import { BillsAging, BillsAgingRow } from './types';

type BillsAgingExportRow = {
  accountCode?: number | string;
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

  const rows: BillsAgingExportRow[] = rowsBase.map((row) => {
    let daysStatusText = '';
    if (!hideStatus && row.daysStatus) {
      daysStatusText = row.daysStatus.isFullyPaid
        ? `Cleared in ${row.daysStatus.days} days`
        : `Overdue by ${row.daysStatus.days} days`;
    }

    return {
      accountCode: row.accountCode,
      billNumber: row.billNumber,
      billDate: format(new Date(row.billDate), 'dd/MM/yy'),
      billPercentage: row.billPercentage,
      balance: row.balance,
      daysStatus: daysStatusText,
    };
  });

  const columns: ReportExportPayload<BillsAgingExportRow>['columns'] = [
    { key: 'accountCode', header: 'Account', format: 'string', width: 18 },
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
    startDate,
    selectedDate,
    charts,
    billsAging,
    isLoading,
    handleHeadChange,
    handleStartDateChange,
    handleDateChange,
    refreshData,
    infoMessage,
    selectedCustomerIds,
    handleCustomerFilterChange,
  } = useBillsAging();

  const [hideAllFilters, setHideAllFilters] = useState(false);
  const [hideZeroRows, setHideZeroRows] = useState(false);
  const [hideStatus, setHideStatus] = useState(false);
  const [hideNonPositiveOutstanding, setHideNonPositiveOutstanding] =
    useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // get available customers from billsAging accounts
  const customerOptions = useMemo(
    () =>
      billsAging.accounts.map((acc) => ({
        id: acc.accountId,
        name: acc.accountName,
        code: acc.accountCode,
      })),
    [billsAging.accounts],
  );

  // Check if any filter is applied
  const hasActiveFilters =
    hideAllFilters ||
    hideZeroRows ||
    hideStatus ||
    hideNonPositiveOutstanding ||
    selectedCustomerIds.length > 0;

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

    // filter by non-positive outstanding
    if (hideNonPositiveOutstanding) {
      filtered = filtered.filter(
        (acc) =>
          getFixedNumber(acc.totalOutstanding - acc.totalUnallocated, 0) > 0,
      );
    }

    return filtered;
  }, [billsAging.accounts, selectedCustomerIds, hideNonPositiveOutstanding]);

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

  const tableProps = useMemo(
    () => ({
      billsAging: {
        ...billsAging,
        accounts: visibleAccounts,
      },
      hideZeroRows,
      hideStatus,
    }),
    [billsAging, visibleAccounts, hideZeroRows, hideStatus],
  );
  console.log('tableProps', visibleAccounts, tableProps);

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
      header={
        <div className="print-header flex flex-col gap-2 pb-2">
          <div className="flex justify-between items-center pb-2">
            {/* Title */}
            <h1 className="text-2xl font-semibold text-primary">Bills Aging</h1>
            {/* Filters Section */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Primary Filters - Compact without labels */}
              <div className="flex items-center gap-3">
                <Select value={selectedHead} onValueChange={handleHeadChange}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select head" />
                  </SelectTrigger>
                  <SelectContent>
                    {charts.map((chart) => (
                      <SelectItem key={chart.id} value={chart.name}>
                        {chart.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <DateRangePickerWithPresets
                  initialRange={{ from: startDate, to: selectedDate }}
                  $onSelect={(range?: DateRange) => {
                    if (range?.from) handleStartDateChange(range.from);
                    if (range?.to) handleDateChange(range.to);
                  }}
                />
                <VirtualMultiSelect
                  options={customerOptions}
                  value={selectedCustomerIds}
                  onChange={(ids) =>
                    handleCustomerFilterChange(ids.map((id) => Number(id)))
                  }
                  placeholder="All customers"
                  searchPlaceholder="Search customers..."
                  disabled={!customerOptions.length}
                />
              </div>
              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
                  <div
                    onMouseEnter={() => setFiltersOpen(true)}
                    onMouseLeave={() => setFiltersOpen(false)}
                    className="relative"
                  >
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="gap-2">
                        <SlidersHorizontal className="h-4 w-4" />
                        Filters
                      </Button>
                    </PopoverTrigger>
                    {hasActiveFilters && (
                      <div className="absolute -top-1 -right-1 h-3 w-3 bg-blue-500 rounded-full border-2 border-background" />
                    )}
                    <PopoverContent className="w-56 -mt-1">
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
                                hideStatus &&
                                next &&
                                hideNonPositiveOutstanding;
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
                  </div>
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

          {/* Total Outstanding - FIXED in header */}
          {!isLoading && visibleAccounts.length > 0 && (
            <div className="print:hidden text-right text-sm text-muted-foreground">
              Total Outstanding (all accounts):{' '}
              <span className={`font-semibold ${totalColor}`}>
                {getFormattedCurrencyInt(totalOutstanding, {
                  withoutCurrency: true,
                })}
              </span>
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
          message={infoMessage || 'No accounts found for this head.'}
        />
      ) : (
        <React.Fragment
          key={`bills-aging-${selectedCustomerIds.join('-')}-${
            visibleAccounts.length
          }`}
        >
          {/* Screen Display - Original Complex Layout */}
          <div className="print:hidden">
            <BillsAgingTables {...tableProps} />
          </div>

          {/* Print Display - Flat Excel-like Table */}
          <div className="hidden print:block">
            <BillsAgingPrintTable {...{ ...tableProps, hideStatus }} />
          </div>
        </React.Fragment>
      )}
    </ReportLayout>
  );
};

export default BillsAgingPage;
