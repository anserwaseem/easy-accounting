import { buildBillsAgingRows } from '../BillsAgingPrintTable';
import { withBillsSubset, sumBillOutstanding } from '../accountTotals';
import type { BillsAgingAccount, BillItem } from '../types';

const bill = (
  overrides: Partial<BillItem> & Pick<BillItem, 'billNumber' | 'finalBalance'>,
): BillItem => ({
  billPercentage: 15,
  billDate: '2026-01-01',
  billAmount: overrides.finalBalance,
  receipts: [],
  daysStatus: {
    isFullyPaid: overrides.finalBalance === 0,
    days: 300,
    months: 10,
    remainingDays: 0,
  },
  ...overrides,
});

const account = (bills: BillItem[], unallocated = 0): BillsAgingAccount => {
  const totalOutstanding = sumBillOutstanding(bills);
  return {
    accountId: 1,
    accountName: 'Shop',
    accountCode: 'SHOP',
    bills,
    unallocatedReceipts:
      unallocated > 0
        ? [{ receivedDate: '2026-06-01', receivedAmount: unallocated }]
        : [],
    totalBillAmount: bills.reduce((sum, b) => sum + b.billAmount, 0),
    totalReceived: 0,
    totalOutstanding,
    totalUnallocated: unallocated,
  };
};

const netOutstanding = (acc: BillsAgingAccount): number =>
  acc.totalOutstanding - acc.totalUnallocated;

const exportBalanceTotal = (acc: BillsAgingAccount): number =>
  buildBillsAgingRows(
    {
      headName: 'Head',
      asOfDate: '2026-11-23',
      accounts: [acc],
    },
    false,
  ).reduce((sum, row) => sum + row.balance, 0);

describe('withBillsSubset', () => {
  it('recomputes totalOutstanding so UI header matches export/print after days filter', () => {
    const youngBill = bill({
      billNumber: '1',
      finalBalance: 311728,
      daysStatus: {
        isFullyPaid: false,
        days: 100,
        months: 3,
        remainingDays: 10,
      },
    });
    const agedBill = bill({
      billNumber: '2',
      finalBalance: 2937233,
      daysStatus: {
        isFullyPaid: false,
        days: 210,
        months: 7,
        remainingDays: 0,
      },
    });
    const full = account([youngBill, agedBill]);

    // bug shape: strip young bills but leave stale account totals
    const staleFiltered: BillsAgingAccount = {
      ...full,
      bills: [agedBill],
    };
    expect(netOutstanding(staleFiltered)).toBe(3248961);
    expect(exportBalanceTotal(staleFiltered)).toBe(2937233);

    const fixed = withBillsSubset(full, [agedBill]);
    expect(netOutstanding(fixed)).toBe(2937233);
    expect(exportBalanceTotal(fixed)).toBe(netOutstanding(fixed));
  });

  it('keeps unallocated so net outstanding stays export-aligned', () => {
    const aged = bill({ billNumber: '9', finalBalance: 10000 });
    const full = account(
      [aged, bill({ billNumber: '8', finalBalance: 5000 })],
      2000,
    );
    const fixed = withBillsSubset(full, [aged]);

    expect(fixed.totalOutstanding).toBe(10000);
    expect(fixed.totalUnallocated).toBe(2000);
    expect(netOutstanding(fixed)).toBe(8000);
    expect(exportBalanceTotal(fixed)).toBe(8000);
  });
});
