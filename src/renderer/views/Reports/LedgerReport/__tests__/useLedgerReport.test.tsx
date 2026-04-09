import { act, renderHook } from '@testing-library/react';
import { BalanceType, type LedgerRangeResponse } from 'types';

import { useLedgerReport } from '../useLedgerReport';

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useLedgerReport', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (window as any).electron = {
      store: {
        get: jest.fn(() => ({})),
        set: jest.fn(),
      },
      getAccounts: jest.fn(async () => [{ id: 1, name: 'Sale' }]),
      reportGetLedgerRange: jest.fn(
        async (): Promise<LedgerRangeResponse> => ({
          openingBalance: null,
          entries: [],
          closingBalance: null,
        }),
      ),
    } as any;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls reportGetLedgerRange with local YYYY-MM-DD (no UTC shift)', async () => {
    const { result } = renderHook(() => useLedgerReport());

    // settle initial accounts fetch
    await flushMicrotasks();

    act(() => {
      result.current.setSelectedAccount(1);
      result.current.handleDateChange(
        {
          from: new Date(2026, 2, 1), // Mar 1, 2026 (local)
          to: new Date(2026, 2, 31), // Mar 31, 2026 (local)
        },
        'custom',
      );
    });

    await flushMicrotasks();

    expect(window.electron.reportGetLedgerRange).toHaveBeenCalledWith({
      accountId: 1,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
  });

  it('renders Opening Balance date as (startDate - 1 day)', async () => {
    (window as any).electron.reportGetLedgerRange = jest.fn(
      async (): Promise<LedgerRangeResponse> => ({
        openingBalance: {
          balance: 100,
          balanceType: BalanceType.Cr,
          date: 'ignored',
        },
        entries: [],
        closingBalance: null,
      }),
    );

    const { result } = renderHook(() => useLedgerReport());
    await flushMicrotasks();

    act(() => {
      result.current.setSelectedAccount(1);
      result.current.handleDateChange(
        {
          from: new Date(2026, 1, 21), // Feb 21, 2026
          to: new Date(2026, 1, 28), // Feb 28, 2026
        },
        'custom',
      );
    });

    await flushMicrotasks();

    expect(result.current.ledgerEntries[0]?.particulars).toBe(
      'Opening Balance',
    );
    expect(result.current.ledgerEntries[0]?.date).toBe('2026-02-20');
  });
});
