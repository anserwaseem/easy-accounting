export interface FinancialOverview {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  currentRatio: number;
  quickRatio: number;
  currentAssets: number;
  currentLiabilities: number;
  inventory: number;
  cashAndBank: number;
  accountsReceivable: number;
  accountsPayable: number;
  lastUpdated: Date;
}

export interface CashFlow {
  operatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  netCashFlow: number;
  cashFlowFromSales: number;
  cashFlowFromPurchases: number;
  cashFlowFromExpenses: number;
  lastUpdated: Date;
}

export interface FinancialOverviewProps {
  className?: string;
}

export interface CashFlowProps {
  className?: string;
}
