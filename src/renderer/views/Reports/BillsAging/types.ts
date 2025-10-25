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
    days: number;
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
