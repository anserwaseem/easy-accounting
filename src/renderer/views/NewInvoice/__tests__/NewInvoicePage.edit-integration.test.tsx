/**
 * Integration-style tests: real react-hook-form + zod (useNewInvoiceFormCore), real hooks,
 * minimal UI stubs. Exercises sale/purchase edit hydration and update submit path.
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
import { AccountType, InvoiceType } from 'types';
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

jest.mock('../components/DateConfirmationDialog', () => ({
  DateConfirmationDialog: () => null,
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

const inventoryRow = {
  id: 100,
  name: 'Widget',
  price: 10,
  quantity: 50,
  description: '',
  itemTypeId: 1,
  itemTypeName: 'T',
};

const inventoryRowB = {
  id: 101,
  name: 'Gadget',
  price: 8,
  quantity: 30,
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
    totalAmount: 100,
    biltyNumber: '',
    cartons: 0,
    extraDiscount: 0,
    invoiceHeaderAccountId: 10,
    accountMapping: { singleAccountId: 10, multipleAccountIds: [] },
    invoiceItems: [
      {
        price: 10,
        quantity: 2,
        discount: 0,
        inventoryItemName: 'Widget',
        inventoryId: 100,
        discountedPrice: 20,
        accountId: 10,
        itemTypeName: 'T',
      },
    ],
    ...overrides,
  };
}

function setupElectronForSaleEdit(inv: InvoiceView, overrides: any = {}) {
  const getInvoice = jest.fn(async () => inv);
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
    ]),
    getItemTypes: jest.fn(async () => [{ id: 1, name: 'T' }]),
    getInventory: jest.fn(async () => [inventoryRow, inventoryRowB]),
    getPrimaryItemType: jest.fn(async () => 1),
    getAccountByName: jest.fn(async () => null),
    getLedger: jest.fn(async () => []),
    getSaleInvoiceEditDateBounds: jest.fn(async () => ({
      prevDate: null,
      nextDate: null,
    })),
    getAccountByNameAndCode: jest.fn(async () => undefined),
    getAccountByNameAndChart: jest.fn(async () => undefined),
    updateInvoice: jest.fn(async () => ({ success: true })),
    insertInvoice: jest.fn(),
    getNextInvoiceNumber: jest.fn(),
    getAutoDiscount: jest.fn(async () => 0),
    ...overrides,
  };
  return { getInvoice };
}

function renderSaleEdit(path: string, inv: InvoiceView, overrides: any = {}) {
  const { getInvoice } = setupElectronForSaleEdit(inv, overrides);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <Routes>
          <Route
            path="/sale/invoices/:id/edit"
            element={<NewInvoicePage invoiceType={InvoiceType.Sale} />}
          />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { ...view, getInvoice };
}

function renderPurchaseEdit(
  path: string,
  inv: InvoiceView,
  overrides: any = {},
) {
  (
    window as unknown as {
      electron: Record<string, jest.Mock | typeof mockElectronStore>;
    }
  ).electron = {
    getInvoice: jest.fn(async () => inv),
    store: mockElectronStore,
    getJournalsByInvoiceId: jest.fn(async () => [{ id: 1 }]),
    getAccounts: jest.fn(async () => [
      saleAccount,
      purchaseAccount,
      {
        id: 20,
        name: 'VendorA',
        type: AccountType.Liability,
        code: 'VEN',
        chartId: 1,
        discountProfileId: null,
        discountProfileIsActive: null,
      },
    ]),
    getItemTypes: jest.fn(async () => []),
    getInventory: jest.fn(async () => [inventoryRow]),
    getPrimaryItemType: jest.fn(),
    getAccountByName: jest.fn(async () => null),
    getLedger: jest.fn(async () => []),
    getSaleInvoiceEditDateBounds: jest.fn(),
    getAccountByNameAndCode: jest.fn(),
    getAccountByNameAndChart: jest.fn(),
    updateInvoice: jest.fn(async () => ({ success: true })),
    insertInvoice: jest.fn(),
    getNextInvoiceNumber: jest.fn(),
    getAutoDiscount: jest.fn(async () => 0),
    ...overrides,
  };
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <Routes>
          <Route
            path="/purchase/invoices/:id/edit"
            element={<NewInvoicePage invoiceType={InvoiceType.Purchase} />}
          />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('NewInvoicePage edit integration', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it('sale edit: hydrates from getInvoice and shows edit chrome with invoice number', async () => {
    const inv = makeSaleInvoiceView();
    const { getInvoice } = renderSaleEdit('/sale/invoices/42/edit', inv);

    await waitFor(() => {
      expect(getInvoice).toHaveBeenCalledWith(42);
    });

    expect(
      await screen.findByRole('heading', { name: /Edit Sale Invoice/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('#500')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /back to invoice/i }),
    ).toBeInTheDocument();
  });

  it('sale edit: Save dispatches updateInvoice with hydrated id', async () => {
    const inv = makeSaleInvoiceView();
    renderSaleEdit('/sale/invoices/42/edit', inv);

    await screen.findByRole('heading', { name: /Edit Sale Invoice/i });

    const saveBtn = screen.getByRole('button', { name: /^save$/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    const { updateInvoice } = (
      window as unknown as { electron: { updateInvoice: jest.Mock } }
    ).electron;

    await waitFor(() => {
      expect(updateInvoice).toHaveBeenCalled();
    });

    expect(updateInvoice).toHaveBeenCalledWith(
      InvoiceType.Sale,
      42,
      expect.objectContaining({
        id: 42,
        invoiceNumber: 500,
        invoiceType: InvoiceType.Sale,
      }),
    );
  });

  it('purchase edit: hydrates multi-vendor invoice and shows edit heading', async () => {
    const inv: InvoiceView = {
      id: 7,
      date: '2025-03-01T12:00:00.000Z',
      invoiceNumber: 80,
      invoiceType: InvoiceType.Purchase,
      totalAmount: 50,
      biltyNumber: '',
      cartons: 0,
      extraDiscount: 0,
      invoiceHeaderAccountId: 20,
      accountMapping: {
        singleAccountId: undefined,
        multipleAccountIds: [20, 21],
      },
      invoiceItems: [
        {
          price: 5,
          quantity: 1,
          discount: 0,
          inventoryItemName: 'Widget',
          inventoryId: 100,
          discountedPrice: 5,
          accountId: 20,
        },
        {
          price: 8,
          quantity: 1,
          discount: 0,
          inventoryItemName: 'Gadget',
          inventoryId: 101,
          discountedPrice: 8,
          accountId: 21,
        },
      ],
    };

    (
      window as unknown as {
        electron: Record<string, jest.Mock | typeof mockElectronStore>;
      }
    ).electron = {
      getInvoice: jest.fn(async () => inv),
      store: mockElectronStore,
      getJournalsByInvoiceId: jest.fn(async () => [{ id: 1 }]),
      getAccounts: jest.fn(async () => [
        saleAccount,
        purchaseAccount,
        {
          id: 20,
          name: 'V1',
          type: AccountType.Liability,
          code: 'V1',
          chartId: 1,
          discountProfileId: null,
          discountProfileIsActive: null,
        },
        {
          id: 21,
          name: 'V2',
          type: AccountType.Liability,
          code: 'V2',
          chartId: 1,
          discountProfileId: null,
          discountProfileIsActive: null,
        },
      ]),
      getItemTypes: jest.fn(async () => []),
      getInventory: jest.fn(async () => [inventoryRow, inventoryRowB]),
      getPrimaryItemType: jest.fn(),
      getAccountByName: jest.fn(async () => null),
      getLedger: jest.fn(async () => []),
      getSaleInvoiceEditDateBounds: jest.fn(),
      getAccountByNameAndCode: jest.fn(),
      getAccountByNameAndChart: jest.fn(),
      updateInvoice: jest.fn(async () => ({ success: true })),
      insertInvoice: jest.fn(),
      getNextInvoiceNumber: jest.fn(),
      getAutoDiscount: jest.fn(async () => 0),
    };

    render(
      <MemoryRouter initialEntries={['/purchase/invoices/7/edit']}>
        <TooltipProvider>
          <Routes>
            <Route
              path="/purchase/invoices/:id/edit"
              element={<NewInvoicePage invoiceType={InvoiceType.Purchase} />}
            />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(window.electron.getInvoice).toHaveBeenCalledWith(7);
    });

    expect(
      await screen.findByRole('heading', { name: /Edit Purchase Invoice/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('#80')).toBeInTheDocument();
  });

  it('purchase edit: Save dispatches updateInvoice with correct ID and shape', async () => {
    const inv: InvoiceView = {
      id: 7,
      date: '2025-03-01T12:00:00.000Z',
      invoiceNumber: 80,
      invoiceType: InvoiceType.Purchase,
      totalAmount: 50,
      biltyNumber: '',
      cartons: 0,
      extraDiscount: 0,
      invoiceHeaderAccountId: 20,
      accountMapping: {
        singleAccountId: 20,
        multipleAccountIds: [],
      },
      invoiceItems: [
        {
          price: 50,
          quantity: 1,
          discount: 0,
          inventoryItemName: 'Widget',
          inventoryId: 100,
          discountedPrice: 50,
          accountId: 20,
        },
      ],
    };

    renderPurchaseEdit('/purchase/invoices/7/edit', inv);

    await screen.findByRole('heading', { name: /Edit Purchase Invoice/i });

    const saveBtn = screen.getByRole('button', { name: /^save$/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    const { updateInvoice } = (
      window as unknown as { electron: { updateInvoice: jest.Mock } }
    ).electron;

    await waitFor(() => {
      expect(updateInvoice).toHaveBeenCalledWith(
        InvoiceType.Purchase,
        7,
        expect.objectContaining({
          id: 7,
          invoiceNumber: 80,
          invoiceType: InvoiceType.Purchase,
        }),
      );
    });
  });

  it('sale edit: Sale + Print calls updateInvoice', async () => {
    const inv = makeSaleInvoiceView();
    renderSaleEdit('/sale/invoices/42/edit', inv);

    await screen.findByRole('heading', { name: /Edit Sale Invoice/i });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save and print/i }));
    });

    const { updateInvoice } = (
      window as unknown as { electron: { updateInvoice: jest.Mock } }
    ).electron;

    await waitFor(() => {
      expect(updateInvoice).toHaveBeenCalledWith(
        InvoiceType.Sale,
        42,
        expect.any(Object),
      );
    });
  });

  it('sale edit: updateInvoice failure does not navigate', async () => {
    const updateInvoice = jest.fn(async () => {
      throw new Error('DB locked');
    });
    const inv = makeSaleInvoiceView();
    renderSaleEdit('/sale/invoices/42/edit', inv, { updateInvoice });

    await screen.findByRole('heading', { name: /Edit Sale Invoice/i });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    });

    await waitFor(() => {
      expect(updateInvoice).toHaveBeenCalled();
    });

    expect(navigateMock).not.toHaveBeenCalledWith('/sale/invoices/42');
  });
});
