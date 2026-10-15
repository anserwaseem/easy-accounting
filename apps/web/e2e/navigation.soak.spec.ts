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

  test('switching between accounts in Ledger does not leak nodes or listeners', async ({
    page,
    soak,
  }) => {
    const username = `soak-ledger-${Date.now()}`;
    await registerAndLogin(page, username);

    const account1 = `Ledger Alpha ${Date.now()}`;
    const account2 = `Ledger Beta ${Date.now()}`;

    // Seed two asset accounts
    await page.evaluate(
      async ({ a1, a2 }) => {
        await window.easyAccounting.api.insertAccount({
          name: a1,
          headName: 'Current Asset',
        });
        await window.easyAccounting.api.insertAccount({
          name: a2,
          headName: 'Current Asset',
        });
      },
      { a1: account1, a2: account2 },
    );

    await page.getByRole('link', { name: 'Accounts', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Accounts', exact: true }),
    ).toBeVisible();

    // Round-trip: Open Account 1 Ledger -> switch to Account 2 -> return to Accounts list
    await soak.run(
      async () => {
        await page.getByText(account1, { exact: true }).click();
        await expect(
          page.getByRole('heading', { level: 1, name: account1 }),
        ).toBeVisible();

        await page.getByRole('heading', { level: 2, name: account2 }).click();
        await expect(
          page.getByRole('heading', { level: 1, name: account2 }),
        ).toBeVisible();

        await page.getByRole('link', { name: 'Accounts', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Accounts', exact: true }),
        ).toBeVisible();
      },
      {
        passes: 20,
        warmup: 3,
        nodeThreshold: 50,
        listenerThreshold: 0,
      },
    );
  });

  test('navigating between Inventory and Accounts views does not leak nodes or listeners', async ({
    page,
    soak,
  }) => {
    const username = `soak-inv-nav-${Date.now()}`;
    await registerAndLogin(page, username);

    const inventoryLink = page.getByRole('link', {
      name: 'Inventory',
      exact: true,
    });
    const accountsLink = page.getByRole('link', {
      name: 'Accounts',
      exact: true,
    });

    await soak.run(
      async () => {
        await inventoryLink.click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Inventory' }),
        ).toBeVisible();

        await accountsLink.click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Accounts' }),
        ).toBeVisible();
      },
      {
        passes: 20,
        warmup: 3,
        nodeThreshold: 50,
        listenerThreshold: 0,
      },
    );
  });

  test('opening, editing and closing New Inventory Item dialog does not leak nodes or listeners', async ({
    page,
    soak,
  }) => {
    const username = `soak-inv-item-${Date.now()}`;
    await registerAndLogin(page, username);

    await page.getByRole('link', { name: 'Inventory', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Inventory' }),
    ).toBeVisible();

    const newItemButton = page.getByRole('button', { name: 'New item' });
    const dialogTitle = page.getByRole('heading', {
      name: 'Create Inventory Item',
    });

    await soak.run(
      async () => {
        await newItemButton.click();
        await expect(dialogTitle).toBeVisible();

        const nameInput = page.getByLabel('Name', { exact: true });
        await nameInput.fill('Test SKU 123');

        await page.keyboard.press('Escape');
        await expect(dialogTitle).not.toBeVisible();
      },
      {
        passes: 20,
        warmup: 3,
        nodeThreshold: 50,
        listenerThreshold: 0,
      },
    );
  });

  test('navigating between Sale Invoices and Accounts views does not leak nodes or listeners', async ({
    page,
    soak,
  }) => {
    const username = `soak-inv-sale-${Date.now()}`;
    await registerAndLogin(page, username);

    const saleInvoicesLink = page.getByRole('link', {
      name: 'Sale Invoices',
      exact: true,
    });
    const accountsLink = page.getByRole('link', {
      name: 'Accounts',
      exact: true,
    });

    await soak.run(
      async () => {
        await saleInvoicesLink.click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Sale Invoices' }),
        ).toBeVisible();

        await accountsLink.click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Accounts' }),
        ).toBeVisible();
      },
      {
        passes: 20,
        warmup: 3,
        nodeThreshold: 50,
        listenerThreshold: 0,
      },
    );
  });

  test('navigating between Reports hub and Ledger Report does not leak nodes or listeners', async ({
    page,
    soak,
  }) => {
    const username = `soak-reports-${Date.now()}`;
    await registerAndLogin(page, username);

    const reportsLink = page.getByRole('link', {
      name: 'Reports',
      exact: true,
    });

    await reportsLink.click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Reports' }),
    ).toBeVisible();

    const ledgerReportCard = page.getByRole('link', {
      name: /Ledger Report/i,
    });

    await soak.run(
      async () => {
        await ledgerReportCard.click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Ledger Report' }),
        ).toBeVisible();

        await reportsLink.click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Reports' }),
        ).toBeVisible();
      },
      {
        passes: 20,
        warmup: 3,
        nodeThreshold: 50,
        listenerThreshold: 0,
      },
    );
  });

  test('navigating between Reports hub and Sales Performance chart does not leak nodes or listeners', async ({
    page,
    soak,
  }) => {
    const username = `soak-sales-perf-${Date.now()}`;
    await registerAndLogin(page, username);

    const reportsLink = page.getByRole('link', {
      name: 'Reports',
      exact: true,
    });

    await reportsLink.click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Reports' }),
    ).toBeVisible();

    const salesPerfCard = page.getByRole('link', {
      name: /Sales Performance/i,
    });

    await soak.run(
      async () => {
        await salesPerfCard.click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Sales Performance' }),
        ).toBeVisible();

        await reportsLink.click();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Reports' }),
        ).toBeVisible();
      },
      {
        passes: 20,
        warmup: 3,
        nodeThreshold: 50,
        listenerThreshold: 0,
      },
    );
  });

  test('repeated hidden iframe report print lifecycle does not leak nodes or listeners', async ({
    page,
    soak,
  }) => {
    const username = `soak-print-${Date.now()}`;
    await registerAndLogin(page, username);

    await soak.run(
      async () => {
        await page.evaluate(() => {
          const rows = Array.from(
            { length: 50 },
            (_, i) => `<tr><td>Row ${i}</td><td>Value ${i}</td></tr>`,
          ).join('');
          const html = `<!DOCTYPE html><html><head><title>Test</title></head><body><table>${rows}</table></body></html>`;

          const iframe = document.createElement('iframe');
          iframe.setAttribute('aria-hidden', 'true');
          Object.assign(iframe.style, {
            position: 'fixed',
            right: '0',
            bottom: '0',
            width: '0',
            height: '0',
            visibility: 'hidden',
          });
          document.body.appendChild(iframe);

          const doc = iframe.contentDocument;
          const win = iframe.contentWindow;
          if (!doc || !win) {
            iframe.remove();
            return;
          }

          doc.open();
          doc.write(html);
          doc.close();

          const cleanup = () => {
            win.removeEventListener('afterprint', cleanup);
            try {
              if (doc.body) doc.body.innerHTML = '';
            } catch {
              // ignore
            }
            try {
              iframe.src = 'about:blank';
            } catch {
              // ignore
            }
            iframe.remove();
          };

          win.addEventListener('afterprint', cleanup);
          win.dispatchEvent(new Event('afterprint'));
        });
        await page.waitForTimeout(50);
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
