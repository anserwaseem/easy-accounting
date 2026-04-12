import { type JournalNarrationSummary } from './types';

/** shared filter contract for all report types */
export interface ReportFilters {
  startDate: string;
  endDate: string;
  groupBy?: 'day' | 'week' | 'month';
  groupByPolicy?: boolean; // for reports that support grouping customers/accounts by discount profile
  compareStartDate?: string; // for period-over-period comparison
  compareEndDate?: string; // for period-over-period comparison
  accountIds?: number[];
  inventoryIds?: number[];
  itemTypeIds?: number[];
  lookbackDays?: number;
}

/** shared report response shape */
export interface ReportResponse {
  kpis: Record<string, number>;
  series: Array<{
    dataPoints: Array<{ date: string; value: number }>;
    granularity: 'day' | 'week' | 'month';
  }>;
  rows: Record<string, unknown>[];
  anomalies: Array<{
    type: string;
    message: string;
    count: number;
    rows: unknown[];
  }>;
  exportRows: unknown[];
}

/** ledger range report input/output (does not use shared response as row shape is specific) */
export interface LedgerRangeResponse {
  openingBalance: {
    balance: number;
    balanceType: import('./types').BalanceType;
    date: string;
  } | null;
  entries: Array<{
    id: number;
    date: string;
    accountId: number;
    particulars: string;
    debit: number;
    credit: number;
    balance: number;
    balanceType: import('./types').BalanceType;
    linkedAccountId?: number;
    linkedAccountName: string | null;
    linkedAccountCode?: number | string | null;
    journalSummary?: JournalNarrationSummary | null;
  }>;
  closingBalance: {
    balance: number;
    balanceType: import('./types').BalanceType;
  } | null;
}

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

/** stock as-of report input */
export interface StockAsOfReportFilters {
  asOfDate: string;
  itemTypeIds?: number[];
}

/** one row of the stock as-of report */
export interface StockAsOfRow {
  itemId: number;
  itemTypeId: number | null;
  item: string;
  itemType: string | null;
  listPosition: number | null;
  quantityAsOf: number;
  currentQuantity: number;
  unitPrice: number;
}

/** stock as-of report payload */
export interface StockAsOfReportResponse {
  /** inclusive end instant used for invoice/adjustment comparison */
  asOfDateEnd: string;
  rows: StockAsOfRow[];
}

/** report keys for store persistence */
export const REPORT_FILTER_KEYS = {
  inventoryHealth: 'reports.inventoryHealth.filters',
  salesPerformance: 'reports.salesPerformance.filters',
  ledger: 'reports.ledger.filters',
  stockAsOf: 'reports.stockAsOf.filters',
} as const;
