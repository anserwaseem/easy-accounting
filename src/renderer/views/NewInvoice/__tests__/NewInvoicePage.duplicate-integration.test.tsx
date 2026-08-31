/**
 * Integration-style tests for the Duplicate flow: navigating to the new-invoice
 * route with router state {duplicateFromId} prefills customer + items via the
 * shared edit-mode mapping, reprices at current inventory prices, and does NOT
 * copy the invoice number. A duplicated quotation saves as a quotation of the
 * same type. Also covers the party balance indicator on the sale screen.
 */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TooltipProvider } from '@/renderer/shad/ui/tooltip';
import { BLOCK_SAVE_WHEN_SPLIT_TYPED_ACCOUNT_MISSING_KEY } from '@/renderer/lib/invoiceBehaviorStore';
import { AccountType, BalanceType, InvoiceType } from 'types';
import type { InvoiceView } from 'types';

import NewInvoicePage from '../index';

const mockElectronStore = {
  get: jest.fn((key: string) =>
    key === BLOCK_SAVE_WHEN_SPLIT_TYPED_ACCOUNT_MISSING_KEY ? false : undefined,
  ),
  set: jest.fn(),
  delete: jest.fn(),
};

jest.mock('@/renderer/components/VirtualSelect', () => ({
  __esModule: true,
  default: ({ placeholder }: { placeholder?: string }) => (
    <div data-testid="virtual-select">{placeholder ?? 'select'}</div>
  ),
}));

jest.mock('renderer/shad/ui/dataTable', () => ({
  DataTable: () => <div data-testid="invoice-line-table" />,
}));

// duplicate starts as a normal new invoice (date not explicitly set), so Save
// opens the date confirmation; expose its confirm action as a plain button
jest.mock('../components/DateConfirmationDialog', () => ({
  DateConfirmationDialog: ({
    open,
    onUseCurrentDate,
  }: {
    open: boolean;
    onUseCurrentDate: () => void;
  }) =>
    open ? (
      <button type="button" onClick={onUseCurrentDate}>
        use-current-date
      </button>
    ) : null,
}));

jest.mock('renderer/shad/ui/use-toast', () => ({
  toast: jest.fn(),
}));

const navigateMock = jest.fn();

jest.mock('react-router-dom', () => ({
  ...(jest.requireActual('react-router-dom') as object),
  useNavigate: () => navigateMock,
}));

const saleAccount = {
  id: 1,
  name: 'Sale',
  type: AccountType.Revenue,
  code: 'SALE',
  chartId: 1,
  discountProfileId: null,
  discountProfileIsActive: null,
};
const purchaseAccount = {
  id: 2,
  name: 'Purchase',
  type: AccountType.Expense,
  code: 'PUR',
  chartId: 1,
  discountProfileId: null,
  discountProfileIsActive: null,
};
const customerAccount = {
  id: 10,
  name: 'Retail',
  type: AccountType.Asset,
  code: 'RET',
  chartId: 1,
  discountProfileId: null,
  discountProfileIsActive: null,
};
const vendorAccount = {
  id: 20,
  name: 'VendorA',
  type: AccountType.Liability,
  code: 'VEN',
  chartId: 1,
  discountProfileId: null,
  discountProfileIsActive: null,
};

// current inventory price (12) intentionally differs from the source
// invoice's old line price (10) to prove repricing
const inventoryRow = {
  id: 100,
  name: 'Widget',
  price: 12,
  quantity: 50,
  description: '',
  itemTypeId: 1,
  itemTypeName: 'T',
};

function makeSaleInvoiceView(
  overrides: Partial<InvoiceView> = {},
): InvoiceView {
  return {
    id: 42,
    date: '2025-03-01T12:00:00.000Z',
    invoiceNumber: 500,
    invoiceType: InvoiceType.Sale,
    totalAmount: 19,
    biltyNumber: '77',
    cartons: 3,
    extraDiscount: 0,
    invoiceHeaderAccountId: 10,
    accountMapping: { singleAccountId: 10, multipleAccountIds: [] },
    invoiceItems: [
      {
        price: 10,
        quantity: 2,
        discount: 5,
        inventoryItemName: 'Widget',
        inventoryId: 100,
        discountedPrice: 19,
        accountId: 10,
        itemTypeName: 'T',
      },
    ],
    ...overrides,
  };
}

function setupElectron(inv: InvoiceView | undefined, overrides: any = {}) {
  const getInvoice = jest.fn(async () => inv);
  const insertInvoice = jest.fn(async () => ({
    invoiceId: 901,
    nextInvoiceNumber: 778,
  }));
  const insertQuotation = jest.fn(async () => ({ invoiceId: 902 }));
  const getLedgerBalance = jest.fn(async () => ({
    balance: 13498,
    balanceType: BalanceType.Dr,
  }));
  (
    window as unknown as {
      electron: Record<string, jest.Mock | typeof mockElectronStore>;
    }
  ).electron = {
    getInvoice,
    store: mockElectronStore,
    getJournalsByInvoiceId: jest.fn(async () => [{ id: 1 }]),
    getAccounts: jest.fn(async () => [
      saleAccount,
      purchaseAccount,
      customerAccount,
      vendorAccount,
    ]),
    getItemTypes: jest.fn(async () => [{ id: 1, name: 'T' }]),
    getInventory: jest.fn(async () => [inventoryRow]),
    getPrimaryItemType: jest.fn(async () => 1),
    getAccountByName: jest.fn(async () => null),
    getLedger: jest.fn(async () => []),
    getLedgerBalance,
    getSaleInvoiceEditDateBounds: jest.fn(async () => ({
      prevDate: null,
      nextDate: null,
    })),
    getAccountByNameAndCode: jest.fn(async () => undefined),
    getAccountByNameAndChart: jest.fn(async () => undefined),
    updateInvoice: jest.fn(async () => ({ success: true })),
    insertInvoice,
    insertQuotation,
    getNextInvoiceNumber: jest.fn(async () => 777),
    getAutoDiscount: jest.fn(async () => 0),
    ...overrides,
  };
  return { getInvoice, insertInvoice, insertQuotation, getLedgerBalance };
}

function renderNew(invoiceType: InvoiceType, duplicateFromId?: number) {
  const path = `/${invoiceType.toLowerCase()}/invoices/new`;
  return render(
    <MemoryRouter
      initialEntries={[
        duplicateFromId != null
          ? { pathname: path, state: { duplicateFromId } }
          : { pathname: path },
      ]}
    >
      <TooltipProvider>
        <Routes>
          <Route
            path={path}
            element={<NewInvoicePage invoiceType={invoiceType} />}
          />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

async function saveThroughDateConfirmation(saveButtonName: RegExp) {
  const saveBtn = screen.getByRole('button', { name: saveButtonName });
  await waitFor(() => expect(saveBtn).toBeEnabled());
  await act(async () => {
    fireEvent.click(saveBtn);
  });
  const confirmBtn = await screen.findByRole('button', {
    name: /use-current-date/i,
  });
  await act(async () => {
    fireEvent.click(confirmBtn);
  });
}

describe('NewInvoicePage duplicate integration', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it('sale duplicate: prefills customer + items at current prices with a fresh invoice number', async () => {
    const { getInvoice, insertInvoice } = setupElectron(makeSaleInvoiceView());
    renderNew(InvoiceType.Sale, 42);

    await waitFor(() => {
      expect(getInvoice).toHaveBeenCalledWith(42);
    });

    // stays a plain new invoice (no edit chrome)
    expect(
      await screen.findByRole('heading', { name: /New Sale Invoice/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /back to invoice/i }),
    ).not.toBeInTheDocument();

    // customer prefilled -> balance indicator appears for the selected account
    expect(await screen.findByText(/Balance:/)).toBeInTheDocument();
    expect(window.electron.getLedgerBalance).toHaveBeenCalledWith(10);

    await saveThroughDateConfirmation(/^save$/i);

    await waitFor(() => {
      expect(insertInvoice).toHaveBeenCalled();
    });
    const [sentType, sentInvoice] = insertInvoice.mock.calls[0] as unknown as [
      InvoiceType,
      any,
    ];
    expect(sentType).toBe(InvoiceType.Sale);
    // fresh number from the next-number flow, NOT the source's 500
    expect(sentInvoice.invoiceNumber).toBe(777);
    // customer carried over
    expect(sentInvoice.accountMapping.singleAccountId).toBe(10);
    // items carried with quantity + discount, repriced at CURRENT price 12 (not old 10)
    expect(sentInvoice.invoiceItems).toHaveLength(1);
    expect(sentInvoice.invoiceItems[0]).toEqual(
      expect.objectContaining({
        inventoryId: 100,
        quantity: 2,
        discount: 5,
        price: 12,
      }),
    );
    // consignment fields start fresh on a duplicate
    expect(sentInvoice.biltyNumber ?? '').toBe('');
    expect(sentInvoice.cartons ?? 0).toBe(0);
  });

  it('quotation duplicate: saves as a quotation of the same type', async () => {
    const { getInvoice, insertInvoice, insertQuotation } = setupElectron(
      makeSaleInvoiceView({ isQuotation: true, invoiceNumber: -2 }),
    );
    renderNew(InvoiceType.Sale, 42);

    await waitFor(() => {
      expect(getInvoice).toHaveBeenCalledWith(42);
    });

    expect(
      await screen.findByRole('heading', { name: /New Sale Quotation/i }),
    ).toBeInTheDocument();

    // primary action saves a quotation; the plain invoice Save is gone
    expect(
      screen.queryByRole('button', { name: /^save$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /save as quotation/i }),
    ).toHaveLength(1);

    await saveThroughDateConfirmation(/save as quotation/i);

    await waitFor(() => {
      expect(insertQuotation).toHaveBeenCalled();
    });
    const [sentType, sentQuotation] = insertQuotation.mock
      .calls[0] as unknown as [InvoiceType, any];
    expect(sentType).toBe(InvoiceType.Sale);
    // quotations use the placeholder number, never the source's number
    expect(sentQuotation.invoiceNumber).toBe(-1);
    expect(sentQuotation.accountMapping.singleAccountId).toBe(10);
    expect(sentQuotation.invoiceItems[0]).toEqual(
      expect.objectContaining({ inventoryId: 100, quantity: 2, price: 12 }),
    );
    expect(insertInvoice).not.toHaveBeenCalled();
  });

  it('purchase duplicate: prefills vendor + items and shows no balance indicator', async () => {
    const inv = makeSaleInvoiceView({
      invoiceType: InvoiceType.Purchase,
      invoiceHeaderAccountId: 20,
      accountMapping: { singleAccountId: 20, multipleAccountIds: [] },
      invoiceItems: [
        {
          price: 10,
          quantity: 4,
          discount: 0,
          inventoryItemName: 'Widget',
          inventoryId: 100,
          discountedPrice: 40,
          accountId: 20,
        },
      ],
    });
    const { getInvoice, insertInvoice } = setupElectron(inv);
    renderNew(InvoiceType.Purchase, 42);

    await waitFor(() => {
      expect(getInvoice).toHaveBeenCalledWith(42);
    });

    expect(
      await screen.findByRole('heading', { name: /New Purchase Invoice/i }),
    ).toBeInTheDocument();

    // balance indicator is a sale-screen feature
    expect(screen.queryByText(/Balance:/)).not.toBeInTheDocument();

    await saveThroughDateConfirmation(/^save$/i);

    await waitFor(() => {
      expect(insertInvoice).toHaveBeenCalled();
    });
    const [sentType, sentInvoice] = insertInvoice.mock.calls[0] as unknown as [
      InvoiceType,
      any,
    ];
    expect(sentType).toBe(InvoiceType.Purchase);
    expect(sentInvoice.invoiceNumber).toBe(777);
    expect(sentInvoice.accountMapping.singleAccountId).toBe(20);
    expect(sentInvoice.invoiceItems[0]).toEqual(
      expect.objectContaining({ inventoryId: 100, quantity: 4, price: 12 }),
    );
  });

  it('plain new invoice (no duplicate state): does not load any invoice and shows no balance', async () => {
    const { getInvoice } = setupElectron(undefined);
    renderNew(InvoiceType.Sale);

    expect(
      await screen.findByRole('heading', { name: /New Sale Invoice/i }),
    ).toBeInTheDocument();

    expect(getInvoice).not.toHaveBeenCalled();
    // no party selected -> indicator hidden
    expect(screen.queryByText(/Balance:/)).not.toBeInTheDocument();
    expect(screen.queryByText('No balance')).not.toBeInTheDocument();
  });
});
