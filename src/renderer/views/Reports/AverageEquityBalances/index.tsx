import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Card } from 'renderer/shad/ui/card';
import { Calendar as CalendarIcon, Printer, RefreshCw } from 'lucide-react';
import { Calendar } from 'renderer/shad/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'renderer/shad/ui/popover';
import { cn } from 'renderer/lib/utils';
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
    <>
      <style>{printStyles}</style>
      <div className="w-full mx-auto print-container">
        <div className="flex justify-between items-center mb-6 print-header">
          <h1 className="text-2xl font-semibold text-primary print:hidden">
            Average Equity Balances
          </h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground print:hidden">
                Start:
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-[200px] justify-start text-left font-normal print:hidden',
                      isLoading && 'opacity-70 cursor-not-allowed',
                    )}
                    disabled={isLoading}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(startDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={handleStartDateChange}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground print:hidden">
                End:
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-[200px] justify-start text-left font-normal print:hidden',
                      isLoading && 'opacity-70 cursor-not-allowed',
                    )}
                    disabled={isLoading}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(endDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={handleEndDateChange}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
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
              title="Print Average Equity Balances"
              className="print:hidden"
            >
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        </div>

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
      </div>
    </>
  );
};

export default AverageEquityBalancesPage;
