import type { BillItem, BillsAgingAccount } from './types';

/** outstanding on a bill list — same basis as account.totalOutstanding */
export const sumBillOutstanding = (bills: BillItem[]): number =>
  bills.reduce((sum, bill) => sum + bill.finalBalance, 0);

/**
 * replace an account's bill list and recompute the summary totals that
 * the header / card / sort keys read. unallocated receipts stay as-is —
 * export/print still emit them as negative rows.
 */
export const withBillsSubset = (
  account: BillsAgingAccount,
  bills: BillItem[],
): BillsAgingAccount => {
  let totalBillAmount = 0;
  let totalReceived = 0;
  let totalOutstanding = 0;

  bills.forEach((bill) => {
    totalBillAmount += bill.billAmount;
    totalOutstanding += bill.finalBalance;
    for (let rIdx = 0; rIdx < bill.receipts.length; rIdx++) {
      totalReceived += bill.receipts[rIdx].receivedAmount;
    }
  });

  return {
    ...account,
    bills,
    totalBillAmount,
    totalReceived,
    totalOutstanding,
  };
};
