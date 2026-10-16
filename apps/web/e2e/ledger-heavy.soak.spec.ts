import { test, expect } from 'playwright-soak-test';
import type { Page } from '@playwright/test';

const PASSWORD = 'e2e-soak-password';
const HEAVY_COUNT = 2000;
const LIGHT_COUNT = 50;

async function registerAndLogin(page: Page, username: string) {
  await page.goto('/');
  await page.evaluate(
    async ({ username: u, password }) => {
      const ok = await window.easyAccounting.api.register({
        username: u,
        password,
      });
      if (!ok) throw new Error('setup register() returned false');
    },
    { username, password: PASSWORD },
  );
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
  await page.locator('input[placeholder="Username"]').fill(username);
  await page.locator('input[placeholder="Password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 15_000 });
}

interface SeededLedgerData {
  heavyId: number;
  lightId: number;
  cashId: number;
  heavyExpectedTotal: number;
}

async function seedHeavyLedgerData(page: Page): Promise<SeededLedgerData> {
  return page.evaluate(
    async ({ heavyCount, lightCount }) => {
      // 1. Create accounts
      await window.easyAccounting.api.insertAccount({
        name: 'Cash',
        headName: 'Current Asset',
      });
      await window.easyAccounting.api.insertAccount({
        name: 'Heavy Client 2000',
        code: 'HC2000',
        headName: 'Current Asset',
        type: 'Asset',
      });
      await window.easyAccounting.api.insertAccount({
        name: 'Fast Rail Partner',
        code: 'FRP',
        headName: 'Current Asset',
        type: 'Asset',
      });

      const accounts =
        (await window.easyAccounting.api.getAccounts()) as Array<{
          id: number;
          name: string;
        }>;
      const cash = accounts.find((a) => a.name === 'Cash');
      const heavy = accounts.find((a) => a.name === 'Heavy Client 2000');
      const light = accounts.find((a) => a.name === 'Fast Rail Partner');

      if (!cash || !heavy || !light) {
        throw new Error('Failed to create accounts for heavy ledger test');
      }

      // 2. Seed 2,000 bulk journals for Heavy Client
      await window.easyAccounting.debug('debug:seedBulkJournals', {
        debitAccountId: heavy.id,
        creditAccountId: cash.id,
        count: heavyCount,
        startDateIso: '2026-01-01T08:00:00.000Z',
        baseAmount: 100,
      });

      // 3. Seed 50 bulk journals for Fast Rail Partner
      await window.easyAccounting.debug('debug:seedBulkJournals', {
        debitAccountId: light.id,
        creditAccountId: cash.id,
        count: lightCount,
        startDateIso: '2026-02-01T08:00:00.000Z',
        baseAmount: 50,
      });

      // Calculate expected heavy total:
      // For i in 0..1999: amount = 100 + (i % 25) * 10
      // 25 items sum to: 25*100 + 10*(24*25/2) = 2500 + 3000 = 5500
      // (2000 / 25) = 80 full cycles -> 80 * 5500 = 440,000
      let heavyExpectedTotal = 0;
      for (let i = 0; i < heavyCount; i++) {
        heavyExpectedTotal += 100 + (i % 25) * 10;
      }

      return {
        heavyId: heavy.id,
        lightId: light.id,
        cashId: cash.id,
        heavyExpectedTotal,
      };
    },
    { heavyCount: HEAVY_COUNT, lightCount: LIGHT_COUNT },
  );
}

test.describe('Massive Ledger Running Balance Proration & Mini-Rail Soak Tests', () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    soakOptions: {
      clock: false,
    },
  });

  test('Massive Ledger: 2,000+ entries running balance proration and deep scroll virtualization', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const username = `heavy-ldg-${Date.now()}`;
    await registerAndLogin(page, username);

    const { heavyExpectedTotal } = await seedHeavyLedgerData(page);

    // Navigate to Accounts page via sidebar
    await page.getByRole('link', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible({
      timeout: 15_000,
    });

    // Click on Heavy Client 2000 in Accounts list to open Ledger
    const heavyAccountRow = page.getByText('Heavy Client 2000').first();
    await expect(heavyAccountRow).toBeVisible({ timeout: 10_000 });
    await heavyAccountRow.click();

    const ledgerArea = page.locator('.w-full.md\\:w-3\\/4');

    // Verify Title "Ledger"
    await expect(
      ledgerArea.getByRole('heading', { name: 'Ledger', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Verify Account Header & Code Badge
    await expect(
      ledgerArea.getByRole('heading', { level: 1, name: 'Heavy Client 2000' }),
    ).toBeVisible();
    await expect(ledgerArea.getByText('HC2000')).toBeVisible();

    // Verify Cumulative Balance in Header: PKR 440,000 Dr
    await expect(
      ledgerArea.getByRole('heading', { name: /440,000.*Dr/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Verify TableVirtuoso is virtualizing the 2,000 rows in the ledger area
    const rows = ledgerArea.locator('tbody tr[data-index]');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    const initialDomRowCount = await rows.count();
    expect(initialDomRowCount).toBeLessThan(50);
    expect(initialDomRowCount).toBeGreaterThanOrEqual(10);

    // Verify first row particulars and running balance
    const firstRow = ledgerArea.locator('tbody tr[data-index="0"]');
    await expect(firstRow).toBeVisible();
    await expect(
      firstRow.getByText('Bulk Transaction #1', { exact: true }),
    ).toBeVisible();

    // Find the virtual scroller container for the ledger table
    const scroller = ledgerArea.locator('[data-virtuoso-scroller="true"]');
    await expect(scroller).toBeVisible();

    // Scroll down to the bottom of the 2,000-item ledger
    await scroller.evaluate(async (el) => {
      for (let i = 0; i < 4; i++) {
        el.scrollTop = el.scrollHeight;
        await new Promise((r) => setTimeout(r, 150));
      }
    });
    await page.waitForTimeout(400);

    // Verify deep virtualized rows (rows 1990+) are mounted
    await expect(
      ledgerArea.getByText(/Bulk Transaction #(199[0-9]|2000)/).first(),
    ).toBeVisible();

    // Verify top row (row 0) has been unmounted from the DOM
    await expect(
      ledgerArea.getByText('Bulk Transaction #1', { exact: true }),
    ).not.toBeVisible();

    // Scroll back to the top
    await scroller.evaluate(async (el) => {
      for (let i = 0; i < 4; i++) {
        el.scrollTop = 0;
        await new Promise((r) => setTimeout(r, 150));
      }
    });
    await page.waitForTimeout(400);

    // Verify top row is mounted back
    await expect(
      ledgerArea.getByText('Bulk Transaction #1', { exact: true }),
    ).toBeVisible();
  });

  test('Mini-Rail Account Switching Soak: Rapidly toggle between 2,000-entry ledger and 50-entry ledger', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const username = `mini-rail-${Date.now()}`;
    await registerAndLogin(page, username);

    const { heavyExpectedTotal } = await seedHeavyLedgerData(page);

    // Navigate to Accounts page via sidebar
    await page.getByRole('link', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible({
      timeout: 15_000,
    });

    // Open Heavy Client 2000 ledger
    const heavyAccountRow = page.getByText('Heavy Client 2000').first();
    await expect(heavyAccountRow).toBeVisible({ timeout: 10_000 });
    await heavyAccountRow.click();

    const ledgerArea = page.locator('.w-full.md\\:w-3\\/4');
    await expect(
      ledgerArea.getByRole('heading', { name: 'Ledger', exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      ledgerArea.getByRole('heading', { level: 1, name: 'Heavy Client 2000' }),
    ).toBeVisible();

    const expectedHeavyStr = heavyExpectedTotal.toLocaleString('en-US');
    await expect(ledgerArea.getByText(expectedHeavyStr)).toBeVisible();

    // Locate the mini-rail account list items on desktop
    const miniRail = page.locator('.hidden.md\\:block');
    await expect(miniRail).toBeVisible();

    const heavyItem = miniRail.getByText('Heavy Client 2000').first();
    const lightItem = miniRail.getByText('Fast Rail Partner').first();
    await expect(heavyItem).toBeVisible();
    await expect(lightItem).toBeVisible();

    // Rapid soak switching loop (10 cycles back and forth)
    const SWITCH_CYCLES = 10;
    for (let cycle = 1; cycle <= SWITCH_CYCLES; cycle++) {
      // 1. Switch to Fast Rail Partner
      await lightItem.click();
      await expect(
        ledgerArea.getByRole('heading', {
          level: 1,
          name: 'Fast Rail Partner',
        }),
      ).toBeVisible({ timeout: 5000 });

      // 2. Switch back to Heavy Client 2000
      await heavyItem.click();
      await expect(
        ledgerArea.getByRole('heading', {
          level: 1,
          name: 'Heavy Client 2000',
        }),
      ).toBeVisible({ timeout: 5000 });
    }

    // Verify stability after 10 rapid account switches:
    // Balance is still accurate
    await expect(
      ledgerArea.getByRole('heading', { name: /440,000.*Dr/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Wait for row 0 to be mounted
    await expect(
      ledgerArea
        .locator('tbody tr[data-index="0"]')
        .getByText('Bulk Transaction #1'),
    ).toBeVisible({ timeout: 10_000 });

    // Virtualization is still active
    const rows = ledgerArea.locator('tbody tr[data-index]');
    await expect(rows.first()).toBeVisible();
    const domRowCount = await rows.count();
    expect(domRowCount).toBeLessThan(50);

    // Scroller is healthy and scrolls to bottom without error
    const scroller = ledgerArea.locator('[data-virtuoso-scroller="true"]');
    await scroller.evaluate(async (el) => {
      for (let i = 0; i < 4; i++) {
        el.scrollTop = el.scrollHeight;
        await new Promise((r) => setTimeout(r, 150));
      }
    });
    await page.waitForTimeout(400);
    await expect(
      ledgerArea.getByText(/Bulk Transaction #(199[0-9]|2000)/).first(),
    ).toBeVisible();
  });
});
