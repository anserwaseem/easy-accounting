import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Calendar as CalendarIcon, Printer } from 'lucide-react';
import { Calendar } from 'renderer/shad/ui/calendar';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from 'renderer/shad/ui/popover';
import { cn } from 'renderer/lib/utils';
import { Card } from 'renderer/shad/ui/card';
import { TrialBalanceTable } from './TrialBalanceTable';
import { useTrialBalance } from './useTrialBalance';
import { printStyles } from '../components';

const TrialBalancePage = () => {
  const { selectedDate, trialBalance, isLoading, handleDateChange } =
    useTrialBalance();

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <style>{printStyles}</style>
      <div className="w-full mx-auto print-container">
        <div className="flex justify-between items-center mb-6 print-header">
          <h1 className="text-2xl font-semibold text-primary print:hidden">
            Trial Balance
          </h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground print:hidden">
                As of:
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
                    {format(selectedDate, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={handleDateChange}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrint}
              title="Print Trial Balance"
              className="print:hidden"
            >
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Card className="p-6 shadow-md print-card">
          {!trialBalance.isBalanced && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive rounded-md text-sm text-destructive print:hidden">
              Trial balance is not balanced! Difference:{' '}
              {Math.abs(
                trialBalance.totalDebit - trialBalance.totalCredit,
              ).toFixed(2)}
            </div>
          )}

          <TrialBalanceTable
            trialBalance={trialBalance}
            isLoading={isLoading}
          />
        </Card>
      </div>
    </>
  );
};

export default TrialBalancePage;
