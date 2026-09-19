import { test, expect, type Page } from '@playwright/test';

/**
 * Registers via `window.easyAccounting.api` (setup, not what either test
 * below is proving) then logs in through the real Login view, confirming
 * via the sidebar's "Signed in as" text once authenticated.
 */
async function registerAndLoginViaUi(
  page: Page,
  username: string,
  password: string,
) {
  await page.evaluate(
    async ({ username: u, password: p }) => {
      const ok = await window.easyAccounting.api.register({
        username: u,
        password: p,
      });
      if (!ok) throw new Error('setup register() returned false');
    },
    { username, password },
  );
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
  await page.locator('input[placeholder="Username"]').fill(username);
  await page.locator('input[placeholder="Password"]').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 10_000 });
}

/** Creates an account through the real Accounts view's "New Account" dialog. */
async function createAccountViaUi(page: Page, accountName: string) {
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await page.getByRole('button', { name: 'New Account' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox').click();
  await page
    .getByRole('option', { name: 'Current Asset', exact: true })
    .click();
  await dialog.getByLabel('Account Name').fill(accountName);
  await dialog.getByRole('button', { name: 'Submit' }).click();

  await expect(
    page.getByText(`"${accountName}" account created successfully`, {
      exact: true,
    }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole('cell', { name: accountName, exact: true }),
  ).toBeVisible();
}

/**
 * Proof-of-architecture smoke test: the real core AccountService/ChartService
 * run against SQLite-wasm/OPFS in a Web Worker, driven from the real
 * Accounts screen (src/renderer — mounted in place of the original
 * placeholder this spec drove; see apps/web/src/main.tsx), with both the
 * created account AND the logged-in session surviving a full page reload
 * (i.e. actually persisted — the account to OPFS, the session to
 * localStorage via electronShim's `login` wrapper — not just held in
 * memory).
 */
test('create an account and it survives a reload (OPFS persistence)', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => window.easyAccounting.ready);

  const username = `e2e-smoke-${Date.now()}`;
  const password = 'e2e-smoke-password';
  await registerAndLoginViaUi(page, username, password);

  const accountName = `E2E Account ${Date.now()}`;
  await createAccountViaUi(page, accountName);

  await page.reload();
  // The session survives the reload (no re-login needed) — confirms
  // electronShim's `login` wrapper actually persisted it, not just this
  // render's React state.
  await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 30_000 });

  // The account must still be there — proof the data actually round-tripped
  // through OPFS rather than living only in the (now-discarded) worker's
  // in-memory database.
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: accountName, exact: true }),
  ).toBeVisible();

  // --- Business settings (migration 028): the "Total quantity label"
  // invoice print setting, saved through the real Settings screen, is
  // stored in the `settings` table (via window.electron.setSetting — see
  // src/renderer/hooks/useInvoicePrintSettings.ts) rather than localStorage,
  // and must survive a reload the same way the account above does.
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  const totalQuantityLabel = `E2E Qty Label ${Date.now()}`;
  const totalQuantityInput = page.getByLabel('Total quantity label');
  await totalQuantityInput.fill(totalQuantityLabel);
  // exact: true — "Save publish settings" (PublishSettings' own form)
  // otherwise also matches this substring search.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // .first(): the toast can render "Settings saved" in both its title and
  // description, so a bare getByText intermittently hits a strict-mode
  // two-element violation depending on toast timing.
  await expect(page.getByText('Settings saved').first()).toBeVisible({
    timeout: 10_000,
  });

  await page.reload();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByLabel('Total quantity label')).toHaveValue(
    totalQuantityLabel,
    { timeout: 10_000 },
  );
});

/**
 * Full offline proof: the PWA app shell (service worker + precached
 * assets — see vite.config.ts's VitePWA config) must let the app boot with
 * no network at all, and both the session and data created before going
 * offline must still be there after the offline reload — proof that the app
 * shell (via the SW cache), the persisted session (localStorage), and OPFS
 * (which isn't network-backed to begin with, but still needs the app shell
 * to boot in order to reach it) all survive with zero network.
 *
 * This runs against `vite preview` (a real production build) per
 * playwright.config.ts's webServer — service worker behavior under `vite
 * dev` doesn't reflect what actually ships (see vite.config.ts's
 * `devOptions: { enabled: false }`).
 */
test('boots offline from the service worker cache and keeps OPFS data', async ({
  page,
  context,
}) => {
  // --- Phase 1: online, to let the service worker install + precache ---
  await page.goto('/');
  await page.evaluate(() => window.easyAccounting.ready);

  const username = `e2e-offline-${Date.now()}`;
  const password = 'e2e-offline-password';
  await registerAndLoginViaUi(page, username, password);

  // Wait for the SW to finish installing and (via `clientsClaim`, see
  // vite.config.ts) take control of this very page, and for the precache to
  // be fully populated — both must be true before we go offline below.
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.ready;
      if (!registration.active || registration.active.state !== 'activated')
        return false;
      if (!navigator.serviceWorker.controller) return false;
      // The precache is a Cache Storage entry named `workbox-precache-...`;
      // confirm it exists and actually holds entries before trusting it.
      const cacheNames = await caches.keys();
      const precacheName = cacheNames.find((name) =>
        name.startsWith('workbox-precache'),
      );
      if (!precacheName) return false;
      const cache = await caches.open(precacheName);
      const keys = await cache.keys();
      return keys.length > 0;
    },
    { timeout: 30_000 },
  );

  const accountName = `Offline E2E Account ${Date.now()}`;
  await createAccountViaUi(page, accountName);

  // --- Phase 2: fully offline, reload, and boot from cache alone ---
  await context.setOffline(true);

  await page.reload();

  // The service-worker-served shell must still boot the UI, still
  // authenticated (session read from localStorage — no network needed)...
  await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 30_000 });

  // ...and the account created before going offline must still be there.
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: accountName, exact: true }),
  ).toBeVisible();

  await context.setOffline(false);
});
