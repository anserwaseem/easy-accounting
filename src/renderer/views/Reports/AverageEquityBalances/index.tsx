import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Card } from 'renderer/shad/ui/card';
import { Printer, RefreshCw } from 'lucide-react';
import {
  DateRange,
  DateRangePickerWithPresets,
} from 'renderer/shad/ui/datePicker';
import { ReportLayout } from 'renderer/components/ReportLayout';
import { printStyles } from '../components';
import { useAverageEquityBalances } from './useAverageEquityBalances';
import { AverageEquityBalancesTable } from './AverageEquityBalancesTable';

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

  const handlePrint = () => window.print();

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
        <AverageEquityBalancesTable data={state} isLoading={isLoading} />
      </Card>
    </ReportLayout>
  );
};

export default AverageEquityBalancesPage;
