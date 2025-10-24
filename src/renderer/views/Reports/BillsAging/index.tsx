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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/shad/ui/select';
import { useBillsAging } from './useBillsAging';
import { BillsAgingTable } from './BillsAgingTable';
import { printStyles } from '../components';

const BillsAgingPage = () => {
  const {
    selectedHead,
    selectedDate,
    charts,
    billsAging,
    isLoading,
    handleHeadChange,
    handleDateChange,
  } = useBillsAging();

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <style>{printStyles}</style>
      <div className="w-full mx-auto print-container">
        <div className="flex justify-between items-center mb-6 print-header">
          <h1 className="text-2xl font-semibold text-primary print:hidden">
            Bills Aging
          </h1>
          <div className="print:hidden flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Head:</span>
              <Select value={selectedHead} onValueChange={handleHeadChange}>
                <SelectTrigger className="w-[250px]">
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
              <span className="text-sm text-muted-foreground">As of:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-[200px] justify-start text-left font-normal',
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
              title="Print Bills Aging"
              className="print:hidden"
            >
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Title that shows when printing */}
        <div className="hidden print:block text-center mb-4 print-header">
          <h1 className="text-lg font-medium text-center mb-1">
            Bills Aging Report for {selectedHead} as of{' '}
            {format(selectedDate, 'PPP')}
          </h1>
        </div>

        <BillsAgingTable billsAging={billsAging} isLoading={isLoading} />
      </div>
    </>
  );
};

export default BillsAgingPage;
