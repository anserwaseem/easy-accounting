export interface BillReceipt {
  receivedDate: string;
  receivedAmount: number;
  balance: number;
}

export interface BillItem {
  billNumber: string;
  billPercentage: number | string;
  billDate: string;
  billAmount: number;
  receipts: BillReceipt[];
  finalBalance: number;
  daysStatus: {
    isFullyPaid: boolean;
    /** total elapsed days, kept for reference/sorting */
    days: number;
    /** calendar-accurate whole months elapsed */
    months: number;
    /** calendar-accurate remaining days after `months` whole months */
    remainingDays: number;
  };
}

export interface UnallocatedReceipt {
  receivedDate: string;
  receivedAmount: number;
}

export interface BillsAgingAccount {
  accountId: number;
  accountName: string;
  accountCode?: number | string;
  /** agent head the account lives under; shown in the all-parties scope */
  headName?: string;
  bills: BillItem[];
  unallocatedReceipts: UnallocatedReceipt[];
  totalBillAmount: number;
  totalReceived: number;
  totalOutstanding: number;
  totalUnallocated: number;
}

export interface BillsAging {
  headName: string;
  asOfDate: string;
  accounts: BillsAgingAccount[];
}

/** flat row structure for the Excel-like/print table */
export interface BillsAgingRow {
  accountCode?: number | string;
  /** agent head the account lives under; shown in the all-parties scope */
  headName?: string;
  billNumber: string;
  billDate: string;
  billPercentage: number | string;
  balance: number;
  sortKey?: string;
  daysStatus?: {
    isFullyPaid: boolean;
    days: number;
    months: number;
    remainingDays: number;
  };
}
