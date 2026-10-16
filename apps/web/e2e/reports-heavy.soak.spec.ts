import { test, expect } from 'playwright-soak-test';
import type { Page } from '@playwright/test';

const PASSWORD = 'e2e-soak-password';

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

interface SeededReportsData {
  agentHeadId: number;
  agentHeadName: string;
  account1Id: number;
  account2Id: number;
  account3Id: number;
  receiptAccountId: number;
  tour1Id: number;
  tour2Id: number;
  billCount: number;
}

async function seedReportsData(
  page: Page,
  username?: string,
): Promise<SeededReportsData> {
  return page.evaluate(async (u) => {
    return (await window.easyAccounting.debug('debug:seedReportsFixtures', {
      billCount: 120,
      username: u,
    })) as SeededReportsData;
  }, username);
}

test.describe('Heavy Reports Engine Soak Tests', () => {
  test('Bills Aging FIFO allocation, partial settling, and unallocated receipts soak', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const username = `aging_${Date.now()}`;
    await registerAndLogin(page, username);

    const fixture = await seedReportsData(page, username);
    expect(fixture.billCount).toBe(120);

    // 1. Navigate to Reports -> Bills Aging
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('link', { name: /Bills Aging/i }).click();
    await expect(
      page.getByRole('heading', { name: 'Bills Aging' }),
    ).toBeVisible({ timeout: 10_000 });

    // 2. Select Agent Head from the head selector dropdown
    const headSelectTrigger = page
      .locator('button')
      .filter({ hasText: 'All parties' });
    await expect(headSelectTrigger).toBeVisible();
    await headSelectTrigger.click();

    const option = page.getByRole('option', { name: fixture.agentHeadName });
    await expect(option).toBeVisible();
    await option.click();

    // 3. Verify accounts under Soak Agent Head are rendered
    // Badge shows "11 accounts" (which triggered Virtuoso virtualization)
    await expect(page.getByText('11 accounts')).toBeVisible({
      timeout: 15_000,
    });

    // Alpha Book Shop card
    const alphaHeading = page.getByRole('heading', {
      name: /Alpha Book Shop/i,
    });
    await expect(alphaHeading).toBeVisible();

    // 4. Verify FIFO allocation and statuses in Alpha Book Shop
    // Earliest bills (e.g. BILL-1001) were fully paid by Tour 1 receipt -> "Cleared in"
    await expect(page.getByText(/Cleared in/i).first()).toBeVisible();

    // Later unpaid bills (e.g. BILL-1120) -> "Overdue by"
    await expect(page.getByText(/Overdue by/i).first()).toBeVisible();

    // 5. Test Filters Popover: "Hide settled bills" toggle on and off
    const filtersBtn = page.getByRole('button', { name: /Filters/i });
    await filtersBtn.click();

    const hideZeroCheckbox = page.locator('#toggle-hide-zero');
    await expect(hideZeroCheckbox).toBeVisible();
    await hideZeroCheckbox.click(); // Hide settled bills

    // With settled bills hidden, "Cleared in" is hidden and active ones remain
    await expect(page.getByText(/Overdue by/i).first()).toBeVisible();
    await expect(page.getByText(/Cleared in/i)).toHaveCount(0);

    // Toggle settled bills back on
    await hideZeroCheckbox.click();
    await expect(page.getByText(/Cleared in/i).first()).toBeVisible();

    // Close filters popover
    await page.keyboard.press('Escape');

    // 6. Test Customer Filter Toolbar (VirtualMultiSelect)
    // Filter to Beta Stationery
    const customerFilter = page
      .getByRole('combobox')
      .filter({ hasText: 'All customers' });
    await expect(customerFilter).toBeVisible();
    await customerFilter.click();

    // In VirtualMultiSelect, items have role="button" with the customer name
    const betaOption = page
      .locator('[role="button"]')
      .filter({ hasText: /Beta Stationery/i })
      .first();
    await expect(betaOption).toBeVisible();
    await betaOption.click();

    // Close select
    await page.keyboard.press('Escape');

    // Beta Stationery card is now visible
    const betaHeading = page.getByRole('heading', { name: /Beta Stationery/i });
    await expect(betaHeading).toBeVisible({ timeout: 10_000 });

    // Filter to Gamma Traders
    const betaFilter = page
      .getByRole('combobox')
      .filter({ hasText: /Beta Stationery/i });
    await betaFilter.click();

    // Uncheck Beta
    await betaOption.click();

    // Check Gamma Traders
    const gammaOption = page
      .locator('[role="button"]')
      .filter({ hasText: /Gamma Traders/i })
      .first();
    await expect(gammaOption).toBeVisible();
    await gammaOption.click();

    // Close select
    await page.keyboard.press('Escape');

    // Gamma Traders card & Opening Balance (carry-forward bill)
    const gammaHeading = page.getByRole('heading', { name: /Gamma Traders/i });
    await expect(gammaHeading).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Opening Balance').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('GAMMA-502').first()).toBeVisible();

    // Filter to Echo Library
    const gammaFilter = page
      .getByRole('combobox')
      .filter({ hasText: /Gamma Traders/i });
    await gammaFilter.click();
    await gammaOption.click();

    const echoOption = page
      .locator('[role="button"]')
      .filter({ hasText: /Echo Library/i })
      .first();
    await expect(echoOption).toBeVisible();
    await echoOption.click();
    await page.keyboard.press('Escape');

    await expect(
      page.getByRole('heading', { name: /Echo Library/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Unallocated Receipts').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('3,000').first()).toBeVisible();

    // Clear filter via clear button
    const clearBtn = page.locator('span[aria-label="Clear selection"]');
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
    }

    // 7. Verify Total Outstanding KPI in header
    const totalKpi = page
      .locator('.print-header')
      .getByText('Total Outstanding:');
    await expect(totalKpi).toBeVisible();
  });

  test('Collection Sheet dated Agent Tours, untoured reconciliation, sorting, and Urdu mode', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const username = `tour_${Date.now()}`;
    await registerAndLogin(page, username);

    const fixture = await seedReportsData(page, username);

    // 1. Navigate to Reports -> Collection sheet
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('link', { name: /Collection sheet/i }).click();
    await expect(
      page.getByRole('heading', { name: /Collection sheet/i }),
    ).toBeVisible({ timeout: 10_000 });

    // 2. Select Agent Head
    const agentTrigger = page
      .locator('button')
      .filter({ hasText: 'Select an agent' });
    await expect(agentTrigger).toBeVisible();
    await agentTrigger.click();

    const agentOption = page.getByRole('option', {
      name: fixture.agentHeadName,
    });
    await expect(agentOption).toBeVisible();
    await agentOption.click();

    // 3. Set Date Range preset to "All" to cover 2025 transactions
    const dateBtn = page.locator('button#date');
    await dateBtn.click();

    // The DateRangePickerWithPresets popover has a Select with presets
    const presetSelect = page.locator('[role="dialog"]').getByRole('combobox');
    await presetSelect.click();
    await page.getByRole('option', { name: 'All' }).click();

    // Close calendar popover
    await page.keyboard.press('Escape');

    // 4. Verify Collection Sheet Table renders with tours and untoured columns
    // Check tour headers
    await expect(page.getByText('Feb Tour 1')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Mar Tour 2')).toBeVisible();
    await expect(page.getByText('Not in a tour')).toBeVisible();

    // Check Alpha Book Shop row
    const alphaRow = page
      .locator('tr')
      .filter({ hasText: 'Alpha Book Shop' })
      .first();
    await expect(alphaRow).toBeVisible();

    // Collected amount for Alpha Book Shop = 70,500
    // (Feb Tour 1: 40,000 + Mar Tour 2: 20,500 + Not in a tour: 10,000 = 70,500)
    await expect(alphaRow.getByText('70,500')).toBeVisible();
    await expect(alphaRow.getByText('40,000')).toBeVisible();
    await expect(alphaRow.getByText('20,500')).toBeVisible();
    await expect(alphaRow.getByText('10,000')).toBeVisible();

    // Check Beta Stationery (15,000 collected in Feb Tour 1)
    const betaRow = page
      .locator('tr')
      .filter({ hasText: 'Beta Stationery' })
      .first();
    await expect(betaRow).toBeVisible();
    await expect(betaRow.getByText('15,000').first()).toBeVisible();

    // Check Gamma Traders (8,000 collected in Mar Tour 2)
    const gammaRow = page
      .locator('tr')
      .filter({ hasText: 'Gamma Traders' })
      .first();
    await expect(gammaRow).toBeVisible();
    await expect(gammaRow.getByText('8,000').first()).toBeVisible();

    // 5. Test Sort By
    const sortTrigger = page.locator('button').filter({ hasText: 'Code' });
    await expect(sortTrigger).toBeVisible();
    await sortTrigger.click();

    const outstandingSort = page.getByRole('option', {
      name: 'Highest Outstanding',
    });
    await expect(outstandingSort).toBeVisible();
    await outstandingSort.click();

    // Verify sort updated
    await expect(
      page.locator('button').filter({ hasText: 'Highest Outstanding' }),
    ).toBeVisible();

    // 6. Test Urdu Language Toggle
    const urduBtn = page.getByRole('button', { name: 'اردو' });
    await expect(urduBtn).toBeVisible();
    await urduBtn.click();

    // In Urdu mode, column headers switch to Urdu
    await expect(page.getByText('نام دوکان دار')).toBeVisible();
    await expect(page.getByText('پتہ').first()).toBeVisible();
    await expect(page.getByText('کل وصولی').first()).toBeVisible();
    await expect(page.getByText('واجب الادا').first()).toBeVisible();

    // Switch back to English
    const engBtn = page.getByRole('button', { name: 'Eng' });
    await engBtn.click();
    await expect(page.getByText('Shop').first()).toBeVisible();
  });
});
