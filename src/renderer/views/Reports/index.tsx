import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  Book,
  CalendarDays,
  Clock,
  DollarSign,
  Package,
  TrendingUp,
  Scale,
  AlertCircle,
} from 'lucide-react';
import { Card } from 'renderer/shad/ui/card';
import { Alert, AlertDescription, AlertTitle } from 'renderer/shad/ui/alert';

interface ReportOption {
  title: string;
  description: string;
  path: string;
  icon: React.ReactNode;
  status?: 'coming-soon' | 'available';
}

const accountingReports: ReportOption[] = [
  {
    title: 'Trial Balance',
    description: 'View the trial balance to ensure your accounts are balanced.',
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
      'View and print ledger entries for specific accounts by date range.',
    path: '/reports/ledger-report',
    icon: <Book className="h-6 w-6" />,
  },
  {
    title: 'Average Equity Balances',
    description: 'View average balances of equity accounts by date range.',
    path: '/reports/average-equity-balances',
    icon: <Scale className="h-6 w-6" />,
  },
  {
    title: 'Bills Aging',
    description: 'Track bill payments and outstanding amounts by account.',
    path: '/reports/bills-aging',
    icon: <Clock className="h-6 w-6" />,
  },
];

const operationsReports: ReportOption[] = [
  {
    title: 'Inventory Health',
    description: 'See which inventory items need attention right now.',
    path: '/reports/inventory-health',
    icon: <Package className="h-6 w-6" />,
  },
  {
    title: 'Stock as of date',
    description:
      'Rewind current stock using posted movements after a past date (no opening balance required).',
    path: '/reports/stock-as-of',
    icon: <CalendarDays className="h-6 w-6" />,
  },
  {
    title: 'Sales Performance',
    description: 'Track posted sales behavior, trends, and returns.',
    path: '/reports/sales-performance',
    icon: <TrendingUp className="h-6 w-6" />,
  },
  {
    title: 'Receivables',
    description:
      'Collections reporting with bill-level detail and FIFO allocation.',
    path: '/reports/receivables',
    icon: <DollarSign className="h-6 w-6" />,
  },
];

interface ReportCardProps {
  option: ReportOption;
}

const ReportCard: React.FC<ReportCardProps> = ({ option }: ReportCardProps) => {
  const [dismissed, setDismissed] = useState(false);

  if (option.status === 'coming-soon') {
    if (dismissed) return null;
    return (
      <Alert variant="default">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle className="flex items-center justify-between">
          <span>{option.title}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setDismissed(true)}
          >
            ✕
          </button>
        </AlertTitle>
        <AlertDescription>{option.description}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Link to={option.path}>
      <Card className="p-4 hover:bg-muted transition-colors cursor-pointer h-full">
        <div className="flex items-center gap-2 mb-2">
          {option.icon}
          <h2 className="text-lg font-medium">{option.title}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{option.description}</p>
      </Card>
    </Link>
  );
};

const ReportsPage: React.FC = () => (
  <div className="w-full">
    <h1 className="title-new mb-6">Reports</h1>

    <h2 className="text-xl font-semibold mb-3">Accounting</h2>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 border-b pb-4">
      {accountingReports.map((option) => (
        <ReportCard key={option.path} option={option} />
      ))}
    </div>

    <h2 className="text-xl font-semibold my-3">Operations</h2>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {operationsReports.map((option) => (
        <ReportCard key={option.path} option={option} />
      ))}
    </div>
  </div>
);

export default ReportsPage;
