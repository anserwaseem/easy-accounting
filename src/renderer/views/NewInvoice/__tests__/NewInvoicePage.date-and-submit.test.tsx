import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

// stub out domain hooks so we only test date-confirm + submit flow
jest.mock('../hooks/useNewInvoiceInventory', () => ({
  useNewInvoiceInventory: () => [[{ id: 1, name: 'X', price: 1, quantity: 1 }]],
}));
jest.mock('../hooks/useNewInvoiceNextNumber', () => ({
  useNewInvoiceNextNumber: () => [1001, jest.fn()],
}));
jest.mock('../hooks/useNewInvoiceParties', () => ({
  useNewInvoiceParties: () => ({
    parties: [{ id: 10, name: 'P' }],
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

jest.mock('../hooks/useNewInvoiceFormCore', () => ({
  useNewInvoiceFormCore: () => {
    const form = {
      control: {},
      formState: { isSubmitting: false, errors: {} },
      getValues: jest.fn(() => submitValues),
      setValue: jest.fn(),
      reset: jest.fn(),
      clearErrors: jest.fn(),
      handleSubmit: (onValid: (values: any) => void) => () =>
        onValid(submitValues),
      setError: jest.fn(),
    };

    return {
      form,
      defaultFormValues: submitValues,
      formSchema: {} as any,
      fields: submitValues.invoiceItems,
      append: jest.fn(),
      watchedInvoiceItems: submitValues.invoiceItems,
      watchedExtraDiscount: 0,
      watchedTotalAmount: 10,
      watchedSingleAccountId: 10,
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
      getPrimaryItemType: jest.fn(async () => 1),
    };
  });

  it('Save and Print: opens date modal first, then submits and navigates to print after modal confirm', async () => {
    render(
      <MemoryRouter initialEntries={['/invoices/new']}>
        <NewInvoicePage invoiceType={InvoiceType.Sale} />
      </MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save and print/i }));
    });
    expect(await screen.findByTestId('date-modal')).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /use current date/i }),
      );
    });

    // navigation happens after insert resolves
    await act(async () => {});
    expect((window as any).electron.insertInvoice).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/invoices/77/print');
  });
});
