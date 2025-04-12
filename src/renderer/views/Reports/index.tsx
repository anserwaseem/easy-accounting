import { Link } from 'react-router-dom';
import { BarChart3, DollarSign, Book } from 'lucide-react';
import { Card } from 'renderer/shad/ui/card';

const ReportsPage: React.FC = () => {
  const reportOptions = [
    {
      title: 'Trial Balance',
      description:
        'View the trial balance to ensure your accounts are balanced.',
      path: '/reports/trial-balance',
      icon: <BarChart3 className="h-6 w-6" />,
    },
    {
      title: 'Account Balances',
      description: 'View latest balances of accounts grouped by head name.',
      path: '/reports/account-balances',
      icon: <DollarSign className="h-6 w-6" />,
    },
    {
      title: 'Ledger Report',
      description:
        'View and print ledger entries for specific accounts by date.',
      path: '/reports/ledger-report',
      icon: <Book className="h-6 w-6" />,
    },
    // Add more report types here in the future
  ];

  return (
    <div className="w-full">
      <h1 className="text-2xl font-semibold mb-6">Reports</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reportOptions.map((option) => (
          <Link key={option.path} to={option.path}>
            <Card className="p-4 hover:bg-muted transition-colors cursor-pointer h-full">
              <div className="flex items-center gap-2 mb-2">
                {option.icon}
                <h2 className="text-lg font-medium">{option.title}</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                {option.description}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default ReportsPage;
