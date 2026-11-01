import { CashFlow } from './CashFlow';
import { FinancialOverview } from './FinancialOverview';

export const Dashboard: React.FC = () => {
  return (
    <div className="container py-6 px-0 space-y-6 max-w-6xl">
      <h1 className="text-3xl font-semibold">Dashboard</h1>
      <CashFlow />
      <FinancialOverview />
    </div>
  );
};
