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
});
