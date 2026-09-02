import { act, renderHook } from '@testing-library/react';

import {
  useBillsAging,
  ALL_PARTIES_HEAD,
  ALL_PARTIES_EMPTY_SELECTION_MESSAGE,
} from '../useBillsAging';

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

const HEAD = "Shahbaz's Parties";
const OTHER_HEAD = "Ilyas's Parties";

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
/** same shop name under two different agent heads (the disambiguation case) */
const DUP_ACCOUNT_A = {
  id: 2001,
  name: 'KITAB GHAR',
  code: 'RWP-KITAB',
  headName: HEAD,
};
const DUP_ACCOUNT_B = {
  id: 2002,
  name: 'KITAB GHAR',
  code: 'LHR-KITAB',
  headName: OTHER_HEAD,
};

const setupElectron = (
  overrides: Partial<Record<string, unknown>> = {},
): void => {
  (window as any).electron = {
    getCharts: jest.fn(async () => [
      { id: 10, name: HEAD, parentId: 2 },
      { id: 11, name: OTHER_HEAD, parentId: 2 },
      // a top-level chart (no parentId) must never join the agent-head scope
      { id: 1, name: 'Current Asset' },
    ]),
    getAccounts: jest.fn(async () => [
      SILENT_ACCOUNT,
      ACTIVE_ACCOUNT,
      SETTLED_ACCOUNT,
      DUP_ACCOUNT_A,
      DUP_ACCOUNT_B,
    ]),
    getLedgerBalancesForAccountIdsAsOfDate: jest.fn(async () => ({
      [SILENT_ACCOUNT.id]: { balance: 511547, balanceType: 'Dr' },
      [ACTIVE_ACCOUNT.id]: { balance: 184412, balanceType: 'Dr' },
      [DUP_ACCOUNT_A.id]: { balance: 45000, balanceType: 'Dr' },
      [DUP_ACCOUNT_B.id]: { balance: 12000, balanceType: 'Dr' },
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

/** mount the hook and switch it to the single-head scope used by the legacy cases */
const renderReport = async () => {
  const { result } = renderHook(() => useBillsAging());

  // charts + accounts fetch settle first, then the head switch recomputes
  await flushMicrotasks();
  await act(async () => {
    result.current.handleHeadChange(HEAD);
  });
  await flushMicrotasks();
  await flushMicrotasks();

  return result;
};

/** mount the hook and leave it on the default all-parties scope */
const renderAllParties = async () => {
  const { result } = renderHook(() => useBillsAging());

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

describe('useBillsAging daysStatus', () => {
  beforeEach(() => setupElectron());

  it('computes calendar-accurate months/days for a still-pending bill', async () => {
    const result = await renderReport();

    // report period defaults to starting 2025-01-01; move the "as of" date
    // to a fixed, known point so the elapsed duration is deterministic
    await act(async () => {
      result.current.handleDateChange(new Date('2026-03-15T00:00:00.000Z'));
    });
    await flushMicrotasks();
    await flushMicrotasks();

    const silent = result.current.billsAging.accounts.find(
      (account) => account.accountId === SILENT_ACCOUNT.id,
    );

    // 2025-01-01 -> 2026-03-15 is 14 whole months (to 2026-03-01) plus 14 days
    expect(silent?.bills[0].daysStatus).toMatchObject({
      isFullyPaid: false,
      months: 14,
      remainingDays: 14,
    });
  });
});

describe('useBillsAging all-parties scope', () => {
  beforeEach(() => setupElectron());

  it('defaults to All parties and computes nothing until customers are selected', async () => {
    const result = await renderAllParties();

    expect(result.current.selectedHead).toBe(ALL_PARTIES_HEAD);
    expect(result.current.isAllParties).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.billsAging.accounts).toHaveLength(0);
    expect(result.current.infoMessage).toBe(
      ALL_PARTIES_EMPTY_SELECTION_MESSAGE,
    );

    // the empty-state guard must not fetch a single ledger
    const { electron } = window as any;
    expect(
      electron.getLedgerBalancesForAccountIdsAsOfDate,
    ).not.toHaveBeenCalled();
    expect(electron.getLedgerRangeForAccountIds).not.toHaveBeenCalled();
  });

  it('offers every account under any agent head, tagged with its head name', async () => {
    const result = await renderAllParties();

    const options = result.current.allPartiesOptions;
    expect(options.map((option) => option.id).sort()).toEqual(
      [
        SETTLED_ACCOUNT.id,
        SILENT_ACCOUNT.id,
        ACTIVE_ACCOUNT.id,
        DUP_ACCOUNT_A.id,
        DUP_ACCOUNT_B.id,
      ].sort(),
    );

    // same shop name resolves to two distinct options via code + head
    const dups = options.filter((option) => option.name === 'KITAB GHAR');
    expect(dups).toHaveLength(2);
    expect(dups.map((option) => option.headName).sort()).toEqual(
      [HEAD, OTHER_HEAD].sort(),
    );
    expect(dups.map((option) => option.code).sort()).toEqual([
      'LHR-KITAB',
      'RWP-KITAB',
    ]);
  });

  it('computes a combined report for customers selected across two heads', async () => {
    const result = await renderAllParties();

    await act(async () => {
      result.current.handleCustomerFilterChange([
        DUP_ACCOUNT_A.id,
        DUP_ACCOUNT_B.id,
      ]);
    });
    await flushMicrotasks();
    await flushMicrotasks();

    const { accounts } = result.current.billsAging;
    expect(accounts.map((account) => account.accountId).sort()).toEqual([
      DUP_ACCOUNT_A.id,
      DUP_ACCOUNT_B.id,
    ]);

    // each account carries its agent head for the per-head tags/subtotals
    const accountA = accounts.find((a) => a.accountId === DUP_ACCOUNT_A.id);
    const accountB = accounts.find((a) => a.accountId === DUP_ACCOUNT_B.id);
    expect(accountA?.headName).toBe(HEAD);
    expect(accountB?.headName).toBe(OTHER_HEAD);
    expect(accountA?.totalOutstanding).toBe(45000);
    expect(accountB?.totalOutstanding).toBe(12000);

    // combined position = sum across both heads
    const combined = accounts.reduce(
      (sum, account) => sum + account.totalOutstanding,
      0,
    );
    expect(combined).toBe(57000);

    // ledgers were fetched for the selected accounts only, never the full pool
    const { electron } = window as any;
    expect(
      electron.getLedgerBalancesForAccountIdsAsOfDate,
    ).toHaveBeenLastCalledWith(
      [DUP_ACCOUNT_A.id, DUP_ACCOUNT_B.id],
      expect.any(String),
    );
  });

  it('changing the head resets the customer selection', async () => {
    const result = await renderAllParties();

    await act(async () => {
      result.current.handleCustomerFilterChange([DUP_ACCOUNT_A.id]);
    });
    await flushMicrotasks();

    await act(async () => {
      result.current.handleHeadChange(HEAD);
    });
    await flushMicrotasks();

    expect(result.current.selectedCustomerIds).toEqual([]);
    expect(result.current.isAllParties).toBe(false);
  });
});

describe('useBillsAging single-head scope (unchanged behavior)', () => {
  beforeEach(() => setupElectron());

  it('computes the whole head and filters customers client-side without refetching', async () => {
    const result = await renderReport();

    const { electron } = window as any;
    // the whole head was fetched: every account under it, selection or not
    expect(
      electron.getLedgerBalancesForAccountIdsAsOfDate,
    ).toHaveBeenLastCalledWith(
      [
        SILENT_ACCOUNT.id,
        ACTIVE_ACCOUNT.id,
        SETTLED_ACCOUNT.id,
        DUP_ACCOUNT_A.id,
      ],
      expect.any(String),
    );
    const rangeCallsAfterLoad =
      electron.getLedgerRangeForAccountIds.mock.calls.length;
    const accountsBefore = result.current.billsAging.accounts;

    await act(async () => {
      result.current.handleCustomerFilterChange([SILENT_ACCOUNT.id]);
    });
    await flushMicrotasks();
    await flushMicrotasks();

    // narrowing the customer filter neither refetches nor recomputes the report
    expect(electron.getLedgerRangeForAccountIds.mock.calls.length).toBe(
      rangeCallsAfterLoad,
    );
    expect(result.current.billsAging.accounts).toBe(accountsBefore);
    expect(result.current.selectedCustomerIds).toEqual([SILENT_ACCOUNT.id]);
  });
});
