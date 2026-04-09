import type { LedgerView } from '@/types';
import { Card } from '@/renderer/shad/ui/card';
import { LedgerTableBase } from '@/renderer/components/ledger/LedgerTableBase';
import { EmptyState, LoadingState } from '../components';

interface LedgerReportTableProps {
  ledger: LedgerView[];
  isLoading: boolean;
  dateSubtitle: string;
  accountName: string;
}

export const LedgerReportTable: React.FC<LedgerReportTableProps> = ({
  ledger,
  isLoading,
  dateSubtitle,
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

  return (
    <>
      {/* Print-only report header */}
      <div className="hidden print:block print:mb-4">
        <h1 className="text-center font-bold text-lg">
          Ledger Report for {accountName} - {dateSubtitle}
        </h1>
      </div>

      {/* Table - styled for both screen and print */}
      <LedgerTableBase ledger={ledger} className="print-table" printMode />
    </>
  );
};
