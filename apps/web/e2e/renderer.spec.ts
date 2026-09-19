import { test, expect, type Page } from '@playwright/test';

/**
 * Drives the REAL renderer (src/renderer — routes, views, shadcn UI; see
 * apps/web/src/main.tsx) end to end in a real browser: register + login
 * through the actual Login/Register views, create accounts through the
 * actual Accounts view, add an inventory item through the actual Inventory
 * view, create + post a journal through the actual New Journal view (and
 * confirm it on the Journals list + the account's Ledger), and create a
 * Sale invoice through the actual New Invoice view (confirming it lists in
 * Sale Invoices and decrements inventory).
 *
 * Two setup steps go through `window.easyAccounting.api` (the same RPC
 * client the UI itself calls — see apps/web/src/main.tsx) instead of the
 * DOM, both because they are incidental to the flows this spec actually
 * verifies, not because the UI path is unreliable:
 *  - registering the user before the very first `page.goto` — the Login
 *    view has no "not registered yet" affordance to chain off of, so the
 *    alternative is a whole separate Register-through-the-UI pass per test
 *  - giving the sale item opening stock before the invoice section — the
 *    Inventory view's own opening-stock UI is a different flow with its own
 *    dedicated coverage surface, not part of "create a sale invoice"
 * Every UI screen the task calls out — Login, Register, Accounts, New
 * Journal, New Invoice — is driven through its real form in this file.
 */

const PASSWORD = 'e2e-renderer-password';

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

/** VirtualSelect (src/renderer/components/VirtualSelect.tsx): the trigger IS
 * a search input until a value is chosen. Typing filters the option list; we
 * then click the matching role="option" row. `container` scopes to one
 * cell/field when a page has more than one such select on screen at once. */
async function pickVirtualSelectOption(
  page: Page,
  container: ReturnType<Page['locator']>,
  searchText: string,
  optionName: string | RegExp,
) {
  const input = container.locator('input').first();
  await input.click();
  await input.fill(searchText);
  const option = page.getByRole('option', { name: optionName });
  await option.first().waitFor({ state: 'visible', timeout: 10_000 });
  await option.first().click();
  // Selecting a VirtualSelect option schedules a `setTimeout(..., 50)` that
  // moves focus to a specific next field (e.g. NewJournal's AccountCell
  // focuses that row's debit input — see src/renderer/views/NewJournal/
  // cells.tsx). Racing that timer with the very next locator action can
  // land a subsequent `.fill()` while focus is mid-transfer, corrupting
  // whichever input ends up focused when it fires. Outlasting the timer
  // here keeps every fill after this call landing in the field it targets.
  await page.waitForTimeout(150);
}

/**
 * `.fill()` on these particular controlled inputs (NewJournal's debit/
 * credit/narration cells, right after a VirtualSelect selection nearby) has
 * intermittently landed empty in this suite despite outlasting the 50ms
 * refocus timer above — rare enough not to reproduce reliably standalone,
 * but real. Filling, then reading the value straight back and retrying if
 * it didn't stick, makes the flow itself robust to that instead of hoping
 * timing never lines up wrong.
 */
async function fillAndVerify(
  locator: ReturnType<Page['locator']>,
  value: string,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await locator.click();
    await locator.fill(value);
    const current = await locator.inputValue();
    if (current === value) return;
    // Debit/credit cells reformat with thousands separators (e.g. "1000" ->
    // "1,000") — for those, comparing digits only avoids mistaking
    // reformatting for the fill not having landed.
    const currentDigits = current.replace(/[^0-9]/g, '');
    const valueDigits = value.replace(/[^0-9]/g, '');
    if (currentDigits !== '' && currentDigits === valueDigits) return;
    await locator.page().waitForTimeout(150);
  }
  throw new Error(`fillAndVerify: "${value}" did not stick in ${locator}`);
}

/**
 * Both New Journal and New Invoice confirm today's date the first time a
 * form is saved with it still selected ("Confirm Date" dialog — see
 * src/renderer/views/NewJournal/index.tsx and NewInvoice's
 * components/DateConfirmationDialog.tsx) — click through it if it appears.
 */
async function confirmTodaysDateIfAsked(page: Page) {
  const useCurrentDate = page.getByRole('button', { name: 'Use Current Date' });
  try {
    await useCurrentDate.waitFor({ state: 'visible', timeout: 3_000 });
  } catch {
    return; // dialog didn't appear — nothing to confirm
  }
  await useCurrentDate.click();
}

async function createAccount(
  page: Page,
  accountName: string,
  headName: string,
) {
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();

  // The Accounts table defaults to (and remembers) a single-type filter —
  // "Asset Accounts" the first time. Switch it to "All Accounts" so a
  // Revenue-head account (e.g. "Sales") isn't filtered out of the table we
  // assert against right after creating it.
  await page
    .getByRole('button', {
      name: /^(All|Asset|Liability|Equity|Revenue|Expense) Accounts$/,
    })
    .click();
  await page.getByRole('menuitem', { name: 'All Accounts' }).click();

  await page.getByRole('button', { name: 'New Account' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Account Head is a radix Select (not VirtualSelect) — open via its
  // combobox trigger, then pick the option by accessible name.
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: headName, exact: true }).click();

  await dialog.getByLabel('Account Name').fill(accountName);
  await dialog.getByRole('button', { name: 'Submit' }).click();

  // Toast text is announced twice (the visible toast + a screen-reader
  // aria-live region echoing it) — `exact` picks the plain toast element.
  await expect(
    page.getByText(`"${accountName}" account created successfully`, {
      exact: true,
    }),
  ).toBeVisible({
    timeout: 10_000,
  });
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('cell', { name: accountName, exact: true }),
  ).toBeVisible();
}

test.describe('real renderer — full UI flows', () => {
  test('register, log in, create accounts, add inventory, post a journal, and create a sale invoice', async ({
    page,
  }) => {
    const stamp = Date.now();
    const username = `e2e-renderer-${stamp}`;
    const cashName = `Cash ${stamp}`;
    const salesName = `Sales ${stamp}`;
    const itemName = `Widget ${stamp}`;

    // --- Login / Register views ---
    await registerAndLogin(page, username);

    // --- Accounts view: two accounts, through the real "New Account" dialog ---
    await createAccount(page, cashName, 'Current Asset');
    await createAccount(page, salesName, 'Revenue');
    // NewInvoice refuses to render its form at all ("Please add both Sale
    // and Purchase accounts before creating an invoice") until accounts
    // literally named "Sale" and "Purchase" exist (see
    // src/renderer/views/NewInvoice/hooks/useNewInvoiceParties.ts) — a
    // one-time chart-of-accounts setup step, unrelated to the "Cash"/
    // "Sales" party/journal accounts above.
    await createAccount(page, 'Sale', 'Revenue');
    await createAccount(page, 'Purchase', 'Expense');

    // --- Inventory view: add an item through the real "New item" dialog ---
    await page.getByRole('link', { name: 'Inventory', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Inventory' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'New item' }).click();
    const invDialog = page.getByRole('dialog');
    await expect(invDialog).toBeVisible();
    await invDialog.getByLabel('name', { exact: true }).fill(itemName);
    await invDialog.getByLabel('price', { exact: true }).fill('150');
    await invDialog.getByRole('button', { name: 'Submit' }).click();
    await expect(
      page.getByText('Inventory Item created successfully', { exact: true }),
    ).toBeVisible({
      timeout: 10_000,
    });
    // A brand-new item has 0 quantity and no item type, and the Inventory
    // view hides zero-quantity AND no-type rows by default
    // (src/renderer/views/Inventory/index.tsx — hideZeroQuantity/hideNoType
    // both start `true`) — "All" clears every hide-filter at once so the row
    // we just created is visible.
    await page.getByRole('checkbox', { name: 'All', exact: true }).click();
    await expect(
      page.getByRole('cell', { name: itemName, exact: true }),
    ).toBeVisible();

    // --- New Journal view: post a journal, through the real form ---
    await page.getByRole('link', { name: /^New journal/ }).click();
    await expect(
      page.getByRole('heading', { name: 'New Journal' }),
    ).toBeVisible();

    const journalAmount = '1000';
    const accountCell0 = page.locator('#account-cell-0');
    const accountCell1 = page.locator('#account-cell-1');
    await pickVirtualSelectOption(page, accountCell0, cashName, cashName);
    await fillAndVerify(page.locator('#debit-input-0'), journalAmount);
    await page.waitForTimeout(150);
    await pickVirtualSelectOption(page, accountCell1, salesName, salesName);
    await fillAndVerify(page.locator('#credit-input-1'), journalAmount);
    await page.waitForTimeout(150);

    await fillAndVerify(
      page.getByLabel('Narration'),
      `E2E renderer journal ${stamp}`,
    );
    await page.getByRole('button', { name: /Save and Publish/ }).click();
    await confirmTodaysDateIfAsked(page);

    // Saving does not navigate away — src/renderer/views/NewJournal/
    // index.tsx's submitJournal() resets the (now-saved) form in place and
    // toasts, so the next journal can be entered right away. Confirm the
    // save via that toast, then navigate to the Journals list ourselves.
    await expect(
      page.getByText('Journal saved successfully', { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole('link', { name: 'Journals', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Journals' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(`E2E renderer journal ${stamp}`)).toBeVisible();

    // --- Ledger view: the posted journal shows on the Cash account's ledger ---
    await page.getByRole('link', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    await page.getByRole('cell', { name: cashName, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Ledger', exact: true }),
    ).toBeVisible({
      timeout: 10_000,
    });
    // Debit/credit cells are formatted with thousands grouping and no
    // currency symbol (see getFormattedDebitCreditWithoutCurrency) — "1000"
    // renders as "1,000.00".
    await expect(page.getByText('1,000').first()).toBeVisible();

    // --- Sale Invoice: give the item stock (setup, see file doc comment),
    // then create the invoice through the real New Invoice view ---
    const inventoryId: number = await page.evaluate(async (name) => {
      const items = await window.easyAccounting.api.getInventory();
      const item = (items as { id: number; name: string }[]).find(
        (i) => i.name === name,
      );
      if (!item) throw new Error('inventory item not found for stock setup');
      await window.easyAccounting.api.applyStockAdjustment({
        inventoryId: item.id,
        quantityDelta: 20,
        reason: 'e2e setup: opening stock for sale invoice flow',
      });
      return item.id;
    }, itemName);
    expect(inventoryId).toBeGreaterThan(0);

    await page.getByRole('link', { name: /^New sale invoice/ }).click();
    await expect(
      page.getByRole('heading', { name: 'New Sale Invoice' }),
    ).toBeVisible();

    // "Select a party" is a unique placeholder on this page (unlike "Select
    // account"/"Select item", which each appear once per row), so it's
    // targeted directly rather than through pickVirtualSelectOption's
    // "first input in this container" scoping — the page has several
    // earlier inputs (invoice number, split-by-type checkboxes) that would
    // wrongly win a bare "first()" on the whole page.
    const partyInput = page.getByPlaceholder('Select a party');
    await partyInput.click();
    await partyInput.fill(cashName);
    const partyOption = page.getByRole('option', { name: cashName });
    await partyOption.first().waitFor({ state: 'visible', timeout: 10_000 });
    await partyOption.first().click();
    await page.waitForTimeout(150);

    await page.getByRole('button', { name: 'Add New Item' }).click();
    // Scoped by the "Select item" placeholder only to pick the item — once
    // picked, that placeholder input is replaced by a button showing the
    // item's name (same VirtualSelect swap as everywhere else in this
    // file), so this locator would stop matching the row at all if reused
    // afterward. `rowByItemName` (matching the now-visible item name
    // instead) stays valid post-selection, for the quantity fill below.
    const unselectedItemRow = page.locator('tr', {
      has: page.getByPlaceholder('Select item'),
    });
    await pickVirtualSelectOption(page, unselectedItemRow, itemName, itemName);
    const rowByItemName = page.locator('tr', { hasText: itemName });
    await fillAndVerify(
      rowByItemName.locator('input[type="number"]').first(),
      '3',
    );

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await confirmTodaysDateIfAsked(page);

    // Saving navigates to the new invoice's own detail page (see
    // src/renderer/views/NewInvoice/index.tsx's onSubmit — `navigate(
    // /${invoiceType}/invoices/${invoiceId})`), not the Sale Invoices list —
    // confirm via the save toast, then go to the list ourselves.
    await expect(
      page.getByText('Sale invoice saved successfully', { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    await page
      .getByRole('link', { name: 'Sale Invoices', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Sale Invoices' }),
    ).toBeVisible({
      timeout: 10_000,
    });

    // --- Inventory view: stock decremented by the sale (20 - 3 = 17) ---
    await page.getByRole('link', { name: 'Inventory', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Inventory' }),
    ).toBeVisible();
    // The hide-filters are plain component state (see the earlier comment)
    // — they reset to their zero-quantity/no-type-hiding defaults on this
    // fresh mount, and our item still has no item type.
    await page.getByRole('checkbox', { name: 'All', exact: true }).click();
    const row = page.locator('tr', { hasText: itemName });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('17');
  });
});
