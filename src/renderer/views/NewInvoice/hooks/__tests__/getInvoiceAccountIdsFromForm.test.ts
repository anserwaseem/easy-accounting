import { InvoiceType } from 'types';
import { getInvoiceAccountIdsFromForm } from '../getInvoiceAccountIdsFromForm';

describe('getInvoiceAccountIdsFromForm', () => {
  it('sale single no split: returns [singleAccountId]', () => {
    expect(
      getInvoiceAccountIdsFromForm({
        invoiceType: InvoiceType.Sale,
        useSingleAccount: true,
        splitByItemType: false,
        values: {
          accountMapping: {
            singleAccountId: 42,
            multipleAccountIds: [99, 100],
          },
          invoiceItems: [],
        },
      }),
    ).toEqual([42]);
  });

  it('sale single split: returns unique positive ids from multipleAccountIds', () => {
    expect(
      getInvoiceAccountIdsFromForm({
        invoiceType: InvoiceType.Sale,
        useSingleAccount: true,
        splitByItemType: true,
        values: {
          accountMapping: {
            singleAccountId: 1,
            multipleAccountIds: [10, 10, 20],
          },
          invoiceItems: [{ id: 1 } as never],
        },
      }).sort((a, b) => a - b),
    ).toEqual([10, 20]);
  });

  it('sale single split: empty multipleAccountIds falls back to singleAccountId for date validation', () => {
    expect(
      getInvoiceAccountIdsFromForm({
        invoiceType: InvoiceType.Sale,
        useSingleAccount: true,
        splitByItemType: true,
        values: {
          accountMapping: { singleAccountId: 1, multipleAccountIds: [] },
          invoiceItems: [],
        },
      }),
    ).toEqual([1]);
  });

  it('purchase single: ignores split flag, uses singleAccountId', () => {
    expect(
      getInvoiceAccountIdsFromForm({
        invoiceType: InvoiceType.Purchase,
        useSingleAccount: true,
        splitByItemType: true,
        values: {
          accountMapping: { singleAccountId: 7, multipleAccountIds: [1, 2] },
          invoiceItems: [],
        },
      }),
    ).toEqual([7]);
  });

  it('multi-customer: returns multipleAccountIds positives only', () => {
    expect(
      getInvoiceAccountIdsFromForm({
        invoiceType: InvoiceType.Sale,
        useSingleAccount: false,
        splitByItemType: false,
        values: {
          accountMapping: {
            singleAccountId: undefined,
            multipleAccountIds: [3, 0, -1, 4],
          },
          invoiceItems: [],
        },
      }),
    ).toEqual([3, 4]);
  });
});
