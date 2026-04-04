import { act, renderHook, waitFor } from '@testing-library/react';
import type { Account } from 'types';
import { AccountType, InvoiceType } from 'types';
import { useNewInvoiceParties } from '../hooks/useNewInvoiceParties';

jest.mock('renderer/shad/ui/use-toast', () => ({
  toast: jest.fn(),
}));

const baseAccount = (overrides: Partial<Account>): Account => ({
  id: 1,
  date: '2020-01-01',
  isActive: true,
  name: 'X',
  chartId: 1,
  type: AccountType.Asset,
  code: 'c',
  discountProfileId: null,
  discountProfileIsActive: null,
  ...overrides,
});

describe('useNewInvoiceParties', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('for sale: exposes asset parties, flags required sale/purchase ledgers, excludes typed suffix accounts', async () => {
    const getAccounts = jest.fn().mockResolvedValue([
      baseAccount({
        id: 1,
        name: 'Sale',
        type: AccountType.Revenue,
        code: 'SALE',
      }),
      baseAccount({
        id: 2,
        name: 'Purchase',
        type: AccountType.Expense,
        code: 'PUR',
      }),
      baseAccount({
        id: 10,
        name: 'Retail customer',
        type: AccountType.Asset,
        code: 'RET',
      }),
      baseAccount({
        id: 11,
        name: 'Retail customer-T',
        type: AccountType.Asset,
        code: 'RET-T',
      }),
      baseAccount({
        id: 12,
        name: 'B-WASEEM',
        type: AccountType.Asset,
        code: 'B-WASEEM',
      }),
    ]);
    const getItemTypes = jest.fn().mockResolvedValue([{ id: 1, name: 'T' }]);

    (
      window as unknown as {
        electron: {
          getAccounts: jest.Mock;
          getItemTypes: jest.Mock;
        };
      }
    ).electron = { getAccounts, getItemTypes };

    const { result } = renderHook(() => useNewInvoiceParties(InvoiceType.Sale));

    await waitFor(() => {
      expect(result.current.requiredAccountsExist.loading).toBe(false);
    });

    expect(result.current.requiredAccountsExist.sale).toBe(true);
    expect(result.current.requiredAccountsExist.purchase).toBe(true);
    expect(result.current.parties?.map((p) => p.id)).toEqual([10, 12]);
    expect(result.current.partiesIncludingTyped?.map((p) => p.id)).toEqual([
      10, 11, 12,
    ]);
  });

  it('refreshParties refetches accounts and shows success toast', async () => {
    const getAccounts = jest.fn().mockResolvedValue([
      baseAccount({
        id: 1,
        name: 'Sale',
        type: AccountType.Revenue,
        code: 'SALE',
      }),
      baseAccount({
        id: 2,
        name: 'Purchase',
        type: AccountType.Expense,
        code: 'PUR',
      }),
      baseAccount({
        id: 20,
        name: 'Vendor',
        type: AccountType.Liability,
        code: 'V1',
      }),
    ]);

    (window as unknown as { electron: { getAccounts: jest.Mock } }).electron = {
      getAccounts,
    };

    const { toast } = jest.requireMock('renderer/shad/ui/use-toast') as {
      toast: jest.Mock;
    };

    const { result } = renderHook(() =>
      useNewInvoiceParties(InvoiceType.Purchase),
    );

    await waitFor(() => {
      expect(result.current.parties?.length).toBe(1);
    });

    expect(getAccounts).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refreshParties();
    });

    expect(getAccounts).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' }),
    );
  });
});
