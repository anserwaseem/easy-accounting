import { test, expect } from '@playwright/test';
import { buildDesktopDatabaseFixture } from './fixtures/buildDesktopDatabase';

/**
 * Drives the real "bring your database" Import UI (src/renderer/views/Import
 * — reachable from Login, see below) end to end: build a real desktop-format
 * SQLite file in Node (fixtures/buildDesktopDatabase.ts — schema.sql +
 * every historical migration via better-sqlite3, seeded with a user whose
 * password hash comes from the real src/main/utils/encrypt.ts, an account,
 * a posted journal, an inventory item with opening stock, and a sale
 * invoice against it), upload it through the real file input, confirm the
 * replace, then log in as the imported user (proving the desktop-format
 * password hash verifies via the WebCrypto reimplementation in
 * apps/web/src/worker/webCrypto.ts's `verifyDesktopPassword` — no password
 * reset needed) and confirm the imported account, journal, invoice and
 * stock level all show up on their real screens.
 */

const PASSWORD = 'desktop-e2e-password';

test.describe('bring your database — import from desktop app', () => {
  test('imports a desktop database and logs in as the imported user', async ({
    page,
  }) => {
    const username = `desktop-import-${Date.now()}`;
    const fixture = buildDesktopDatabaseFixture({
      username,
      password: PASSWORD,
    });

    await page.goto('/');
    await page.evaluate(() => window.easyAccounting.ready);

    // --- Entry point: the Login view's "Import from desktop app" link ---
    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
    await page.getByRole('link', { name: 'Import from desktop app' }).click();
    await expect(
      page.getByRole('heading', { name: 'Import from desktop app' }),
    ).toBeVisible();

    // --- Upload the fixture file -> preview step ---
    await page.setInputFiles('#desktopDbFile', {
      name: 'database.db',
      mimeType: 'application/octet-stream',
      buffer: fixture.bytes,
    });

    await expect(
      page.getByText('This will replace all data in this browser'),
    ).toBeVisible({ timeout: 15_000 });
    // Row-count preview: the account/journal/inventory/invoice tables the
    // fixture seeded should each show a nonzero count.
    const accountPreviewRow = page.getByRole('row', { name: /^account\s/ });
    await expect(accountPreviewRow).toContainText('2');
    const journalPreviewRow = page.getByRole('row', { name: /^journal\s/ });
    await expect(journalPreviewRow).toContainText('1');
    const invoicePreviewRow = page.getByRole('row', { name: /^invoices\s/ });
    await expect(invoicePreviewRow).toContainText('1');

    // --- Confirm the replace ---
    await page.getByRole('button', { name: 'Replace and Import' }).click();
    await expect(page.getByText('Import complete')).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole('button', { name: 'Continue to Login' }).click();
    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();

    // --- Log in as the imported user (desktop-format password hash) ---
    await page.locator('input[placeholder="Username"]').fill(username);
    await page.locator('input[placeholder="Password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByText('Signed in as')).toBeVisible({
      timeout: 10_000,
    });

    // --- Accounts: the imported account is there ---
    await page.getByRole('link', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    await page
      .getByRole('button', {
        name: /^(All|Asset|Liability|Equity|Revenue|Expense) Accounts$/,
      })
      .click();
    await page.getByRole('menuitem', { name: 'All Accounts' }).click();
    await expect(
      page.getByRole('cell', { name: fixture.accountName, exact: true }),
    ).toBeVisible();

    // --- Journals: the imported journal is there ---
    await page.getByRole('link', { name: 'Journals', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Journals' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(fixture.journalNarration)).toBeVisible();

    // --- Sale Invoices: the imported invoice is there (by customer name) ---
    await page
      .getByRole('link', { name: 'Sale Invoices', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Sale Invoices' }),
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('cell', { name: fixture.accountName, exact: true }),
    ).toBeVisible();

    // --- Inventory: opening stock (10) minus the sale (3) = 7 ---
    await page.getByRole('link', { name: 'Inventory', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Inventory' }),
    ).toBeVisible();
    await page.getByRole('checkbox', { name: 'All', exact: true }).click();
    const row = page.locator('tr', { hasText: fixture.inventoryName });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText(String(fixture.ids.expectedStock));
  });

  /**
   * Real production bug this covers (see src/core/db/openingBalanceBackfill.ts's
   * doc comment): a desktop database that predates migration 025 has
   * "Opening Balance from B/S" `ledger` rows written straight to that table
   * with no backing `journal`/`journal_entry` rows at all. Post migration
   * 028's cutover, every screen in this app reads from `ledger_view` — a
   * pure projection of `journal`/`journal_entry` — never from the stored
   * `ledger` table, so without `importDatabase` backfilling the missing
   * journal during import, this entry would silently be invisible in the
   * Ledger UI after import. This test drives the real UI end to end and
   * confirms it is NOT invisible: the entry shows up on the account's
   * ledger screen exactly like `import.spec.ts`'s other assertions confirm
   * for accounts/journals/invoices/inventory.
   */
  test('imports a pre-025 desktop database and shows the backfilled opening-balance entry on the account ledger', async ({
    page,
  }) => {
    const username = `desktop-import-opening-balance-${Date.now()}`;
    const fixture = buildDesktopDatabaseFixture(
      { username, password: PASSWORD },
      { preMigration025: true },
    );
    expect(fixture.openingBalance).toBeDefined();

    await page.goto('/');
    await page.evaluate(() => window.easyAccounting.ready);

    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
    await page.getByRole('link', { name: 'Import from desktop app' }).click();
    await expect(
      page.getByRole('heading', { name: 'Import from desktop app' }),
    ).toBeVisible();

    await page.setInputFiles('#desktopDbFile', {
      name: 'database.db',
      mimeType: 'application/octet-stream',
      buffer: fixture.bytes,
    });
    await expect(
      page.getByText('This will replace all data in this browser'),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Replace and Import' }).click();
    await expect(page.getByText('Import complete')).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole('button', { name: 'Continue to Login' }).click();
    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();

    await page.locator('input[placeholder="Username"]').fill(username);
    await page.locator('input[placeholder="Password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByText('Signed in as')).toBeVisible({
      timeout: 10_000,
    });

    // --- Open the Cash account's ledger and find the backfilled entry -----
    await page.getByRole('link', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    await page
      .getByRole('button', {
        name: /^(All|Asset|Liability|Equity|Revenue|Expense) Accounts$/,
      })
      .click();
    await page.getByRole('menuitem', { name: 'All Accounts' }).click();
    await page
      .getByRole('cell', { name: fixture.accountName, exact: true })
      .click();

    await expect(page.getByRole('heading', { name: 'Ledger' })).toBeVisible({
      timeout: 10_000,
    });
    // level: 1 — the mini account-switcher rail (desktop layout) also
    // renders every account name as a heading (an <h2>), which would
    // otherwise make this ambiguous with the page's own <h1> title.
    await expect(
      page.getByRole('heading', { name: fixture.accountName, level: 1 }),
    ).toBeVisible();
    // The backfilled journal's contra side landed on the system "Opening
    // Balance Equity" account — that is what the ledger row's particulars
    // column shows (LedgerTableBase: linkedAccountName ?? particulars),
    // same as every other journal-backed row showing its counterpart
    // account rather than a raw "Journal #N" label. Its presence at all is
    // the actual regression test: pre-fix, this row simply would not exist
    // in ledger_view at all. Matched on the row's full accessible name
    // (date + particulars + amount together) rather than a bare cell — the
    // desktop layout also renders a mini account-switcher table alongside
    // the ledger, and the imported "Opening Balance Equity" account is a
    // real account that shows up there too (as its own row, with a
    // different accessible name), which would otherwise make a looser
    // locator ambiguous.
    const openingBalanceRow = page.getByRole('row', {
      name: new RegExp(
        `01/01/2024.*${fixture.openingBalance!.equityAccountName}.*` +
          fixture.openingBalance!.amount.toLocaleString('en-US', {
            minimumFractionDigits: 2,
          }),
      ),
    });
    await expect(openingBalanceRow).toBeVisible();
  });
});
