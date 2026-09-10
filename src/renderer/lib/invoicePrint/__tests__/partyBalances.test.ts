import { BalanceType, InvoiceType } from 'types';
import {
  computeInvoicePrintRunningBalances,
  toInvoicePrintAsOfDate,
} from '../partyBalances';

describe('toInvoicePrintAsOfDate', () => {
  it('formats Date as local calendar day', () => {
    expect(toInvoicePrintAsOfDate(new Date(2026, 7, 29))).toBe('2026-08-29');
  });
});

describe('computeInvoicePrintRunningBalances', () => {
  it('returns null when family has no ledger', () => {
    expect(
      computeInvoicePrintRunningBalances(InvoiceType.Sale, 396000, null),
    ).toBeNull();
  });

  it('sale: sabqa = naya minus this bill', () => {
    expect(
      computeInvoicePrintRunningBalances(InvoiceType.Sale, 396000, {
        balance: 884210,
        balanceType: BalanceType.Dr,
      }),
    ).toEqual({
      previousBalance: 488210,
      newBalance: 884210,
    });
  });

  it('purchase: bill increases Cr payable so sabqa is naya plus total', () => {
    expect(
      computeInvoicePrintRunningBalances(InvoiceType.Purchase, 1000, {
        balance: 2500,
        balanceType: BalanceType.Cr,
      }),
    ).toEqual({
      previousBalance: -1500,
      newBalance: -2500,
    });
  });
});
