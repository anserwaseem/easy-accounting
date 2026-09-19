import { test, expect, type Page } from '@playwright/test';

/**
 * Mobile-shell coverage: the real renderer (src/renderer — same app
 * smoke.spec.ts and renderer.spec.ts drive) at a 390x844 phone viewport
 * (see playwright.config.ts's `mobile-390x844` project — this file only
 * runs under that project, never at the desktop viewport the rest of the
 * suite uses).
 *
 * Proves the collapsed-by-default hamburger overlay works end to end, and
 * that every priority screen (Home, Accounts + Ledger, Inventory, Sale
 * Invoices + New Sale Invoice) renders with no BODY-LEVEL horizontal
 * overflow — a data table or a wide row is allowed to scroll within its
 * own container (see dataTable.tsx), but the page itself must never grow
 * wider than the viewport.
 */

const PASSWORD = 'mobile-e2e-password';

/** document.documentElement never wider than the viewport it's rendered in. */
async function assertNoBodyOverflow(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `${label}: body-level horizontal overflow`,
  ).toBeLessThanOrEqual(clientWidth);
}

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

/** The app shell's hamburger — collapsed (off-canvas) by default on mobile. */
async function openMobileMenu(page: Page) {
  const hamburger = page.getByRole('button', {
    name: 'Open menu',
    exact: true,
  });
  await expect(hamburger).toBeVisible();
  await hamburger.click();
}

async function navigateViaMobileMenu(page: Page, linkName: string) {
  await openMobileMenu(page);
  await page.getByRole('link', { name: linkName, exact: true }).click();
}

test.describe('mobile shell (390x844)', () => {
  test('sidebar is a collapsed-by-default hamburger overlay, not a static column', async ({
    page,
  }) => {
    await registerAndLogin(page, `e2e-mobile-shell-${Date.now()}`);

    await assertNoBodyOverflow(page, 'home (logged in)');

    // Collapsed by default: the nav is off-canvas (translated fully out of
    // the viewport) until the hamburger is opened. It's still technically
    // "visible" by CSS display/visibility (that's what makes the slide-in
    // transition possible), so this checks position rather than
    // Playwright's visibility state.
    const accountsLinkClosed = page.getByRole('link', {
      name: 'Accounts',
      exact: true,
    });
    const closedBox = await accountsLinkClosed.boundingBox();
    expect(closedBox).not.toBeNull();
    expect(closedBox!.x + closedBox!.width).toBeLessThanOrEqual(0);

    // Opening reveals the full labeled nav (never icon-only — see
    // components/Sidebar.tsx's `effectiveCollapsed`) as a full-width overlay
    // with a dismissable backdrop.
    await openMobileMenu(page);
    const accountsLink = page.getByRole('link', {
      name: 'Accounts',
      exact: true,
    });
    await expect(accountsLink).toBeVisible();
    // The panel slides in (200ms CSS transition, see Sidebar.tsx) — wait
    // for it to land on-screen rather than reading its position mid-slide.
    await expect(async () => {
      const openBox = await accountsLink.boundingBox();
      expect(openBox).not.toBeNull();
      expect(openBox!.x).toBeGreaterThanOrEqual(0);
    }).toPass({ timeout: 5_000 });
    const box = await accountsLink.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    // Clicking the backdrop (right edge of the viewport, outside the
    // 260px-wide open panel) closes the overlay again.
    await page.mouse.click(370, 700);
    await expect(async () => {
      const reclosedBox = await accountsLink.boundingBox();
      expect(reclosedBox).not.toBeNull();
      expect(reclosedBox!.x + reclosedBox!.width).toBeLessThanOrEqual(0);
    }).toPass({ timeout: 5_000 });
  });

  test('Accounts, Ledger, Inventory, and Sale Invoices all fit the viewport with usable dialogs', async ({
    page,
  }) => {
    const stamp = Date.now();
    const username = `e2e-mobile-flow-${stamp}`;
    const cashName = `Cash ${stamp}`;
    const itemName = `Widget ${stamp}`;

    await registerAndLogin(page, username);

    // --- Accounts: list + "New Account" dialog ---
    await navigateViaMobileMenu(page, 'Accounts');
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    await assertNoBodyOverflow(page, 'accounts list');

    await page.getByRole('button', { name: 'New Account' }).click();
    const accountDialog = page.getByRole('dialog');
    await expect(accountDialog).toBeVisible();
    await assertNoBodyOverflow(page, 'account dialog open');
    // Full-width-with-gutter per the mobile dialog treatment (dialog.tsx) —
    // not clipped, and not a narrow desktop-sized card floating in the middle.
    const dialogBox = await accountDialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.width).toBeGreaterThan(390 * 0.7);

    await accountDialog.getByRole('combobox').click();
    await page
      .getByRole('option', { name: 'Current Asset', exact: true })
      .click();
    await accountDialog.getByLabel('Account Name').fill(cashName);
    const submitButton = accountDialog.getByRole('button', { name: 'Submit' });
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();
    await submitButton.click();
    await expect(
      page.getByText(`"${cashName}" account created successfully`, {
        exact: true,
      }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(accountDialog).toBeHidden();

    // "Sale" and "Purchase" accounts (setup, not part of what this test
    // verifies — same rationale as renderer.spec.ts's doc comment): New
    // Sale Invoice refuses to render its real form until accounts
    // literally named "Sale"/"Purchase" exist, and this test's whole point
    // is to check that real form fits the viewport. Via the API rather
    // than the dialog again — the dialog itself is already covered above.
    await page.evaluate(async () => {
      await window.easyAccounting.api.insertAccount({
        name: 'Sale',
        headName: 'Revenue',
      });
      await window.easyAccounting.api.insertAccount({
        name: 'Purchase',
        headName: 'Expense',
      });
    });

    // --- Ledger: the account-switcher mini rail is desktop-only; the
    // ledger table itself must still render full width, no overlap ---
    await page.getByRole('cell', { name: cashName, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Ledger', exact: true }),
    ).toBeVisible({
      timeout: 10_000,
    });
    await assertNoBodyOverflow(page, 'ledger');
    await expect(page.getByText(cashName).first()).toBeVisible();

    // --- Inventory: list + "New item" dialog ---
    await navigateViaMobileMenu(page, 'Inventory');
    await expect(
      page.getByRole('heading', { name: 'Inventory' }),
    ).toBeVisible();
    await assertNoBodyOverflow(page, 'inventory list');

    await page.getByRole('button', { name: 'New item' }).click();
    const invDialog = page.getByRole('dialog');
    await expect(invDialog).toBeVisible();
    await assertNoBodyOverflow(page, 'inventory dialog open');
    await invDialog.getByLabel('name', { exact: true }).fill(itemName);
    await invDialog.getByLabel('price', { exact: true }).fill('150');
    const invSubmit = invDialog.getByRole('button', { name: 'Submit' });
    await expect(invSubmit).toBeVisible();
    await expect(invSubmit).toBeEnabled();
    await invSubmit.click();
    await expect(
      page.getByText('Inventory Item created successfully', { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // Opening stock (setup, not part of what this test verifies — same
    // rationale as renderer.spec.ts's doc comment): New Sale Invoice
    // refuses to render its real form for an item with no stock at all,
    // and this test's whole point is to check that real form fits the
    // viewport.
    await page.evaluate(async (name) => {
      const items = await window.easyAccounting.api.getInventory();
      const item = (items as { id: number; name: string }[]).find(
        (i) => i.name === name,
      );
      if (!item) throw new Error('inventory item not found for stock setup');
      await window.easyAccounting.api.applyStockAdjustment({
        inventoryId: item.id,
        quantityDelta: 20,
        reason: 'mobile e2e setup: opening stock for sale invoice flow',
      });
    }, itemName);

    // --- Sale Invoices list + New Sale Invoice form ---
    await navigateViaMobileMenu(page, 'Sale Invoices');
    await expect(
      page.getByRole('heading', { name: 'Sale Invoices' }),
    ).toBeVisible();
    await assertNoBodyOverflow(page, 'sale invoices list');

    await openMobileMenu(page);
    await page.getByRole('link', { name: /^New sale invoice/ }).click();
    await expect(
      page.getByRole('heading', { name: 'New Sale Invoice' }),
    ).toBeVisible();
    await assertNoBodyOverflow(page, 'new sale invoice form');

    const partyInput = page.getByPlaceholder('Select a party');
    await expect(partyInput).toBeVisible();
    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saveButton).toBeVisible();
    const saveBox = await saveButton.boundingBox();
    expect(saveBox).not.toBeNull();
    expect(saveBox!.x + saveBox!.width).toBeLessThanOrEqual(390);
  });
});
