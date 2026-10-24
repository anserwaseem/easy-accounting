import { useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Card } from 'renderer/shad/ui/card';
import { Download, Printer, RefreshCw } from 'lucide-react';
import {
  DateRange,
  DateRangePickerWithPresets,
} from 'renderer/shad/ui/datePicker';
import { ReportLayout } from 'renderer/components/ReportLayout';
import { ReportFilter, ReportHeader } from '@/renderer/components/ReportHeader';
import { ReportColumnsMenu } from '@/renderer/components/ReportColumnsMenu';
import { useReportColumnVisibility } from '@/renderer/hooks/useReportColumnVisibility';
import {
  exportReportToExcel,
  type ReportExportPayload,
} from 'renderer/lib/reportExport';
import { toast } from 'renderer/shad/ui/use-toast';
import { formatDisplayDate } from '@/lib/displayDate';
import { useSorting, printStyles } from '../components';
import type {
  AverageEquityBalancesState,
  AverageEquityBalanceItem,
  AverageEquitySortField,
} from './types';
import { useAverageEquityBalances } from './useAverageEquityBalances';
import { AverageEquityBalancesTable } from './AverageEquityBalancesTable';

type AverageEquityRow = {
  code: string | number;
  name: string;
  averageBalance: number;
  balanceType: string;
};

const buildAverageEquityPayload = (
  state: AverageEquityBalancesState,
  startDate: Date,
  endDate: Date,
  visibleColumns?: ReadonlySet<string>,
): ReportExportPayload<AverageEquityRow> => {
  const visible =
    visibleColumns ??
    new Set(['code', 'name', 'averageBalance', 'balanceType']);
  const columns = [
    {
      key: 'code',
      header: 'Account Code',
      format: 'string' as const,
      width: 14,
    },
    {
      key: 'name',
      header: 'Account Name',
      format: 'string' as const,
      width: 32,
    },
    {
      key: 'averageBalance',
      header: 'Average Balance',
      format: 'currency' as const,
      width: 16,
    },
    { key: 'balanceType', header: 'Type', format: 'string' as const, width: 8 },
  ].filter((column) =>
    visible.has(String(column.key)),
  ) as ReportExportPayload<AverageEquityRow>['columns'];
  return {
    title: 'Average Equity Balances',
    subtitle: `${formatDisplayDate(startDate)} to ${formatDisplayDate(
      endDate,
    )}`,
    sheetName: 'Average Equity Balances',
    suggestedFileName: `Average_Equity_Balances_${format(
      startDate,
      'yyyy-MM-dd',
    )}_${format(endDate, 'yyyy-MM-dd')}.xlsx`,
    columns,
    rows: state.items.map((item: AverageEquityBalanceItem) => ({
      code: item.code ?? '',
      name: item.name,
      averageBalance: Math.abs(item.averageBalance),
      balanceType: item.averageBalance >= 0 ? 'Cr' : 'Dr',
    })),
    footerRow:
      state.totalAverage != null
        ? {
            code: '',
            name: 'Net Average',
            averageBalance: Math.abs(state.totalAverage),
            balanceType: state.totalAverage >= 0 ? 'Cr' : 'Dr',
          }
        : undefined,
  };
};

const AverageEquityBalancesPage = () => {
  const {
    startDate,
    endDate,
    state,
    isLoading,
    handleStartDateChange,
    handleEndDateChange,
    handleRefresh,
  } = useAverageEquityBalances();

  const { sortField, sortDirection, handleSort, sortItems } = useSorting<
    AverageEquityBalanceItem,
    AverageEquitySortField
  >({
    initialSortField: 'averageBalance',
    initialSortDirection: 'desc',
  });

  const sortedItems = sortItems(state.items);

  const averageEquityColumnSpecs = useMemo(
    () => [
      { id: 'code', label: 'Account Code' },
      { id: 'name', label: 'Account Name' },
      { id: 'averageBalance', label: 'Average Balance' },
      { id: 'balanceType', label: 'Type' },
    ],
    [],
  );
  const averageEquityColumnIds = useMemo(
    () => averageEquityColumnSpecs.map((column) => column.id),
    [averageEquityColumnSpecs],
  );
  const columnVisibility = useReportColumnVisibility(
    'average-equity-balances',
    averageEquityColumnIds,
  );
  const visibleAverageEquityColumns = columnVisibility.included;

  const handlePrint = () => window.print();

  const handleExportExcel = useCallback(() => {
    try {
      const payload = buildAverageEquityPayload(
        { ...state, items: sortItems(state.items) },
        startDate,
        endDate,
        visibleAverageEquityColumns,
      );
      exportReportToExcel(payload);
      toast({
        title: 'Success',
        description: 'Average equity balances exported to Excel.',
        variant: 'success',
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Error',
        description: 'Failed to export average equity balances to Excel.',
        variant: 'destructive',
      });
    }
  }, [state, startDate, endDate, sortItems, visibleAverageEquityColumns]);

  const canExport = !isLoading && state.items.length > 0;

  return (
    <ReportLayout
      printStyles={printStyles}
      header={
        <ReportHeader
          title="Average Equity Balances"
          filters={
            <ReportFilter label="Period:">
              <DateRangePickerWithPresets
                initialRange={{ from: startDate, to: endDate }}
                $onSelect={(range?: DateRange) => {
                  if (range?.from) handleStartDateChange(range.from);
                  if (range?.to) handleEndDateChange(range.to);
                }}
              />
            </ReportFilter>
          }
          actions={
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefresh}
                title="Refresh Data"
                disabled={isLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                />
              </Button>
              <ReportColumnsMenu
                columns={averageEquityColumnSpecs}
                included={columnVisibility.included}
                onToggle={columnVisibility.toggle}
                onToggleAll={columnVisibility.toggleAll}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleExportExcel}
                title="Export to Excel"
                disabled={!canExport}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrint}
                title="Print Average Equity Balances"
              >
                <Printer className="h-4 w-4" />
              </Button>
            </>
          }
        />
      }
    >
      {/* Title that shows when printing */}
      <div className="hidden print:block text-center mb-4 print-header">
        <h1 className="text-lg font-medium text-center mb-1">
          Average Equity Balances from {formatDisplayDate(startDate)} to{' '}
          {formatDisplayDate(endDate)}
        </h1>
      </div>

      <Card className="shadow-md print-card">
        <AverageEquityBalancesTable
          items={sortedItems}
          totalAverage={state.totalAverage}
          isLoading={isLoading}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          visibleColumns={visibleAverageEquityColumns}
        />
      </Card>
    </ReportLayout>
  );
};

export default AverageEquityBalancesPage;
