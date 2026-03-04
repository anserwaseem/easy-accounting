import { useCallback } from 'react';
import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Card } from 'renderer/shad/ui/card';
import { Download, Printer, RefreshCw } from 'lucide-react';
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
): ReportExportPayload<AverageEquityRow> => ({
  title: 'Average Equity Balances',
  subtitle: `${format(startDate, 'PPP')} to ${format(endDate, 'PPP')}`,
  sheetName: 'Average Equity Balances',
  suggestedFileName: `Average_Equity_Balances_${format(
    startDate,
    'yyyy-MM-dd',
  )}_${format(endDate, 'yyyy-MM-dd')}.xlsx`,
  columns: [
    { key: 'code', header: 'Account Code', format: 'string', width: 14 },
    { key: 'name', header: 'Account Name', format: 'string', width: 32 },
    {
      key: 'averageBalance',
      header: 'Average Balance',
      format: 'currency',
      width: 16,
    },
    { key: 'balanceType', header: 'Type', format: 'string', width: 8 },
  ],
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
});

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

  const handlePrint = () => window.print();

  const handleExportExcel = useCallback(() => {
    try {
      const payload = buildAverageEquityPayload(
        { ...state, items: sortItems(state.items) },
        startDate,
        endDate,
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
  }, [state, startDate, endDate, sortItems]);

  const canExport = !isLoading && state.items.length > 0;

  return (
    <ReportLayout
      printStyles={printStyles}
      header={
        <div className="flex justify-between items-center pb-2 print-header">
          <h1 className="text-2xl font-semibold text-primary">
            Average Equity Balances
          </h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Period:</span>
              <DateRangePickerWithPresets
                initialRange={{ from: startDate, to: endDate }}
                $onSelect={(range?: DateRange) => {
                  if (range?.from) handleStartDateChange(range.from);
                  if (range?.to) handleEndDateChange(range.to);
                }}
              />
            </div>
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
          </div>
        </div>
      }
    >
      {/* Title that shows when printing */}
      <div className="hidden print:block text-center mb-4 print-header">
        <h1 className="text-lg font-medium text-center mb-1">
          Average Equity Balances from {format(startDate, 'PPP')} to{' '}
          {format(endDate, 'PPP')}
        </h1>
      </div>

      <Card className="p-6 shadow-md print-card">
        <AverageEquityBalancesTable
          items={sortedItems}
          totalAverage={state.totalAverage}
          isLoading={isLoading}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
        />
      </Card>
    </ReportLayout>
  );
};

export default AverageEquityBalancesPage;
