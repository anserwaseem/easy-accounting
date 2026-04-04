import { renderHook } from '@testing-library/react';
import { InvoiceType } from 'types';
import { buildNewInvoiceFormSchema } from '../../schema';
import { useInvoiceDateValidation } from '../useInvoiceDateValidation';

jest.mock('renderer/shad/ui/use-toast', () => ({ toast: jest.fn() }));

describe('useInvoiceDateValidation', () => {
  const baseValues = {
    id: 1,
    date: '2025-06-15T12:00:00.000Z',
    invoiceNumber: 50,
    extraDiscount: 0,
    extraDiscountAccountId: undefined,
    totalAmount: 100,
    invoiceType: InvoiceType.Sale,
    biltyNumber: '',
    cartons: 0,
    invoiceItems: [
      {
        id: 1,
        inventoryId: 10,
        quantity: 1,
        discount: 0,
        price: 10,
        discountedPrice: 10,
      },
    ],
    accountMapping: { singleAccountId: 100, multipleAccountIds: [] },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    (window as unknown as { electron: Record<string, jest.Mock> }).electron = {
      getSaleInvoiceEditDateBounds: jest.fn(),
      getLedger: jest.fn(),
    };
  });

  it('sale edit single no split: rejects date before prev bound', async () => {
    (
      window as unknown as {
        electron: { getSaleInvoiceEditDateBounds: jest.Mock };
      }
    ).electron.getSaleInvoiceEditDateBounds.mockResolvedValue({
      prevDate: '2025-06-20T12:00:00.000Z',
      nextDate: null,
    });

    const formSchema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [{ id: 10, name: 'I', price: 1, quantity: 99 } as never],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const { result } = renderHook(() =>
      useInvoiceDateValidation({
        invoiceType: InvoiceType.Sale,
        editInvoiceId: 99,
        useSingleAccount: true,
        splitByItemType: false,
        formSchema,
      }),
    );

    const msg = await result.current.validateInvoiceDateAgainstParties(
      baseValues as never,
    );
    expect(msg).toMatch(/on or after/);
    expect(msg).toMatch(/previous invoice date/);
  });

  it('sale edit single no split: rejects date after next bound', async () => {
    (
      window as unknown as {
        electron: { getSaleInvoiceEditDateBounds: jest.Mock };
      }
    ).electron.getSaleInvoiceEditDateBounds.mockResolvedValue({
      prevDate: null,
      nextDate: '2025-06-10T12:00:00.000Z',
    });

    const formSchema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [{ id: 10, name: 'I', price: 1, quantity: 99 } as never],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const { result } = renderHook(() =>
      useInvoiceDateValidation({
        invoiceType: InvoiceType.Sale,
        editInvoiceId: 99,
        useSingleAccount: true,
        splitByItemType: false,
        formSchema,
      }),
    );

    const msg = await result.current.validateInvoiceDateAgainstParties(
      baseValues as never,
    );
    expect(msg).toMatch(/on or before/);
    expect(msg).toMatch(/next invoice date/);
  });

  it('sale edit single no split: allows date within bounds', async () => {
    (
      window as unknown as {
        electron: { getSaleInvoiceEditDateBounds: jest.Mock };
      }
    ).electron.getSaleInvoiceEditDateBounds.mockResolvedValue({
      prevDate: '2025-06-01T12:00:00.000Z',
      nextDate: '2025-06-30T12:00:00.000Z',
    });

    const formSchema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [{ id: 10, name: 'I', price: 1, quantity: 99 } as never],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const { result } = renderHook(() =>
      useInvoiceDateValidation({
        invoiceType: InvoiceType.Sale,
        editInvoiceId: 99,
        useSingleAccount: true,
        splitByItemType: false,
        formSchema,
      }),
    );

    const msg = await result.current.validateInvoiceDateAgainstParties(
      baseValues as never,
    );
    expect(msg).toBeNull();
  });

  it('new invoice (no edit id): uses ledger min-date path', async () => {
    const ledgerDate = new Date('2025-06-01');
    (
      window as unknown as { electron: { getLedger: jest.Mock } }
    ).electron.getLedger.mockResolvedValue([
      { date: ledgerDate.toISOString() },
    ]);

    const formSchema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [{ id: 10, name: 'I', price: 1, quantity: 99 } as never],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const { result } = renderHook(() =>
      useInvoiceDateValidation({
        invoiceType: InvoiceType.Sale,
        editInvoiceId: undefined,
        useSingleAccount: true,
        splitByItemType: false,
        formSchema,
      }),
    );

    const msg = await result.current.validateInvoiceDateAgainstParties({
      ...baseValues,
      date: '2025-05-01T12:00:00.000Z',
    } as never);
    expect(msg).toMatch(/on or after/);
    expect(msg).toMatch(/last ledger date/);
  });

  it('returns null when no account ids resolved', async () => {
    const formSchema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const { result } = renderHook(() =>
      useInvoiceDateValidation({
        invoiceType: InvoiceType.Sale,
        editInvoiceId: undefined,
        useSingleAccount: true,
        splitByItemType: false,
        formSchema,
      }),
    );

    const msg = await result.current.validateInvoiceDateAgainstParties({
      ...baseValues,
      accountMapping: { singleAccountId: -1, multipleAccountIds: [] },
    } as never);
    expect(msg).toBeNull();
  });
});
