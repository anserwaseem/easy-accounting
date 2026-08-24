import { act, renderHook } from '@testing-library/react';

import { useBillsAging } from '../useBillsAging';

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

const HEAD = "Shahbaz's Parties";

/** silent: owes money carried in from before the period, no entries inside it */
const SILENT_ACCOUNT = {
  id: 1033,
  name: 'HAMDAM STATIONARY MART',
  headName: HEAD,
};
/** active: same carried-in balance, plus one receipt inside the period */
const ACTIVE_ACCOUNT = { id: 1265, name: 'MAKTABA SAFDARIA', headName: HEAD };
/** settled: nothing carried in, nothing inside the period */
const SETTLED_ACCOUNT = { id: 7, name: 'CLEARED BOOK DEPOT', headName: HEAD };

const setupElectron = (
  overrides: Partial<Record<string, unknown>> = {},
): void => {
  (window as any).electron = {
    getCharts: jest.fn(async () => [{ id: 10, name: HEAD, parentId: 2 }]),
    getAccounts: jest.fn(async () => [
      SILENT_ACCOUNT,
      ACTIVE_ACCOUNT,
      SETTLED_ACCOUNT,
    ]),
    getLedgerBalancesForAccountIdsAsOfDate: jest.fn(async () => ({
      [SILENT_ACCOUNT.id]: { balance: 511547, balanceType: 'Dr' },
      [ACTIVE_ACCOUNT.id]: { balance: 184412, balanceType: 'Dr' },
    })),
    getLedgerRangeForAccountIds: jest.fn(async () => ({
      [ACTIVE_ACCOUNT.id]: [
        {
          id: 1,
          date: '2026-08-01T07:00:00.000Z',
          particulars: 'Journal #2700',
          debit: 0,
          credit: 900,
        },
      ],
    })),
    getJournalNarrationSummariesByIds: jest.fn(async () => ({})),
    ...overrides,
  } as any;
};

const renderReport = async () => {
  const { result } = renderHook(() => useBillsAging());

  // charts fetch -> head selection -> bills aging fetch
  await flushMicrotasks();
  await flushMicrotasks();
  await flushMicrotasks();

  return result;
};

describe('useBillsAging carry-forward accounts', () => {
  beforeEach(() => setupElectron());

  it('keeps an account that owes money but had no activity in the period', async () => {
    const result = await renderReport();

    const silent = result.current.billsAging.accounts.find(
      (account) => account.accountId === SILENT_ACCOUNT.id,
    );

    expect(silent).toBeDefined();
    expect(silent?.bills).toHaveLength(1);
    expect(silent?.bills[0]).toMatchObject({
      billNumber: 'Opening Balance',
      billAmount: 511547,
      finalBalance: 511547,
    });
    expect(silent?.totalOutstanding).toBe(511547);
  });

  it('still allocates receipts against the carried-in balance', async () => {
    const result = await renderReport();

    const active = result.current.billsAging.accounts.find(
      (account) => account.accountId === ACTIVE_ACCOUNT.id,
    );

    expect(active?.bills[0]).toMatchObject({
      billNumber: 'Opening Balance',
      billAmount: 184412,
      finalBalance: 183512,
    });
    expect(active?.totalReceived).toBe(900);
  });

  it('leaves out accounts with neither a balance due nor activity', async () => {
    const result = await renderReport();

    expect(
      result.current.billsAging.accounts.map((account) => account.accountId),
    ).not.toContain(SETTLED_ACCOUNT.id);
  });

  it('reports nothing to show only when no account qualifies', async () => {
    setupElectron({
      getLedgerBalancesForAccountIdsAsOfDate: jest.fn(async () => ({})),
      getLedgerRangeForAccountIds: jest.fn(async () => ({})),
    });

    const result = await renderReport();

    expect(result.current.billsAging.accounts).toHaveLength(0);
    expect(result.current.infoMessage).toContain('No entries found');
  });
});
