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
  Truck,
  Scale,
  AlertCircle,
  Users,
  ClipboardList,
  Percent,
  HelpCircle,
} from 'lucide-react';
import { Card } from 'renderer/shad/ui/card';
import { Alert, AlertDescription, AlertTitle } from 'renderer/shad/ui/alert';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'renderer/shad/ui/popover';
import {
  ADVANCED_CAPABILITIES,
  type AdvancedCapability,
} from '@/core/advancedCapabilities';
import { useAdvancedCapabilities } from '@/renderer/hooks/useAdvancedCapabilities';

interface ReportOption {
  title: string;
  description: string;
  help?: string;
  path: string;
  icon: React.ReactNode;
  status?: 'coming-soon' | 'available';
  /**
   * When set, the report is only offered if this advanced capability is
   * enabled on this device. The card disappears entirely rather than
   * being shown disabled.
   */
  capability?: AdvancedCapability;
}

const accountingReports: ReportOption[] = [
  {
    title: 'Trial Balance',
    description: 'View the trial balance to ensure your accounts are balanced.',
    help: 'Auditing tool comparing all debit and credit balances across charts to ensure fundamental accounting equilibrium.',
    path: '/reports/trial-balance',
    icon: <BarChart3 className="h-6 w-6" />,
  },
  {
    title: 'Account Balances',
    description: 'View latest balances of accounts grouped by head name.',
    help: 'Snapshot of current balances across customer, supplier, cash, and bank accounts grouped by their chart head.',
    path: '/reports/account-balances',
    icon: <DollarSign className="h-6 w-6" />,
  },
  {
    title: 'Ledger Report',
    description:
      'View and print ledger entries for specific accounts by date range.',
    help: 'Chronological double-entry transactions (debit, credit, running balance) for selected accounts within a custom date range.',
    path: '/reports/ledger-report',
    icon: <Book className="h-6 w-6" />,
  },
  {
    title: 'Average Equity Balances',
    description: 'View average balances of equity accounts by date range.',
    help: 'Tracks partner or shareholder capital movement and weighted average balances over time for profit distribution.',
    path: '/reports/average-equity-balances',
    icon: <Scale className="h-6 w-6" />,
  },
  {
    title: 'Bills Aging',
    description: 'Track bill payments and outstanding amounts by account.',
    help: 'Ledger-based bill tracking using FIFO payment allocation. Answers which bills are unpaid and how many days overdue they are.',
    path: '/reports/bills-aging',
    icon: <Clock className="h-6 w-6" />,
  },
  {
    title: 'Collection sheet',
    description:
      'Agent route sheet for a date range. Balance, collections, and sale bills. Blank columns for the trip.',
    help: 'Agent route preparation and scrutiny. Pairs physical sales bills delivered to shops with serial tour collections and blank columns for field visits.',
    path: '/reports/collection-sheet',
    icon: <ClipboardList className="h-6 w-6" />,
  },
  {
    title: 'Agent Commissions',
    description:
      'Commission statement and settlement posting by agent head and date range.',
    help: 'Calculates commission earnings on sales and collections per tier rate, with one-click posting to ledger settlement accounts.',
    path: '/reports/agent-commission',
    icon: <Percent className="h-6 w-6" />,
    capability: ADVANCED_CAPABILITIES.commissionModule,
  },
];

const operationsReports: ReportOption[] = [
  {
    title: 'Inventory Health',
    description: 'See which inventory items need attention right now.',
    help: 'Monitors catalog attributes, pricing readiness, missing dimensions, and publishing status across inventory items.',
    path: '/reports/inventory-health',
    icon: <Package className="h-6 w-6" />,
  },
  {
    title: 'Stock as of date',
    description:
      'Rewind current stock using posted movements after a past date.',
    help: 'Reconstructs historical stock quantity at any past date by calculating movements backward from current inventory.',
    path: '/reports/stock-as-of',
    icon: <CalendarDays className="h-6 w-6" />,
  },
  {
    title: 'Sales Performance',
    description: 'Track posted sales behavior, trends, and returns.',
    help: 'Sales volume analytics, top customers, bestselling items, return rates, and period-over-period comparisons.',
    path: '/reports/sales-performance',
    icon: <TrendingUp className="h-6 w-6" />,
    capability: ADVANCED_CAPABILITIES.salesPerformanceReport,
  },
  {
    title: 'Sales by Customer',
    description: 'Items sold to a customer between two dates.',
    help: 'Item-level breakdown of all products dispatched to a specific customer within a custom date range.',
    path: '/reports/sales-by-customer',
    icon: <Users className="h-6 w-6" />,
  },
  {
    title: 'Purchases by Vendor',
    description: 'Items bought from a vendor between two dates.',
    help: 'Item-level breakdown of all stock received from a vendor within a custom date range.',
    path: '/reports/purchases-by-vendor',
    icon: <Truck className="h-6 w-6" />,
  },
  {
    title: 'At-vendor activity',
    description:
      'Opening + sent − bought back at a vendor. Click numbers for the documents.',
    help: 'Tracks consignment stock sitting at external vendors (raw material sent vs finished goods bought back).',
    path: '/reports/vendor-stock-activity',
    icon: <Package className="h-6 w-6" />,
  },
];

interface ReportCardProps {
  option: ReportOption;
}

const ReportCard: React.FC<ReportCardProps> = ({ option }: ReportCardProps) => {
  const [dismissed, setDismissed] = useState(false);
  const { enabled, loaded } = useAdvancedCapabilities();

  // an advanced report is not offered at all on a device where it is off:
  // a card that leads to "not available" is worse than no card
  const available =
    !option.capability || (loaded && enabled.has(option.capability));
  if (option.capability && !available) return null;

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
    <div className="relative group h-full">
      <Link to={option.path} className="block h-full">
        <Card className="p-4 hover:bg-muted/60 transition-colors cursor-pointer h-full flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                {option.icon}
                <h2 className="text-lg font-medium">{option.title}</h2>
              </div>
            </div>
            <p className="text-sm text-muted-foreground pr-6">
              {option.description}
            </p>
          </div>
        </Card>
      </Link>
      {option.help ? (
        <div className="absolute top-3 right-3 z-10">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors focus:outline-none md:h-6 md:w-6"
                onClick={(e) => e.stopPropagation()}
                title="About this report"
                aria-label="About this report"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[min(20rem,calc(100vw-2rem))] text-xs p-3 space-y-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <h4 className="font-semibold text-sm">{option.title}</h4>
              <p className="text-muted-foreground leading-relaxed">
                {option.help}
              </p>
            </PopoverContent>
          </Popover>
        </div>
      ) : null}
    </div>
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
