import { RefreshCw, Info, HelpCircle } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/renderer/shad/ui/card';
import { Skeleton } from '@/renderer/shad/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/renderer/shad/ui/tooltip';
import { getFormattedCurrency } from '@/renderer/lib/utils';
import { METRIC_DESCRIPTIONS, CALCULATION_DESCRIPTIONS } from './constants';
import type { FinancialOverviewProps } from './types';
import { useFinancialOverview } from './useFinancialOverview';

const getCurrentRatioStatus = (ratio: number): string => {
  if (ratio > 2) return 'Healthy';
  if (ratio > 1) return 'Adequate';
  return 'Low';
};

const getQuickRatioStatus = (ratio: number): string => {
  if (ratio > 1) return 'Good';
  if (ratio > 0.5) return 'Fair';
  return 'Poor';
};

const SKELETON_CARDS = [
  { id: 'total-assets', title: 'Total Assets' },
  { id: 'total-liabilities', title: 'Total Liabilities' },
  { id: 'net-worth', title: 'Net Worth' },
  { id: 'current-ratio', title: 'Current Ratio' },
];

interface MetricTitleProps {
  title: string;
  description: string;
  calculation: string;
}

const MetricTitle: React.FC<MetricTitleProps> = ({
  title,
  description,
  calculation,
}: MetricTitleProps) => (
  <div className="flex items-center gap-2">
    <CardTitle className="text-sm font-medium text-muted-foreground">
      {title}
    </CardTitle>
    <div className="flex items-center gap-1">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-4 w-4 p-0">
              <Info className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs text-sm">{description}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-4 w-4 p-0">
              <HelpCircle className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs text-sm">Calculation: {calculation}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </div>
);

export const FinancialOverview: React.FC<FinancialOverviewProps> = ({
  className,
}: FinancialOverviewProps) => {
  const { overview, isLoading, refetch } = useFinancialOverview();
  console.log('FinancialOverview overview', overview);

  if (isLoading) {
    return (
      <div
        className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 ${className}`}
      >
        {SKELETON_CARDS.map((card) => (
          <Card key={card.id}>
            <CardHeader>
              <Skeleton className="h-4 w-3/4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Financial Overview</h2>
        <Button variant="outline" size="icon" onClick={refetch}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <MetricTitle
              title="Total Assets"
              description={METRIC_DESCRIPTIONS.totalAssets}
              calculation={CALCULATION_DESCRIPTIONS.totalAssets}
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {getFormattedCurrency(overview.totalAssets)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MetricTitle
              title="Total Liabilities"
              description={METRIC_DESCRIPTIONS.totalLiabilities}
              calculation={CALCULATION_DESCRIPTIONS.totalLiabilities}
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {getFormattedCurrency(overview.totalLiabilities)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MetricTitle
              title="Net Worth"
              description={METRIC_DESCRIPTIONS.netWorth}
              calculation={CALCULATION_DESCRIPTIONS.netWorth}
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {getFormattedCurrency(overview.netWorth)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MetricTitle
              title="Current Ratio"
              description={METRIC_DESCRIPTIONS.currentRatio}
              calculation={CALCULATION_DESCRIPTIONS.currentRatio}
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {overview.currentRatio.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {getCurrentRatioStatus(overview.currentRatio)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <MetricTitle
              title="Quick Ratio"
              description={METRIC_DESCRIPTIONS.quickRatio}
              calculation={CALCULATION_DESCRIPTIONS.quickRatio}
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {overview.quickRatio.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {getQuickRatioStatus(overview.quickRatio)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MetricTitle
              title="Cash & Bank"
              description={METRIC_DESCRIPTIONS.cashAndBank}
              calculation={CALCULATION_DESCRIPTIONS.cashAndBank}
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {getFormattedCurrency(overview.cashAndBank)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MetricTitle
              title="Accounts Receivable"
              description={METRIC_DESCRIPTIONS.accountsReceivable}
              calculation={CALCULATION_DESCRIPTIONS.accountsReceivable}
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {getFormattedCurrency(overview.accountsReceivable)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MetricTitle
              title="Accounts Payable"
              description={METRIC_DESCRIPTIONS.accountsPayable}
              calculation={CALCULATION_DESCRIPTIONS.accountsPayable}
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {getFormattedCurrency(overview.accountsPayable)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="text-xs text-muted-foreground text-right">
        Last updated: {overview.lastUpdated.toLocaleString()}
      </div>
    </div>
  );
};
