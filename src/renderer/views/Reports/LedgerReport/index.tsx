import { format } from 'date-fns';
import { Button } from 'renderer/shad/ui/button';
import { Calendar as CalendarIcon, Printer, RefreshCw } from 'lucide-react';
import { Calendar } from 'renderer/shad/ui/calendar';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from 'renderer/shad/ui/popover';
import { cn } from 'renderer/lib/utils';
import { Card } from 'renderer/shad/ui/card';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { printStyles } from '../components';
import { useLedgerReport } from './useLedgerReport';
import { LedgerReportTable } from './LedgerReportTable';
import { ledgerPrintStyles } from './ledgerPrintStyles';

const LedgerReportPage = () => {
  const {
    accounts,
    selectedAccount,
    setSelectedAccount,
    selectedDate,
    handleDateChange,
    ledgerEntries,
    isLoading,
    selectedAccountName,
    refreshData,
    handlePrint,
  } = useLedgerReport();

  return (
    <>
      <style>{printStyles}</style>
      <style>{ledgerPrintStyles}</style>
      <div className="w-full mx-auto print-container">
        <div className="flex justify-between items-center mb-6 print-header">
          <h1 className="text-2xl font-semibold text-primary print:hidden">
            Ledger Report
          </h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground print:hidden">
                Account:
              </span>
              <div className="w-[200px] print:hidden">
                <VirtualSelect
                  options={accounts || []}
                  value={selectedAccount?.toString()}
                  onChange={(value) => setSelectedAccount(Number(value))}
                  placeholder="Select account"
                  searchPlaceholder="Search accounts..."
                />
              </div>
            </div>
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
              title="Print Ledger Report"
              className="print:hidden"
            >
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Card className="p-6 shadow-md print-card">
          <div className="data-table-wrapper">
            {selectedAccount ? (
              <LedgerReportTable
                ledger={ledgerEntries}
                isLoading={isLoading}
                selectedDate={selectedDate}
                accountName={selectedAccountName}
              />
            ) : (
              <div className="p-4 text-center text-muted-foreground">
                Please select an account to view its ledger
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
};

export default LedgerReportPage;
