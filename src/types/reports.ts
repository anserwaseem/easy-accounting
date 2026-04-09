/** persisted filter state per report */
export interface SavedFilterState {
  dateRange?: { from: string; to: string }; // ISO strings
  groupBy?: 'day' | 'week' | 'month';
  groupByPolicy?: boolean;
  compareStartDate?: string; // for period-over-period comparison
  compareEndDate?: string; // for period-over-period comparison
  comparisonMode?: string; // 'previous' | 'previous_year'
  itemTypeIds?: number[];
  accountIds?: number[];
  inventoryIds?: number[];
  presetValue?: string;
}

/** report keys for store persistence */
export const REPORT_FILTER_KEYS = {
  inventoryHealth: 'reports.inventoryHealth.filters',
  salesPerformance: 'reports.salesPerformance.filters',
  receivables: 'reports.receivables.filters',
  purchaseReplenishment: 'reports.purchaseReplenishment.filters',
  ledger: 'reports.ledger.filters',
} as const;
