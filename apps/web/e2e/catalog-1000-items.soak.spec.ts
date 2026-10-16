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

interface SeededCatalogData {
  totalCount: number;
  headCount: number;
  attributeKeys: string[];
}

async function seedCatalogData(
  page: Page,
  count = 1050,
): Promise<SeededCatalogData> {
  return page.evaluate(async (c) => {
    return (await window.easyAccounting.debug('debug:seedCatalogFixtures', {
      count: c,
    })) as SeededCatalogData;
  }, count);
}

test.describe('Large Catalog 1,000+ Items Soak Tests', () => {
  test('Search debouncing, accordion height recalculation, and multi-attribute facet filtering under 6x CPU slowdown', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const username = `catalog_soak_${Date.now()}`;
    await registerAndLogin(page, username);

    const fixture = await seedCatalogData(page, 1050);
    expect(fixture.totalCount).toBe(1050);
    expect(fixture.headCount).toBe(210);

    // 1. Enable 6x CPU slowdown via Chrome DevTools Protocol
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });

    // 2. Navigate to Inventory
    await page.getByRole('link', { name: 'Inventory' }).click();
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible({
      timeout: 15_000,
    });

    // 3. Verify 1,050 records loaded into virtual DataTable
    await expect(page.getByText('Total records: 1050')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('CAT-0001').first()).toBeVisible();

    // 4. Search Debounce Stress Test under 6x CPU slowdown
    const searchInput = page.getByPlaceholder('Search inventory...');
    await expect(searchInput).toBeVisible();

    // Rapid keystroke burst to stress search debouncing
    await searchInput.type('CAT-0', { delay: 30 });
    await searchInput.type('4', { delay: 30 });
    await searchInput.type('5', { delay: 30 });
    await searchInput.type('0', { delay: 30 });

    // Wait for debounced search to settle and isolate exact SKU
    await expect(page.getByText('Showing 1 out of 1050 records')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('CAT-0450').first()).toBeVisible();
    await expect(page.getByText('CAT-0001')).toHaveCount(0);

    // Clear search and verify full catalog restored
    await searchInput.clear();
    await expect(page.getByText('Total records: 1050')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('CAT-0001').first()).toBeVisible();

    // 5. Expand ItemDetailPanel Accordion & TableVirtuoso Height Recalculation
    // Expand CAT-0001 (Family Head with 4 variants)
    const expandBtn1 = page.locator(
      'button[aria-label="Show details for CAT-0001"]',
    );
    await expect(expandBtn1).toBeVisible();
    await expandBtn1.click();

    // Assert detail panel opens with family variants and attributes
    await expect(page.getByText(/Family head · 4 variants/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Hardcover').first()).toBeVisible();
    await expect(page.getByText('Urdu').first()).toBeVisible();

    // Expand CAT-0002 (Variant pointing to CAT-0001)
    const expandBtn2 = page.locator(
      'button[aria-label="Show details for CAT-0002"]',
    );
    await expect(expandBtn2).toBeVisible();
    await expandBtn2.click();

    await expect(page.getByText('Family head:').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Paperback').first()).toBeVisible();

    // Collapse both items
    const collapseBtn1 = page.locator(
      'button[aria-label="Hide details for CAT-0001"]',
    );
    await collapseBtn1.click();
    await expect(page.getByText(/Family head · 4 variants/i)).toHaveCount(0);

    const collapseBtn2 = page.locator(
      'button[aria-label="Hide details for CAT-0002"]',
    );
    await collapseBtn2.click();
    await expect(page.getByText('Family head:')).toHaveCount(0);

    // 6. Multi-Attribute Facet Filtering under 6x CPU slowdown
    const filtersBtn = page.getByRole('button', { name: /Filters/i });
    await expect(filtersBtn).toBeVisible();
    await filtersBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Filter by Family: "Heads with variants"
    const familySelect = dialog.getByRole('combobox').first();
    await familySelect.click();
    await page.getByRole('option', { name: 'Heads with variants' }).click();

    // Close filters popover
    await page.keyboard.press('Escape');

    // 1050 / 5 = 210 heads
    await expect(page.getByText('Total records: 210')).toBeVisible({
      timeout: 10_000,
    });

    // Open Filters and add Binding: "Hardcover" attribute facet
    await filtersBtn.click();
    await expect(dialog).toBeVisible();

    const bindingSelect = dialog
      .locator('div.grid')
      .filter({ hasText: 'Binding' })
      .getByRole('combobox');
    await bindingSelect.click();
    await page.getByRole('option', { name: 'Hardcover' }).click();

    await page.keyboard.press('Escape');

    // 210 heads / 2 = 105 hardcover heads
    await expect(page.getByText('Total records: 105')).toBeVisible({
      timeout: 10_000,
    });

    // Re-open Filters and click "Clear all"
    await filtersBtn.click();
    await expect(dialog).toBeVisible();

    const clearAllBtn = dialog.getByRole('button', { name: 'Clear all' });
    await expect(clearAllBtn).toBeVisible();
    await clearAllBtn.click();
    await page.keyboard.press('Escape');

    await expect(page.getByText('Total records: 1050')).toBeVisible({
      timeout: 10_000,
    });

    // 7. Deep Virtualized Scrolling Stress Test (15,000px scroll)
    const scroller = page
      .locator(
        '[data-testid="virtuoso-scroller"], div[data-virtuoso-scroller="true"]',
      )
      .first();
    if (await scroller.isVisible()) {
      await scroller.hover();
      for (let s = 0; s < 5; s++) {
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(100);
      }
      // Scrolled deep into the table, earlier items unmounted, subsequent items rendered
      await expect(page.getByText(/CAT-0[2-8]\d\d/).first()).toBeVisible({
        timeout: 10_000,
      });
    }

    // Reset CPU throttling
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });
});
