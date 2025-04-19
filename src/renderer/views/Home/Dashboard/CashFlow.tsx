import { RefreshCw, Info, HelpCircle } from 'lucide-react';
import PropTypes from 'prop-types';
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
import { useCashFlow } from './useCashFlow';
import { METRIC_DESCRIPTIONS, CALCULATION_DESCRIPTIONS } from './constants';
import type { CashFlowProps } from './types';

const SKELETON_CARDS = [
  { id: 'operating-cash-flow', title: 'Operating Cash Flow' },
  { id: 'investing-cash-flow', title: 'Investing Cash Flow' },
  { id: 'financing-cash-flow', title: 'Financing Cash Flow' },
  { id: 'net-cash-flow', title: 'Net Cash Flow' },
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
}) => (
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

MetricTitle.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  calculation: PropTypes.string.isRequired,
};

export const CashFlow: React.FC<CashFlowProps> = ({ className }) => {
  const { cashFlow, isLoading, refetch } = useCashFlow();

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
        <h2 className="text-2xl font-bold">Cash Flow</h2>
        <Button variant="outline" size="icon" onClick={refetch}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <MetricTitle
              title="Operating Cash Flow"
              description={METRIC_DESCRIPTIONS.operatingCashFlow}
              calculation={CALCULATION_DESCRIPTIONS.operatingCashFlow}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                cashFlow.operatingCashFlow >= 0
                  ? 'text-green-600'
                  : 'text-red-600'
              }`}
            >
              {getFormattedCurrency(cashFlow.operatingCashFlow)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MetricTitle
              title="Investing Cash Flow"
              description={METRIC_DESCRIPTIONS.investingCashFlow}
              calculation={CALCULATION_DESCRIPTIONS.investingCashFlow}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                cashFlow.investingCashFlow >= 0
                  ? 'text-green-600'
                  : 'text-red-600'
              }`}
            >
              {getFormattedCurrency(cashFlow.investingCashFlow)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MetricTitle
              title="Financing Cash Flow"
              description={METRIC_DESCRIPTIONS.financingCashFlow}
              calculation={CALCULATION_DESCRIPTIONS.financingCashFlow}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                cashFlow.financingCashFlow >= 0
                  ? 'text-green-600'
                  : 'text-red-600'
              }`}
            >
              {getFormattedCurrency(cashFlow.financingCashFlow)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MetricTitle
              title="Net Cash Flow"
              description={METRIC_DESCRIPTIONS.netCashFlow}
              calculation={CALCULATION_DESCRIPTIONS.netCashFlow}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                cashFlow.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {getFormattedCurrency(cashFlow.netCashFlow)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <MetricTitle
              title="Cash from Sales"
              description={METRIC_DESCRIPTIONS.cashFlowFromSales}
              calculation={CALCULATION_DESCRIPTIONS.cashFlowFromSales}
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {getFormattedCurrency(cashFlow.cashFlowFromSales)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MetricTitle
              title="Cash spent on Purchases"
              description={METRIC_DESCRIPTIONS.cashFlowFromPurchases}
              calculation={CALCULATION_DESCRIPTIONS.cashFlowFromPurchases}
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {getFormattedCurrency(cashFlow.cashFlowFromPurchases)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <MetricTitle
              title="Cash spent on Expenses"
              description={METRIC_DESCRIPTIONS.cashFlowFromExpenses}
              calculation={CALCULATION_DESCRIPTIONS.cashFlowFromExpenses}
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {getFormattedCurrency(cashFlow.cashFlowFromExpenses)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="text-xs text-muted-foreground text-right">
        Last updated: {cashFlow.lastUpdated.toLocaleString()}
      </div>
    </div>
  );
};

CashFlow.propTypes = {
  className: PropTypes.string,
};

CashFlow.defaultProps = {
  className: '',
};
