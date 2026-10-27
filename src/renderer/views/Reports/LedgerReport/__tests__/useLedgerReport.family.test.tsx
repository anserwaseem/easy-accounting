import { act, renderHook } from '@testing-library/react';
import { BalanceType, type LedgerRangeResponse } from 'types';
import { useLedgerReport } from '../useLedgerReport';

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

const baseRow: any = {
  id: 10,
  date: '2026-09-25',
  accountId: 1,
  particulars: 'Sale Invoice #10237',
  debit: 100395,
  credit: 0,
  balance: 100395,
  balanceType: BalanceType.Dr,
  linkedAccountName: null,
  journalSummary: {
    narration: 'Sale Invoice #10237',
    billNumber: 10237,
    discountPercentage: 20,
  },
};

const tierRow: any = {
  id: 11,
  date: '2026-09-25',
  accountId: 2,
  particulars: '[T] Sale Invoice #10237',
  debit: 32203,
  credit: 0,
  balance: 32203,
  balanceType: BalanceType.Dr,
  linkedAccountName: null,
  journalSummary: {
    narration: 'Sale Invoice #10237',
    billNumber: 10237,
    discountPercentage: 28,
  },
};

describe('useLedgerReport family mode', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (window as any).electron = {
      store: {
        get: jest.fn(() => ({})),
        set: jest.fn(),
      },
      getAccounts: jest.fn(async () => [
        { id: 1, name: 'Base', code: 'BASE' },
        { id: 2, name: 'Base-T', code: 'BASE-T' },
      ]),
      getItemTypes: jest.fn(async () => [{ name: 'T' }]),
      reportGetLedgerRange: jest.fn(
        async (): Promise<LedgerRangeResponse> => ({
          openingBalance: null,
          entries: [],
          closingBalance: null,
        }),
      ),
      getLedgerBalancesForAccountIdsAsOfDate: jest.fn(async () => ({})),
      getLedgerRangeForAccountIds: jest.fn(async () => ({
        1: [baseRow],
        2: [tierRow],
      })),
    } as any;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('groups split sale invoices in family mode and fills tier breakdown', async () => {
    const { result } = renderHook(() => useLedgerReport());

    await flushMicrotasks();

    act(() => {
      result.current.setFamilyMode(true);
    });
    await flushMicrotasks();

    act(() => {
      result.current.setSelectedAccount(1);
      result.current.handleDateChange(
        {
          from: new Date(2026, 8, 25),
          to: new Date(2026, 8, 25),
        },
        'custom',
      );
    });

    await flushMicrotasks();
    await flushMicrotasks();

    expect(result.current.ledgerEntries).toHaveLength(2);
    expect(result.current.ledgerEntries[1].particulars).toBe(
      'Sale Invoice #10237',
    );
    expect(result.current.ledgerEntries[1].tierBreakdown).toContain('20%');
    expect(result.current.ledgerEntries[1].tierBreakdown).toContain('T · 28%');
    expect(result.current.ledgerEntries[1].debit).toBe(132598);
  });

  it('keeps single-account rows without grouping when family mode is off', async () => {
    (window as any).electron.reportGetLedgerRange = jest.fn(
      async (): Promise<LedgerRangeResponse> => ({
        openingBalance: null,
        entries: [baseRow],
        closingBalance: null,
      }),
    );

    const { result } = renderHook(() => useLedgerReport());
    await flushMicrotasks();

    act(() => {
      result.current.setSelectedAccount(1);
      result.current.handleDateChange(
        {
          from: new Date(2026, 8, 25),
          to: new Date(2026, 8, 25),
        },
        'custom',
      );
    });

    await flushMicrotasks();

    expect(result.current.ledgerEntries).toHaveLength(1);
    expect(result.current.ledgerEntries[0].tierBreakdown).toBeUndefined();
  });
});
