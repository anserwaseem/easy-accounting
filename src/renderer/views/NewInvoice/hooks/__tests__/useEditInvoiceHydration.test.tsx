import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { useForm } from 'react-hook-form';
import { InvoiceType } from 'types';
import type { Invoice, InvoiceView } from 'types';

import { getDefaultFormValues } from '../../schema';
import { useEditInvoiceHydration } from '../useEditInvoiceHydration';

jest.mock('renderer/shad/ui/use-toast', () => ({ toast: jest.fn() }));

const navigate = jest.fn();
const setUseSingleAccount = jest.fn();
const setSplitByItemType = jest.fn();
const setNextInvoiceNumber = jest.fn();
const setIsDateExplicitlySet = jest.fn();
const setEditHydrated = jest.fn();
const saleStockValidationBonusRef: React.MutableRefObject<
  Record<number, number>
> = { current: {} };

const line = (
  overrides: Partial<InvoiceView['invoiceItems'][0]> = {},
): InvoiceView['invoiceItems'][0] => ({
  price: 10,
  quantity: 1,
  discount: 0,
  inventoryItemName: 'Item',
  inventoryId: 1,
  discountedPrice: 10,
  ...overrides,
});

const makeInvoiceView = (overrides: Partial<InvoiceView>): InvoiceView => ({
  id: 1,
  date: '2025-01-01',
  invoiceNumber: 100,
  invoiceType: InvoiceType.Sale,
  totalAmount: 100,
  biltyNumber: '',
  cartons: 0,
  extraDiscount: 0,
  invoiceHeaderAccountId: 10,
  accountMapping: {
    singleAccountId: 10,
    multipleAccountIds: [],
  },
  invoiceItems: [line({ accountId: 10, inventoryId: 5 })],
  ...overrides,
});

const HydrationHarness = ({
  editInvoiceId,
  invoiceType,
}: {
  editInvoiceId: number | undefined;
  invoiceType: InvoiceType;
}) => {
  const form = useForm<Invoice>({
    defaultValues: getDefaultFormValues(invoiceType),
  });

  useEditInvoiceHydration({
    invoiceType,
    editInvoiceId,
    form,
    setUseSingleAccount,
    setSplitByItemType,
    setNextInvoiceNumber,
    setIsDateExplicitlySet,
    setEditHydrated,
    navigate,
    saleStockValidationBonusRef,
  });

  return <span data-testid="invoice-id">{String(form.watch('id'))}</span>;
};

describe('useEditInvoiceHydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saleStockValidationBonusRef.current = {};
    (
      window as unknown as {
        electron: { getInvoice: jest.Mock; getJournalsByInvoiceId: jest.Mock };
      }
    ).electron = {
      getInvoice: jest.fn(),
      getJournalsByInvoiceId: jest.fn(async () => [{ id: 1 }]),
    };
  });

  it('when editInvoiceId is null: does not fetch and sets edit hydrated false', () => {
    const {
      electron: { getInvoice, getJournalsByInvoiceId },
    } = window as unknown as {
      electron: { getInvoice: jest.Mock; getJournalsByInvoiceId: jest.Mock };
    };

    render(
      <HydrationHarness
        editInvoiceId={undefined}
        invoiceType={InvoiceType.Sale}
      />,
    );

    expect(getInvoice).not.toHaveBeenCalled();
    expect(getJournalsByInvoiceId).not.toHaveBeenCalled();
    expect(setEditHydrated).toHaveBeenCalledWith(false);
  });

  it('sale: multiple distinct row accounts enables split and maps row ids', async () => {
    const inv = makeInvoiceView({
      invoiceHeaderAccountId: 10,
      invoiceItems: [
        line({ accountId: 10, inventoryId: 1 }),
        line({ accountId: 20, inventoryId: 2 }),
      ],
    });
    (
      window as unknown as { electron: { getInvoice: jest.Mock } }
    ).electron.getInvoice.mockResolvedValue(inv);

    render(
      <HydrationHarness editInvoiceId={5} invoiceType={InvoiceType.Sale} />,
    );

    await waitFor(() => {
      expect(setUseSingleAccount).toHaveBeenCalledWith(true);
      expect(setSplitByItemType).toHaveBeenCalledWith(true);
      expect(setEditHydrated).toHaveBeenCalledWith(true);
    });

    expect(setNextInvoiceNumber).toHaveBeenCalledWith(100);
    expect(setIsDateExplicitlySet).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(screen.getByTestId('invoice-id').textContent).toBe('1');
    });
  });

  it('sale: single distinct account disables split and clears multiple ids', async () => {
    const inv = makeInvoiceView({
      invoiceHeaderAccountId: 55,
      invoiceItems: [line({ accountId: 55, inventoryId: 1 })],
    });
    (
      window as unknown as { electron: { getInvoice: jest.Mock } }
    ).electron.getInvoice.mockResolvedValue(inv);

    render(
      <HydrationHarness editInvoiceId={5} invoiceType={InvoiceType.Sale} />,
    );

    await waitFor(() => {
      expect(setSplitByItemType).toHaveBeenCalledWith(false);
    });
  });

  it('purchase: multiple distinct rows sets multi-customer mode', async () => {
    const inv = makeInvoiceView({
      invoiceType: InvoiceType.Purchase,
      invoiceHeaderAccountId: 1,
      invoiceItems: [
        line({ accountId: 2, inventoryId: 1 }),
        line({ accountId: 3, inventoryId: 2 }),
      ],
    });
    (
      window as unknown as { electron: { getInvoice: jest.Mock } }
    ).electron.getInvoice.mockResolvedValue(inv);

    render(
      <HydrationHarness editInvoiceId={5} invoiceType={InvoiceType.Purchase} />,
    );

    await waitFor(() => {
      expect(setUseSingleAccount).toHaveBeenCalledWith(false);
      expect(setSplitByItemType).toHaveBeenCalledWith(false);
    });
  });

  it('purchase: single row keeps one vendor mode', async () => {
    const inv = makeInvoiceView({
      invoiceType: InvoiceType.Purchase,
      invoiceHeaderAccountId: 7,
      invoiceItems: [line({ accountId: 7, inventoryId: 1 })],
    });
    (
      window as unknown as { electron: { getInvoice: jest.Mock } }
    ).electron.getInvoice.mockResolvedValue(inv);

    render(
      <HydrationHarness editInvoiceId={5} invoiceType={InvoiceType.Purchase} />,
    );

    await waitFor(() => {
      expect(setUseSingleAccount).toHaveBeenCalledWith(true);
    });
  });

  it('no linked journals: navigates to invoice details and shows toast', async () => {
    const { toast } = jest.requireMock('renderer/shad/ui/use-toast') as {
      toast: jest.Mock;
    };

    const inv = makeInvoiceView({});
    (
      window as unknown as { electron: { getInvoice: jest.Mock } }
    ).electron.getInvoice.mockResolvedValue(inv);
    (
      window as unknown as { electron: { getJournalsByInvoiceId: jest.Mock } }
    ).electron.getJournalsByInvoiceId.mockResolvedValue([]);

    render(
      <HydrationHarness editInvoiceId={5} invoiceType={InvoiceType.Sale} />,
    );

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/sale/invoices/5');
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      );
    });
    expect(setEditHydrated).not.toHaveBeenCalledWith(true);
  });

  it('invoice type mismatch: navigates away and shows toast', async () => {
    const { toast } = jest.requireMock('renderer/shad/ui/use-toast') as {
      toast: jest.Mock;
    };

    const inv = makeInvoiceView({ invoiceType: InvoiceType.Purchase });
    (
      window as unknown as { electron: { getInvoice: jest.Mock } }
    ).electron.getInvoice.mockResolvedValue(inv);

    render(
      <HydrationHarness editInvoiceId={5} invoiceType={InvoiceType.Sale} />,
    );

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/sale/invoices');
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      );
    });
  });

  it('sale: row without accountId falls back to header for mapping', async () => {
    const inv = makeInvoiceView({
      invoiceHeaderAccountId: 10,
      invoiceItems: [
        line({ accountId: undefined, inventoryId: 1 }),
        line({ accountId: 20, inventoryId: 2 }),
      ],
    });
    (
      window as unknown as { electron: { getInvoice: jest.Mock } }
    ).electron.getInvoice.mockResolvedValue(inv);

    render(
      <HydrationHarness editInvoiceId={5} invoiceType={InvoiceType.Sale} />,
    );

    await waitFor(() => {
      expect(setSplitByItemType).toHaveBeenCalledWith(true);
    });
  });

  it('sale: builds saleStockValidationBonusRef from quantities', async () => {
    const inv = makeInvoiceView({
      invoiceItems: [
        line({ accountId: 10, inventoryId: 100, quantity: 3 }),
        line({ accountId: 10, inventoryId: 100, quantity: 2 }),
      ],
    });
    (
      window as unknown as { electron: { getInvoice: jest.Mock } }
    ).electron.getInvoice.mockResolvedValue(inv);

    render(
      <HydrationHarness editInvoiceId={5} invoiceType={InvoiceType.Sale} />,
    );

    await waitFor(() => {
      expect(saleStockValidationBonusRef.current[100]).toBe(5);
    });
  });
});
