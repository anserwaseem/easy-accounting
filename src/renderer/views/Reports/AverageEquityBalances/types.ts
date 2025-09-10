export interface AverageEquityBalanceItem {
  id: number;
  name: string;
  code?: number | string;
  /** signed average where Credit is positive, Debit is negative */
  averageBalance: number;
}

export interface AverageEquityBalancesState {
  items: AverageEquityBalanceItem[];
  totalAverage?: number;
}
