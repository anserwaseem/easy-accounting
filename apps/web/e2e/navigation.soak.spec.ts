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

test.describe('Soak Tests - Memory Leak Detection', () => {
  // Use clock: false initially to avoid freezing web-worker / UI async timers,
  // focusing strictly on DOM node and event listener retainers.
  test.use({
    soakOptions: {
      clock: false,
    },
  });

  test('opening and closing New Account modal does not leak nodes or listeners', async ({
    page,
    soak,
  }) => {
    const username = `soak-user-${Date.now()}`;
    await registerAndLogin(page, username);

    await page.getByRole('link', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();

    // Measure / run the open & close dialog flow
    await soak.run(
      async () => {
        await page.getByRole('button', { name: 'New', exact: true }).click();
        await page.getByRole('menuitem', { name: 'New Account' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).not.toBeVisible();
      },
      {
        passes: 20,
        warmup: 3,
        nodeThreshold: 50,
        listenerThreshold: 0,
      },
    );
  });

  test('navigating between Accounts and Settings views does not leak nodes or listeners', async ({
    page,
    soak,
  }) => {
    const username = `soak-nav-${Date.now()}`;
    await registerAndLogin(page, username);

    await page.getByRole('link', { name: 'Accounts', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Accounts', exact: true }),
    ).toBeVisible();

    // Round-trip navigation: Accounts -> Settings -> Accounts
    await soak.run(
      async () => {
        await page.getByRole('link', { name: 'Settings' }).click();
        await expect(
          page.getByRole('heading', { name: 'Settings', exact: true }),
        ).toBeVisible();

        await page.getByRole('link', { name: 'Accounts', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Accounts', exact: true }),
        ).toBeVisible();
      },
      {
        passes: 20,
        warmup: 3,
        nodeThreshold: 60,
        listenerThreshold: 0,
      },
    );
  });

  test('filtering and clearing search in Accounts DataTable does not leak nodes or listeners', async ({
    page,
    soak,
  }) => {
    const username = `soak-filter-${Date.now()}`;
    await registerAndLogin(page, username);

    await page.getByRole('link', { name: 'Accounts', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Accounts', exact: true }),
    ).toBeVisible();

    const searchInput = page.getByPlaceholder('Search accounts...');
    await expect(searchInput).toBeVisible();

    // Round-trip search: type search query -> debounce -> clear search query
    await soak.run(
      async () => {
        await searchInput.fill('Asset');
        await page.waitForTimeout(100);
        await searchInput.clear();
        await page.waitForTimeout(100);
      },
      {
        passes: 20,
        warmup: 3,
        nodeThreshold: 50,
        listenerThreshold: 0,
        diagnose: 'always',
      },
    );
  });

  test('adding line items and clearing New Invoice form does not leak nodes or listeners', async ({
    page,
    soak,
  }) => {
    const username = `soak-inv-${Date.now()}`;
    await registerAndLogin(page, username);

    // Setup: create inventory item with stock and required accounts (Sale, Purchase, Cash)
    await page.evaluate(async () => {
      await window.easyAccounting.api.insertInventoryItem({
        name: 'Soak Item 1',
        price: 100,
      });
      const items = (await window.easyAccounting.api.getInventory()) as {
        id: number;
        name: string;
      }[];
      const found = items.find((i) => i.name === 'Soak Item 1');
      if (found) {
        await window.easyAccounting.api.applyStockAdjustment({
          inventoryId: found.id,
          quantityDelta: 20,
          reason: 'soak opening stock',
        });
      }
      await window.easyAccounting.api.insertAccount({
        name: 'Sale',
        headName: 'Revenue',
      });
      await window.easyAccounting.api.insertAccount({
        name: 'Purchase',
        headName: 'Expense',
      });
      await window.easyAccounting.api.insertAccount({
        name: 'Cash',
        headName: 'Current Asset',
      });
    });

    await page.getByRole('link', { name: /^New sale invoice/ }).click();
    await expect(
      page.getByRole('heading', { name: 'New Sale Invoice' }),
    ).toBeVisible();

    const addItemButton = page.getByRole('button', { name: 'Add New Item' });
    const clearButton = page.getByRole('button', {
      name: 'Clear',
      exact: true,
    });

    // Round-trip: append line item -> reset form with Clear button
    await soak.run(
      async () => {
        await addItemButton.click();
        await expect(page.getByPlaceholder('Select item')).toBeVisible();

        await clearButton.click();
        await expect(page.getByPlaceholder('Select item')).not.toBeVisible();
        await page.waitForTimeout(50);
      },
      {
        passes: 20,
        warmup: 3,
        nodeThreshold: 60,
        listenerThreshold: 0,
      },
    );
  });

  test('opening, querying and closing Global Search palette does not leak nodes or listeners', async ({
    page,
    soak,
  }) => {
    const username = `soak-cmdk-${Date.now()}`;
    await registerAndLogin(page, username);

    const isMac = process.platform === 'darwin';
    const shortcut = isMac ? 'Meta+k' : 'Control+k';
    const searchInput = page.getByPlaceholder(
      'Search accounts, inventory, invoices...',
    );

    // Round-trip: Cmd+K -> type query -> Escape -> closed
    await soak.run(
      async () => {
        await page.keyboard.press(shortcut);
        await expect(searchInput).toBeVisible();

        await searchInput.fill('account');
        await page.waitForTimeout(50);

        await page.keyboard.press('Escape');
        await expect(searchInput).not.toBeVisible();
      },
      {
        passes: 20,
        warmup: 3,
        nodeThreshold: 50,
        listenerThreshold: 0,
      },
    );
  });
});
