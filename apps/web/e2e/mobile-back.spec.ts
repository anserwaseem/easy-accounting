import { test, expect, type Page } from '@playwright/test';

/**
 * Back-navigation coverage for the mobile shell.
 *
 * The app renders inside a `MemoryRouter`, which keeps its own history
 * but never touches the browser URL. That left the user with no way back
 * from a detail screen except the hamburger menu — every move between
 * two related screens meant opening the menu and hunting for the
 * destination again.
 *
 * The shell now offers a back button that steps to the previous screen,
 * and mirrors the current location into the browser's own history so the
 * browser/Android back gesture steps through the app instead of leaving
 * it.
 */

const PASSWORD = 'mobile-back-e2e-password';

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
  await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 10_000 });
}

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
}

test.describe('mobile back navigation (390x844)', () => {
  test('the back button returns to the previous screen', async ({ page }) => {
    await registerAndLogin(page, `e2e-back-${Date.now()}`);

    // The home screen is the root: there is nothing to go back to, so
    // the top-left slot is the menu button.
    await expect(
      page.getByRole('button', { name: 'Open menu', exact: true }),
    ).toBeVisible();

    // Go to Accounts, then into the New Journal form: two steps, so
    // back has somewhere to go twice.
    await openMenu(page);
    await page.getByRole('link', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();

    // A back button appears now that there is history.
    const back = page.getByRole('button', { name: 'Go back' });
    await expect(back).toBeVisible();

    // Into the New Journal form.
    await openMenu(page);
    await page.getByRole('link', { name: /^New journal/ }).click();
    await expect(
      page.getByRole('heading', { name: 'New Journal' }),
    ).toBeVisible();
    await expect(back).toBeVisible();

    // Back returns to the Accounts list, not to the home screen.
    await back.click();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();

    // And back again returns to the home screen.
    await back.click();
    await expect(page.getByText('Signed in as')).toBeVisible();
  });

  test('the browser back button steps through the app, not out of it', async ({
    page,
  }) => {
    await registerAndLogin(page, `e2e-browser-back-${Date.now()}`);

    await openMenu(page);
    await page.getByRole('link', { name: 'Journals', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Journals' })).toBeVisible();

    // The browser's own back must not leave the app: the shell stays
    // mounted and the app is still usable.
    await page.goBack();
    await expect(
      page.getByRole('button', { name: 'Open navigation menu' }),
    ).toBeVisible();

    // And the app is still usable afterwards.
    await openMenu(page);
    await page.getByRole('link', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  });
});
