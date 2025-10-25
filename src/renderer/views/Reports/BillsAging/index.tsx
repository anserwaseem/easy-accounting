import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Printer, SlidersHorizontal, RefreshCw } from 'lucide-react';
import { getFormattedCurrencyInt, getFixedNumber } from 'renderer/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/shad/ui/select';
import { Checkbox } from 'renderer/shad/ui/checkbox';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from 'renderer/shad/ui/popover';
import {
  DateRange,
  DateRangePickerWithPresets,
} from 'renderer/shad/ui/datePicker';
import { useBillsAging } from './useBillsAging';
import { EmptyState, LoadingState, printStyles } from '../components';
import { BillsAgingTables } from './BillsAgingTables';
import { BillsAgingPrintTable } from './BillsAgingPrintTable';

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
  } = useBillsAging();

  const [hideZeroRows, setHideZeroRows] = useState(false);
  const [hideStatus, setHideStatus] = useState(false);
  const [hideNonPositiveOutstanding, setHideNonPositiveOutstanding] =
    useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Check if any filter is applied
  const hasActiveFilters =
    hideZeroRows || hideStatus || hideNonPositiveOutstanding;

  const handlePrint = () => {
    window.print();
  };

  const visibleAccounts = useMemo(
    () =>
      hideNonPositiveOutstanding
        ? billsAging.accounts.filter(
            (acc) => acc.totalOutstanding - acc.totalUnallocated > 0,
          )
        : billsAging.accounts,
    [billsAging.accounts, hideNonPositiveOutstanding],
  );

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

  return (
    <>
      <style>{printStyles}</style>
      <div className="w-full max-w-full mx-auto print-container">
        <div className="flex justify-between items-center mb-6 print-header">
          <h1 className="text-2xl font-semibold text-primary print:hidden">
            Bills Aging
          </h1>
          <div className="print:hidden flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Head:</span>
              <Select value={selectedHead} onValueChange={handleHeadChange}>
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder="Select a head" />
                </SelectTrigger>
                <SelectContent>
                  {charts.map((chart) => (
                    <SelectItem key={chart.id} value={chart.name}>
                      {chart.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Period:</span>
              <DateRangePickerWithPresets
                initialRange={{ from: startDate, to: selectedDate }}
                $onSelect={(range?: DateRange) => {
                  if (range?.from) handleStartDateChange(range.from);
                  if (range?.to) handleDateChange(range.to);
                }}
              />
            </div>
            <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
              <div
                onMouseEnter={() => setFiltersOpen(true)}
                onMouseLeave={() => setFiltersOpen(false)}
                className="print:hidden relative"
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
                <PopoverContent className="w-52 -mt-1">
                  <div className="flex flex-col gap-3 py-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        id="toggle-hide-status"
                        checked={hideStatus}
                        onCheckedChange={(v) => setHideStatus(Boolean(v))}
                        aria-labelledby="lbl-hide-status"
                      />
                      <span id="lbl-hide-status">Hide status</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        id="toggle-hide-zero"
                        checked={hideZeroRows}
                        onCheckedChange={(v) => setHideZeroRows(Boolean(v))}
                        aria-labelledby="lbl-hide-zero"
                      />
                      <span id="lbl-hide-zero">Hide settled bills</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        id="toggle-hide-negative"
                        checked={hideNonPositiveOutstanding}
                        onCheckedChange={(v) =>
                          setHideNonPositiveOutstanding(Boolean(v))
                        }
                        aria-labelledby="lbl-hide-negative"
                      />
                      <span id="lbl-hide-negative">Hide settled accounts</span>
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
              className="print:hidden"
              disabled={isLoading}
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
              />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrint}
              title="Print Bills Aging"
              className="print:hidden"
            >
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        </div>

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
          <React.Fragment key="bills-aging-content">
            {/* overall outstanding total for all currently displayed accounts */}
            <div className="print:hidden mb-2 text-right text-sm text-muted-foreground">
              Total Outstanding (all accounts):{' '}
              <span
                className={`font-semibold ${
                  getFixedNumber(
                    visibleAccounts.reduce(
                      (sum, acc) =>
                        sum +
                        (acc.totalOutstanding - (acc.totalUnallocated || 0)),
                      0,
                    ),
                    0,
                  ) <= 0
                    ? 'text-green-600'
                    : 'text-red-600'
                }`}
              >
                {getFormattedCurrencyInt(
                  visibleAccounts.reduce(
                    (sum, acc) =>
                      sum + (acc.totalOutstanding - acc.totalUnallocated),
                    0,
                  ),
                  { withoutCurrency: true },
                )}
              </span>
            </div>

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
      </div>
    </>
  );
};

export default BillsAgingPage;
