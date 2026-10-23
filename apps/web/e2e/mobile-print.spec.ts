import { test, expect, type Page } from '@playwright/test';

/**
 * Printable invoice on a phone.
 *
 * The printable invoice screen is the one screen whose whole job is to
 * look like a piece of paper, and a phone has neither the width nor the
 * paper. So the phone gets a different toolbar (one primary action plus a
 * sheet for everything else) and a preview that is laid out at A4 width
 * and scaled down to fit, the way a PDF viewer does it.
 *
 * The printing itself is the browser's job, and the browser is not
 * uniform about it: Chrome on Android opens the system print screen
 * (which carries a "Save as PDF" destination), while Chrome on iOS is a
 * WKWebView wrapper that accepts `window.print()` and prints nothing.
 * These tests pin both behaviours, plus the fallback the app shows when
 * a browser drops the print request entirely.
 *
 * Runs under the `mobile-390x844` project (see playwright.config.ts).
 */

const PASSWORD = 'mobile-print-e2e-password';

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const IOS_CHROME_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1';

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
  await page.evaluate(async () => {
    await window.easyAccounting.api.setAdvancedCapabilities([
      'inventory.adjustStock',
      'inventory.setOpeningStock',
    ]);
  });
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
  await page.locator('input[placeholder="Username"]').fill(username);
  await page.locator('input[placeholder="Password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText('Signed in as')).toBeVisible({ timeout: 10_000 });
}

/** one sale invoice, so the print screen has a real sheet to lay out */
async function seedInvoice(page: Page) {
  const result = await page.evaluate(async () => {
    for (const [name, headName] of [
      ['Sale', 'Revenue'],
      ['Purchase', 'Expense'],
      ['Test Customer', 'Current Asset'],
    ]) {
      try {
        await window.easyAccounting.api.insertAccount({ name, headName });
      } catch (e) {
        // already there from a previous run in the same browser profile
      }
    }
    try {
      await window.easyAccounting.api.insertItemType('Business Cards');
    } catch (e) {
      // ditto
    }
    const itemTypes = await window.easyAccounting.api.getItemTypes();
    try {
      await window.easyAccounting.api.insertInventoryItem({
        name: 'Premium Card',
        price: 250,
        description: 'A test card',
      });
    } catch (e) {
      // ditto
    }
    const items = await window.easyAccounting.api.getInventory();
    const item = items[0];
    if (!item) throw new Error('no inventory item to bill');
    if (itemTypes[0]) {
      await window.easyAccounting.api.updateInventoryItem({
        id: item.id,
        price: 250,
        description: 'A test card',
        itemTypeId: itemTypes[0].id,
      });
      await window.easyAccounting.api.applyStockAdjustment({
        inventoryId: item.id,
        quantityDelta: 50,
        reason: 'opening stock',
      });
    }
    const accounts = await window.easyAccounting.api.getAccounts();
    const customer = accounts.find((a) => a.name === 'Test Customer');
    if (!customer) throw new Error('no customer account to bill');
    await window.easyAccounting.api.insertInvoice('Sale', {
      date: new Date(2026, 8, 12).toISOString(),
      invoiceNumber: 1,
      invoiceType: 'Sale',
      totalAmount: 750,
      biltyNumber: 42,
      cartons: 4,
      invoiceItems: [
        { inventoryId: item.id, quantity: 3, price: 250, discount: 0 },
      ],
      accountMapping: { singleAccountId: customer.id },
    });
    return true;
  });
  expect(result).toBe(true);
}

/** the invoice list -> the invoice -> the printable invoice */
async function openPrintableInvoice(page: Page) {
  const menu = page.getByRole('button', { name: 'Open navigation menu' });
  await expect(menu).toBeVisible();
  await menu.click();
  await page.getByRole('link', { name: 'Sale Invoices', exact: true }).click();
  await expect(page.getByText('Test Customer').first()).toBeVisible();
  await page.getByText('Test Customer').first().click();
  await page
    .getByRole('button', { name: /Printable Invoice/i })
    .first()
    .click();
  await expect(
    page.getByRole('button', { name: 'Print', exact: true }),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe('printable invoice on a phone (390x844)', () => {
  test.describe('chrome on android', () => {
    test.use({ userAgent: ANDROID_UA });

    test('the sheet is scaled to fit the screen and never overflows it', async ({
      page,
    }) => {
      await registerAndLogin(page, `e2e-print-android-${Date.now()}`);
      await seedInvoice(page);
      await openPrintableInvoice(page);

      // the phone toolbar: one primary action, the rest behind a sheet
      await expect(
        page.getByRole('button', { name: 'More print options' }),
      ).toBeVisible();
      // the desktop-only file buttons have no browser equivalent
      await expect(page.getByRole('button', { name: /Open PDF/i })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole('button', { name: /Batch save PDFs/i }),
      ).toHaveCount(0);

      // the page itself never grows wider than the viewport
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        'body-level horizontal overflow',
      ).toBeLessThanOrEqual(overflow.clientWidth);

      // the sheet is laid out at A4 width and scaled down to fit, and the
      // wrapper clips it so the scaled page is what shows
      const sheet = await page.evaluate(() => {
        const wrap = document.querySelector('.invoice-print-scale-wrap');
        const el = document.querySelector('.invoice-print-sheet');
        if (!wrap || !el) return null;
        const matrix = getComputedStyle(el).transform;
        const scale = matrix.startsWith('matrix(')
          ? Number(matrix.slice('matrix('.length).split(',')[0])
          : 1;
        return {
          scale,
          wrapWidth: wrap.getBoundingClientRect().width,
          wrapOverflow: getComputedStyle(wrap).overflow,
          sheetWidth: el.getBoundingClientRect().width,
        };
      });
      expect(sheet).not.toBeNull();
      expect(sheet!.scale).toBeLessThan(1);
      expect(sheet!.scale).toBeGreaterThan(0);
      // the scaled page fits the screen, and does not spill out of it
      expect(sheet!.sheetWidth).toBeLessThanOrEqual(390);
      expect(sheet!.wrapOverflow).toBe('hidden');

      // the print button tells the user where the PDF lives on Android
      await expect(
        page.getByText('The print screen opens here. Choose Save as PDF'),
      ).toBeVisible();
    });

    test('a browser that drops the print request gets the Android steps', async ({
      page,
    }) => {
      await registerAndLogin(page, `e2e-print-fallback-${Date.now()}`);
      await seedInvoice(page);
      await openPrintableInvoice(page);

      // a browser that accepts the request and prints nothing (some
      // WebAPK builds do this) — the app notices and explains itself
      await page.evaluate(() => {
        (window as unknown as { print: () => void }).print = () => {};
      });
      await page.getByRole('button', { name: 'Print', exact: true }).click();

      await expect(page.getByText('Save this invoice as a PDF')).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByText('Choose Save as PDF as the destination'),
      ).toBeVisible();
    });

    test('the printed page is a real, single-page PDF', async ({ page }) => {
      await registerAndLogin(page, `e2e-print-pdf-${Date.now()}`);
      await seedInvoice(page);
      await openPrintableInvoice(page);

      const pdf = await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
      });
      const text = pdf.toString('latin1');
      expect(text).toContain('/MediaBox');
      // one page, not a page per screen
      const pages = text.match(/\/Type\s*\/Page[^s]/g) ?? [];
      expect(pages.length).toBe(1);
    });
  });

  test.describe('chrome on ios', () => {
    test.use({ userAgent: IOS_CHROME_UA });

    test('the app sends the user to the share sheet instead of printing', async ({
      page,
    }) => {
      await registerAndLogin(page, `e2e-print-ios-${Date.now()}`);
      await seedInvoice(page);
      await openPrintableInvoice(page);

      // chrome on iOS ignores window.print(), so the app must not wait
      // for a print screen that will never come
      await expect(
        page.getByText('Chrome on iPhone cannot print from this page'),
      ).toBeVisible();

      await page.getByRole('button', { name: 'Print', exact: true }).click();
      await expect(page.getByText('Print from the browser menu')).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByText('In the print preview, tap Share again'),
      ).toBeVisible();
    });
  });
});
