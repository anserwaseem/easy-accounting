import { test, expect } from '@playwright/test';

/**
 * Exercises the journal:* / ledger:* surface (widened onto the worker in
 * this increment) end to end in a real browser: register a user, log in,
 * create two accounts, post a journal via `api.insertJournal`, and confirm
 * `api.getLedger` reflects it — the driver's transaction path
 * (SqliteWasmDriver.transaction, used by JournalService.insertJournal) had
 * no browser coverage before this spec, only Jest/Node coverage against
 * better-sqlite3.
 *
 * Real Login/Accounts/New Journal views now exist (see e2e/renderer.spec.ts,
 * which drives this exact flow through them) — this spec deliberately stays
 * on the direct `window.easyAccounting.api` path (exposed in src/main.tsx
 * for exactly this purpose) instead of duplicating that UI coverage, so the
 * driver's transaction path keeps a DOM-independent regression check.
 */
test('register, log in, post a journal, and see it on the ledger', async ({
  page,
}) => {
  await page.goto('/');

  // `ready` (see src/api/client.ts) resolves once the worker has booted the
  // database — the one signal this API-only spec needs before calling into
  // it, independent of which UI is mounted over it.
  await page.evaluate(() => window.easyAccounting.ready);

  const result = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { api } = (window as any).easyAccounting;

    const username = `e2e-journal-${Date.now()}`;
    const password = 'e2e-password';

    const registered = await api.register({ username, password });
    if (!registered) throw new Error('register() returned false');

    const loggedIn = await api.login({ username, password });
    if (!loggedIn) throw new Error('login() returned false');

    // register() seeds INITIAL_CHARTS for the new user (mirrors
    // AuthService.register() on desktop) — 'Current Asset' and 'Revenue' are
    // both in that seed set.
    const cashPayload = {
      name: `Cash ${Date.now()}`,
      headName: 'Current Asset',
      isActive: true,
    };
    const salesPayload = {
      name: `Sales ${Date.now()}`,
      headName: 'Revenue',
      isActive: true,
    };
    await api.insertAccount(cashPayload as never);
    await api.insertAccount(salesPayload as never);

    const cashAccount = await api.getAccountByName(cashPayload.name);
    const salesAccount = await api.getAccountByName(salesPayload.name);
    if (!cashAccount || !salesAccount) {
      throw new Error('accounts not found after insertAccount');
    }

    const amount = 1000;
    const journal = {
      id: 0,
      date: new Date().toISOString(),
      narration: 'E2E journal: cash sale',
      isPosted: true,
      journalEntries: [
        {
          id: 0,
          journalId: 0,
          accountId: cashAccount.id,
          debitAmount: amount,
          creditAmount: 0,
        },
        {
          id: 0,
          journalId: 0,
          accountId: salesAccount.id,
          debitAmount: 0,
          creditAmount: amount,
        },
      ],
    };

    const inserted = await api.insertJournal(journal as never);
    if (!inserted) throw new Error('insertJournal() returned false');

    const cashLedger = await api.getLedger(cashAccount.id);
    const salesLedger = await api.getLedger(salesAccount.id);

    return {
      amount,
      cashLedger,
      salesLedger,
    };
  });

  expect(result.cashLedger).toHaveLength(1);
  expect(result.cashLedger[0].debit).toBe(result.amount);
  expect(result.cashLedger[0].credit).toBe(0);
  expect(result.cashLedger[0].balance).toBe(result.amount);
  expect(result.cashLedger[0].balanceType).toBe('Dr');

  expect(result.salesLedger).toHaveLength(1);
  expect(result.salesLedger[0].credit).toBe(result.amount);
  expect(result.salesLedger[0].debit).toBe(0);
});
