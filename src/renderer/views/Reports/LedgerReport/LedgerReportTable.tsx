import { getFormattedCurrency } from 'renderer/lib/utils';
import type { LedgerView } from '@/types';
import { format } from 'date-fns';
import { Card } from '@/renderer/shad/ui/card';
import { LedgerTableBase } from '@/renderer/components/ledger/LedgerTableBase';
import { EmptyState, LoadingState } from '../components';

interface LedgerReportTableProps {
  ledger: LedgerView[];
  isLoading: boolean;
  selectedDate: Date;
  accountName: string;
}

export const LedgerReportTable: React.FC<LedgerReportTableProps> = ({
  ledger,
  isLoading,
  selectedDate,
  accountName,
}: LedgerReportTableProps) => {
  if (isLoading) {
    return <LoadingState message="Loading ledger entries..." />;
  }

  if (ledger.length === 0) {
    return (
      <Card className="p-6 text-center text-muted-foreground">
        <EmptyState message="No ledger entries found for the selected account and date." />
      </Card>
    );
  }

  const latestBalance =
    ledger.length > 0
      ? `${getFormattedCurrency(
          ledger.at(-1)?.balance ?? 0,
        ).trim()} ${ledger.at(-1)?.balanceType}`
      : '';

  return (
    <>
      {/* Print-only report header */}
      <div className="hidden print:block print:mb-4">
        <h1 className="text-center font-bold text-lg">
          Ledger Report for {accountName} as of{' '}
          {format(selectedDate, 'MMMM do, yyyy')}
        </h1>
      </div>

      {/* Account and balance info */}
      <div className="flex justify-between items-center mb-4 print:mb-2">
        {ledger.length > 0 && (
          <p>
            Latest Balance:{' '}
            <span className="font-semibold">{latestBalance}</span>
          </p>
        )}
      </div>

      {/* Table - styled for both screen and print */}
      <LedgerTableBase ledger={ledger} printMode className="print-table" />
    </>
  );
};
