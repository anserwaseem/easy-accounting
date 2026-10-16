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

interface SeededStockReplayData {
  item1Id: number;
  item1Name: string;
  item2Id: number;
  item2Name: string;
  itemTypeName: string;
}

async function seedStockReplayData(page: Page): Promise<SeededStockReplayData> {
  return page.evaluate(async () => {
    return (await window.easyAccounting.debug(
      'debug:seedStockAsOfFixtures',
    )) as SeededStockReplayData;
  });
}

async function setAsOfDateAndNavigate(
  page: Page,
  year: number,
  month0: number,
  day: number,
) {
  const date = new Date(year, month0, day, 12, 0, 0);
  await page.evaluate((iso) => {
    window.electron.store.set('reports.stockAsOf.filters', {
      dateRange: { from: iso, to: iso },
    });
  }, date.toISOString());

  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('link', { name: /Stock as of date/i }).click();
  await expect(
    page.getByRole('heading', { name: 'Stock as of date' }),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe('Historical Stock As Of Chronological Movement Replay Soak Tests', () => {
  test('Accurate historical balance replay across sales, purchases, adjustments, and returns under 6x CPU slowdown', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const username = `stock_as_of_${Date.now()}`;
    await registerAndLogin(page, username);

    const fixture = await seedStockReplayData(page);
    expect(fixture.item1Name).toBe('Chronology Novel Vol 1');
    expect(fixture.item2Name).toBe('Chronology Novel Vol 2');

    // 1. Enable 6x CPU throttling via Chrome DevTools Protocol
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });

    // 2. Navigate to Reports -> Stock as of date
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('link', { name: /Stock as of date/i }).click();
    await expect(
      page.getByRole('heading', { name: 'Stock as of date' }),
    ).toBeVisible({ timeout: 10_000 });

    // 3. Verify Checkpoint 0: Current Live On-Hand (Today)
    // Item 1: Live current = 70, as-of = 70, diff = 0
    // Item 2: Live current = 220, as-of = 220, diff = 0
    const row1Today = page
      .locator('tr')
      .filter({ hasText: 'Chronology Novel Vol 1' })
      .first();
    await expect(row1Today).toBeVisible({ timeout: 10_000 });
    await expect(row1Today.getByText('70').first()).toBeVisible();

    const row2Today = page
      .locator('tr')
      .filter({ hasText: 'Chronology Novel Vol 2' })
      .first();
    await expect(row2Today).toBeVisible();
    await expect(row2Today.getByText('220').first()).toBeVisible();

    // 4. Scrub Checkpoint 1: As of 2025-03-15
    // Future movements relative to 2025-03-15:
    // Item 1: Movement 5 (Apr 01: -40 sale) => asOf = 70 - (-40) = 110, diff = -40
    // Item 2: Movement 2 (Mar 20: -80 sale) => asOf = 220 - (-80) = 300, diff = -80
    await setAsOfDateAndNavigate(page, 2025, 2, 15); // Month 2 = March

    const row1Cp1 = page
      .locator('tr')
      .filter({ hasText: 'Chronology Novel Vol 1' })
      .first();
    await expect(row1Cp1).toBeVisible({ timeout: 10_000 });
    await expect(row1Cp1.getByText('70').first()).toBeVisible(); // Current live
    await expect(row1Cp1.getByText('110').first()).toBeVisible(); // Qty as of
    await expect(row1Cp1.getByText('-40').first()).toBeVisible(); // Diff

    const row2Cp1 = page
      .locator('tr')
      .filter({ hasText: 'Chronology Novel Vol 2' })
      .first();
    await expect(row2Cp1).toBeVisible();
    await expect(row2Cp1.getByText('220').first()).toBeVisible(); // Current live
    await expect(row2Cp1.getByText('300').first()).toBeVisible(); // Qty as of
    await expect(row2Cp1.getByText('-80').first()).toBeVisible(); // Diff

    // 5. Scrub Checkpoint 2: As of 2025-03-05 (Returned invoice was pending return)
    // On-hand for Item 1 was 90:
    // Future movements: Mov 4 return (+20 at Mar 10) and Mov 5 sale (-40 at Apr 01)
    // deltaAfter = +20 - 40 = -20 => asOf = 70 - (-20) = 90, diff = -20
    await setAsOfDateAndNavigate(page, 2025, 2, 5); // Month 2 = March

    const row1Cp2 = page
      .locator('tr')
      .filter({ hasText: 'Chronology Novel Vol 1' })
      .first();
    await expect(row1Cp2).toBeVisible({ timeout: 10_000 });
    await expect(row1Cp2.getByText('90').first()).toBeVisible(); // Qty as of
    await expect(row1Cp2.getByText('-20').first()).toBeVisible(); // Diff

    // 6. Scrub Checkpoint 3: As of 2025-02-10 (Before stock adjustment and return)
    // On-hand for Item 1 was 120:
    // Future movements: Mov 3 adj (-10), Mov 4 net (0), Mov 5 sale (-40)
    // deltaAfter = -50 => asOf = 70 - (-50) = 120, diff = -50
    await setAsOfDateAndNavigate(page, 2025, 1, 10); // Month 1 = February

    const row1Cp3 = page
      .locator('tr')
      .filter({ hasText: 'Chronology Novel Vol 1' })
      .first();
    await expect(row1Cp3).toBeVisible({ timeout: 10_000 });
    await expect(row1Cp3.getByText('120').first()).toBeVisible(); // Qty as of
    await expect(row1Cp3.getByText('-50').first()).toBeVisible(); // Diff

    // 7. Scrub Checkpoint 4: As of 2025-01-10 (Initial baseline before any movements)
    // Item 1 baseline was 100:
    // Future movements: +50 purch, -30 sale, -10 adj, -40 sale => deltaAfter = -30
    // asOf = 70 - (-30) = 100, diff = -30
    // Item 2 baseline was 200:
    // Future movements: +100 purch, -80 sale => deltaAfter = +20
    // asOf = 220 - 20 = 200, diff = +20
    await setAsOfDateAndNavigate(page, 2025, 0, 10); // Month 0 = January

    const row1Cp4 = page
      .locator('tr')
      .filter({ hasText: 'Chronology Novel Vol 1' })
      .first();
    await expect(row1Cp4).toBeVisible({ timeout: 10_000 });
    await expect(row1Cp4.getByText('100').first()).toBeVisible(); // Baseline Qty as of
    await expect(row1Cp4.getByText('-30').first()).toBeVisible(); // Diff

    const row2Cp4 = page
      .locator('tr')
      .filter({ hasText: 'Chronology Novel Vol 2' })
      .first();
    await expect(row2Cp4).toBeVisible();
    await expect(row2Cp4.getByText('200').first()).toBeVisible(); // Baseline Qty as of
    await expect(row2Cp4.getByText('20').first()).toBeVisible(); // Diff

    // 8. Test DataTable Search Filtering under 6x CPU slowdown
    const searchInput = page.getByPlaceholder(/Search list #, items, types/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Vol 1');

    // Debounce wait & assert Vol 1 is visible, Vol 2 is filtered out
    await expect(
      page.locator('tr').filter({ hasText: 'Chronology Novel Vol 1' }),
    ).toBeVisible();
    await expect(
      page.locator('tr').filter({ hasText: 'Chronology Novel Vol 2' }),
    ).toHaveCount(0);

    // Clear search
    await searchInput.clear();
    await expect(
      page.locator('tr').filter({ hasText: 'Chronology Novel Vol 2' }),
    ).toBeVisible();

    // 9. Test Item Type Dropdown Filter
    const typeSelect = page.locator('button').filter({ hasText: 'All types' });
    await expect(typeSelect).toBeVisible();
    await typeSelect.click();

    const urduOption = page.getByRole('option', { name: 'Urdu' });
    await expect(urduOption).toBeVisible();
    await urduOption.click();

    // Both items are type Urdu so both remain visible
    await expect(
      page.locator('tr').filter({ hasText: 'Chronology Novel Vol 1' }),
    ).toBeVisible();
    await expect(
      page.locator('tr').filter({ hasText: 'Chronology Novel Vol 2' }),
    ).toBeVisible();

    // 10. Test Hide Items Checkboxes
    const hideZeroQty = page.locator('#sa-filter-hide-zero-qty');
    await expect(hideZeroQty).toBeVisible();
    // Toggle hide all
    const hideAll = page.locator('#sa-filter-hide-all');
    await hideAll.click(); // Uncheck all
    await expect(hideZeroQty).not.toBeChecked();

    // Reset CPU throttling
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });
});
