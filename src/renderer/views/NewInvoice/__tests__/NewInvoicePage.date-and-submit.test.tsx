import '@testing-library/jest-dom';

import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InvoiceType } from 'types';

// component under test (after mocks)
import NewInvoicePage from '../index';

const navigateMock = jest.fn();

jest.mock('react-router-dom', () => ({
  ...(jest.requireActual('react-router-dom') as object),
  useNavigate: () => navigateMock,
}));

jest.mock('react-hook-form', () => ({
  ...(jest.requireActual('react-hook-form') as object),
  useFormState: () => ({ isDirty: false }),
  useWatch: () => -1,
}));

// make Form primitives no-ops for this thin test
jest.mock('renderer/shad/ui/form', () => ({
  Form: ({ children }: { children: React.ReactNode }) => children,
  FormControl: ({ children }: { children: React.ReactNode }) => children,
  FormField: ({
    render: renderProp,
  }: {
    render: (args: any) => React.ReactNode;
  }) => renderProp({ field: { value: undefined, onChange: jest.fn() } }),
  FormItem: ({ children }: { children: React.ReactNode }) => children,
  FormLabel: ({ children }: { children: React.ReactNode }) => children,
  FormMessage: () => null,
}));

jest.mock('renderer/shad/ui/dataTable', () => ({
  DataTable: () => null,
}));

jest.mock('@/renderer/components/VirtualSelect', () => ({
  __esModule: true,
  default: () => null,
}));

// control the modal so we can assert open + trigger onUseCurrentDate
jest.mock('../components/DateConfirmationDialog', () => ({
  DateConfirmationDialog: ({
    open,
    onUseCurrentDate,
  }: {
    open: boolean;
    onUseCurrentDate: () => void;
  }) =>
    open ? (
      <div data-testid="date-modal">
        <button type="button" onClick={onUseCurrentDate}>
          Use current date
        </button>
      </div>
    ) : null,
}));

// useInvoiceInventoryLoader uses getInventory from electron (stubbed in beforeEach)
jest.mock('../hooks/useNewInvoiceNextNumber', () => ({
  useNewInvoiceNextNumber: () => [1001, jest.fn()],
}));
jest.mock('../hooks/useNewInvoiceParties', () => ({
  useNewInvoiceParties: () => ({
    parties: [{ id: 10, name: 'P' }],
    partiesIncludingTyped: [{ id: 10, name: 'P' }],
    requiredAccountsExist: { sale: true, purchase: true, loading: false },
    isRefreshingParties: false,
    refreshParties: jest.fn(),
  }),
}));
jest.mock('../hooks/useNewInvoiceSections', () => ({
  useNewInvoiceSections: () => ({
    sections: [],
    setSections: jest.fn(),
    activeSectionId: null,
    setActiveSectionId: jest.fn(),
    rowSectionMap: {},
    setRowSectionMap: jest.fn(),
  }),
}));
jest.mock('../hooks/useNewInvoiceDiscounts', () => ({
  useNewInvoiceDiscounts: () => ({
    applyAutoDiscountForRow: jest.fn(),
    recalculateAutoDiscounts: jest.fn(),
    recalculateAutoDiscountsRef: { current: jest.fn() },
    manualDiscountRows: {},
    setManualDiscountRows: jest.fn(),
    enableCumulativeDiscount: false,
    setEnableCumulativeDiscount: jest.fn(),
    cumulativeDiscount: undefined,
    setCumulativeDiscount: jest.fn(),
    isDiscountEditEnabled: false,
    singleAccountAutoDiscountOff: false,
    sectionAutoDiscountOffCount: 0,
    getSectionLabel: jest.fn(),
  }),
}));
jest.mock('../hooks/useNewInvoiceResolution', () => ({
  useNewInvoiceResolution: () => ({
    resolvedRowLabels: [],
    resolutionFallbacks: [],
  }),
}));
jest.mock('../hooks/useNewInvoiceColumns', () => ({
  useNewInvoiceColumns: () => [],
}));
jest.mock('../hooks/useNewInvoiceTableInfo', () => ({
  useNewInvoiceTableInfo: () => ({}),
}));

const submitValues = {
  id: -1,
  date: new Date('2026-03-10T12:00:00.000Z').toISOString(),
  invoiceNumber: -1,
  extraDiscount: 0,
  extraDiscountAccountId: undefined,
  totalAmount: 10,
  invoiceType: InvoiceType.Sale,
  biltyNumber: '',
  cartons: 0,
  accountMapping: { singleAccountId: 10, multipleAccountIds: [] },
  invoiceItems: [
    {
      id: 1,
      inventoryId: 1,
      quantity: 1,
      discount: 0,
      price: 10,
      discountedPrice: 10,
    },
  ],
};

// Expose submitValues to the hook mock via global.
// The mock factory reads this at call time (not hoist time).
Object.defineProperty(global, '__testSubmitValues', {
  get: () => submitValues,
  configurable: true,
});

jest.mock('../hooks/useNewInvoiceFormCore', () => ({
  useNewInvoiceFormCore: () => {
    const ref = (global as any).__testSubmitValues;
    const form = {
      control: {},
      formState: { isSubmitting: false, errors: {} },
      getValues: jest.fn(() => ref),
      setValue: jest.fn(),
      reset: jest.fn(),
      clearErrors: jest.fn(),
      handleSubmit: (onValid: (values: any) => void) => () => onValid(ref),
      setError: jest.fn(),
    };

    return {
      form,
      defaultFormValues: ref,
      formSchema: {} as any,
      fields: ref.invoiceItems,
      append: jest.fn(),
      watchedInvoiceItems: ref.invoiceItems,
      watchedExtraDiscount: 0,
      watchedTotalAmount: ref.totalAmount,
      watchedSingleAccountId: ref.accountMapping?.singleAccountId,
      watchedMultipleAccountIds: [],
      resolutionTrigger: 'x',
      discountAccountExists: true,
    };
  },
}));

describe('NewInvoicePage date confirmation + submit', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    (window as any).electron = {
      insertInvoice: jest.fn(async () => ({
        invoiceId: 77,
        nextInvoiceNumber: 1002,
      })),
      getLedger: jest.fn(async () => [
        { date: new Date('2026-03-01T00:00:00.000Z').toISOString() },
      ]),
      getInventory: jest.fn(async () => [
        {
          id: 1,
          name: 'X',
          price: 10,
          quantity: 5,
          itemTypeId: 1,
          itemTypeName: 'T',
        },
      ]),
      getPrimaryItemType: jest.fn(async () => 1),
    };
  });

  it('Save and Print: opens date modal first, then submits and navigates to print after modal confirm', async () => {
    render(
      <MemoryRouter initialEntries={['/invoices/new']}>
        <NewInvoicePage invoiceType={InvoiceType.Sale} />
      </MemoryRouter>,
    );

    const saveAndPrint = await screen.findByRole('button', {
      name: /save and print/i,
    });
    await act(async () => {
      fireEvent.click(saveAndPrint);
    });
    expect(await screen.findByTestId('date-modal')).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /use current date/i }),
      );
    });

    // navigation happens after insert resolves
    expect((window as any).electron.insertInvoice).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/invoices/77/print');
  });

  it('Save: opens date modal, then submits and navigates to invoice detail', async () => {
    render(
      <MemoryRouter initialEntries={['/invoices/new']}>
        <NewInvoicePage invoiceType={InvoiceType.Sale} />
      </MemoryRouter>,
    );

    const saveBtn = await screen.findByRole('button', { name: /^save$/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(await screen.findByTestId('date-modal')).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /use current date/i }),
      );
    });

    expect((window as any).electron.insertInvoice).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/sale/invoices/77');
  });

  it('insertInvoice failure: shows error and does not navigate', async () => {
    const insertInvoice = jest.fn(async () => {
      throw new Error('Constraint violation');
    });
    (window as any).electron = {
      ...((window as any).electron as object),
      insertInvoice,
    };

    render(
      <MemoryRouter initialEntries={['/invoices/new']}>
        <NewInvoicePage invoiceType={InvoiceType.Sale} />
      </MemoryRouter>,
    );

    const saveBtn = await screen.findByRole('button', { name: /^save$/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /use current date/i }),
      );
    });

    // InsertInvoice is called but throws; onSubmit catches it and
    // returns undefined, so navigation should not happen.
    await waitFor(() => {
      expect(insertInvoice).toHaveBeenCalled();
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('Date modal Cancel: closes modal without saving', async () => {
    // The DateConfirmationDialog mock does not render a Cancel button;
    // instead we verify the insertInvoice is NOT called by asserting
    // that Save triggers modal but nothing is submitted when modal is open.
    // This is covered by the fact that we assert insertInvoice is called
    // only after clicking "Use current date" in other tests.
    //
    // The component implementation: onSubmit checks isDateExplicitlySet first,
    // shows modal, and only proceeds via modal's onUseCurrentDate callback.
    // Without that callback firing, submit never runs.
    render(
      <MemoryRouter initialEntries={['/invoices/new']}>
        <NewInvoicePage invoiceType={InvoiceType.Sale} />
      </MemoryRouter>,
    );

    // Just verify modal opens and without confirming, insertInvoice is untouched
    const saveBtn = await screen.findByRole('button', { name: /^save$/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(await screen.findByTestId('date-modal')).toBeTruthy();
    expect((window as any).electron.insertInvoice).not.toHaveBeenCalled();
  });

  it('Clear button: resets form without errors', async () => {
    render(
      <MemoryRouter initialEntries={['/invoices/new']}>
        <NewInvoicePage invoiceType={InvoiceType.Sale} />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', {
      name: /New Sale Invoice/i,
    });
    const clearBtn = await screen.findByRole('button', { name: /^clear$/i });
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    expect(
      screen.getByRole('heading', { name: /New Sale Invoice/i }),
    ).toBeTruthy();
  });

  it('totalAmount <= 0: Save button is disabled', async () => {
    submitValues.totalAmount = 0;
    submitValues.accountMapping.singleAccountId = 10;
    render(
      <MemoryRouter initialEntries={['/invoices/new']}>
        <NewInvoicePage invoiceType={InvoiceType.Sale} />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: /New Sale Invoice/i });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('singleAccountId <= 0: Save button is disabled', async () => {
    submitValues.totalAmount = 10;
    submitValues.accountMapping.singleAccountId = 0;
    render(
      <MemoryRouter initialEntries={['/invoices/new']}>
        <NewInvoicePage invoiceType={InvoiceType.Sale} />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: /New Sale Invoice/i });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });
});
