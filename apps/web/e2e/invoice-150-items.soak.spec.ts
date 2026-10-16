import { test, expect } from 'playwright-soak-test';
import type { Page } from '@playwright/test';

const PASSWORD = 'e2e-soak-password';
const ITEM_COUNT = 150;

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

interface SeededData {
  invoiceId: number;
  totalAmount: number;
  expectedItemCount: number;
}

async function seedAccountsAndInventory(
  page: Page,
): Promise<{ customerId: number }> {
  return page.evaluate(async (count) => {
    // 1. Create required accounts
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
    await window.easyAccounting.api.insertAccount({
      name: 'Bulk Customer Test',
      headName: 'Current Asset',
      type: 'Asset',
    });

    const accounts = (await window.easyAccounting.api.getAccounts()) as {
      id: number;
      name: string;
    }[];
    const customer = accounts.find((a) => a.name === 'Bulk Customer Test');
    if (!customer) throw new Error('Customer not created');

    // 2. Insert 150 inventory items with stock
    for (let i = 1; i <= count; i++) {
      await window.easyAccounting.api.insertInventoryItem({
        name: `Item ${String(i).padStart(3, '0')}`,
        price: 10 + (i % 50),
      });
    }

    const inventory = (await window.easyAccounting.api.getInventory()) as {
      id: number;
      name: string;
      price: number;
    }[];
    const bulkItems = inventory
      .filter((i) => i.name.startsWith('Item '))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (bulkItems.length < count) {
      throw new Error(
        `Expected at least ${count} items, got ${bulkItems.length}`,
      );
    }

    // Apply stock adjustments so every item has sufficient stock
    for (const item of bulkItems) {
      await window.easyAccounting.api.applyStockAdjustment({
        inventoryId: item.id,
        quantityDelta: 1000,
        reason: 'initial soak stock',
      });
    }

    return { customerId: customer.id };
  }, ITEM_COUNT);
}

async function seed150ItemInvoice(page: Page): Promise<SeededData> {
  const { customerId } = await seedAccountsAndInventory(page);
  return page.evaluate(
    async ({ count, customerId: cId }) => {
      const inventory = (await window.easyAccounting.api.getInventory()) as {
        id: number;
        name: string;
        price: number;
      }[];
      const bulkItems = inventory
        .filter((i) => i.name.startsWith('Item '))
        .sort((a, b) => a.name.localeCompare(b.name));

      // 3. Build invoice items with random quantity > 0 (1 to 20)
      let totalAmount = 0;
      const invoiceItems = bulkItems.slice(0, count).map((item, index) => {
        const qty = ((index * 7 + 13) % 20) + 1; // 1 to 20
        const lineTotal = qty * item.price;
        totalAmount += lineTotal;
        return {
          id: index + 1,
          inventoryId: item.id,
          quantity: qty,
          price: item.price,
          discount: 0,
          discountedPrice: lineTotal,
        };
      });

      // 4. Insert source invoice
      const { invoiceId } = await window.easyAccounting.api.insertInvoice(
        'Sale',
        {
          invoiceNumber: 5001,
          date: new Date().toISOString(),
          totalAmount,
          useSingleAccount: true,
          accountMapping: {
            singleAccountId: cId,
          },
          invoiceItems,
        },
      );

      return {
        invoiceId,
        totalAmount,
        expectedItemCount: count,
      };
    },
    { count: ITEM_COUNT, customerId },
  );
}

test.describe('150-Item Sale Invoice Virtualization & Pressure Tests', () => {
  test.use({
    soakOptions: {
      clock: false,
    },
  });

  test('New Sale Invoice renders 150 items with virtualization and handles scrolling and submission', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const username = `bulk-inv-${Date.now()}`;
    await registerAndLogin(page, username);

    const { invoiceId } = await seed150ItemInvoice(page);
    expect(invoiceId).toBeGreaterThan(0);

    // Navigate to Sale Invoices list
    await page
      .getByRole('link', { name: 'Sale Invoices', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Sale Invoices' }),
    ).toBeVisible();

    // Click duplicate button to open a new sale invoice populated with all 150 items
    const duplicateButton = page.getByRole('button', {
      name: 'Duplicate invoice',
    });
    await expect(duplicateButton).toBeVisible();
    await duplicateButton.click();

    // Verify New Sale Invoice page is loaded
    await expect(
      page.getByRole('heading', { name: 'New Sale Invoice' }),
    ).toBeVisible({ timeout: 15_000 });

    // Verify customer is selected
    await expect(page.getByText('Bulk Customer Test').first()).toBeVisible();

    // Verify TableVirtuoso is virtualizing the 150 rows:
    // In a virtualized table, only a small window of DOM rows (< 50 rows) are rendered, NOT all 150!
    const renderedRows = page.locator('tbody tr[data-index]');
    await expect(renderedRows.first()).toBeVisible();
    const initialDomRowCount = await renderedRows.count();
    expect(initialDomRowCount).toBeLessThan(50);
    expect(initialDomRowCount).toBeGreaterThanOrEqual(5);

    // Verify first item is visible
    await expect(page.getByText('Item 001')).toBeVisible();

    // Find the virtual scroller container
    const scroller = page.locator('[data-virtuoso-scroller="true"]');
    await expect(scroller).toBeVisible();

    // Scroll down to the middle/bottom of the 150-item list
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);

    // Verify that bottom item (Item 150) is now mounted in the DOM
    await expect(page.getByText('Item 150')).toBeVisible();

    // Verify that top item (Item 001) has been unmounted from the DOM
    await expect(page.getByText('Item 001')).not.toBeVisible();

    // Scroll back to top
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    await expect(page.getByText('Item 001')).toBeVisible();

    // Submit the new sale invoice with 150 items
    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // If "Item with no discount" dialog appears, confirm saving anyway
    const saveAnywayButton = page.getByRole('button', {
      name: 'Save anyway',
    });
    if (
      await saveAnywayButton.isVisible({ timeout: 5000 }).catch(() => false)
    ) {
      await saveAnywayButton.click();
    }

    // Confirm date dialog appears because date is not explicitly set
    const confirmDateButton = page.getByRole('button', {
      name: 'Use current date',
    });
    await expect(confirmDateButton).toBeVisible({ timeout: 10_000 });
    await confirmDateButton.click();

    // Verify successful save and navigation to Invoice Details
    await expect(
      page.getByRole('heading', { name: /SALE INVOICE/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Verify customer is displayed
    await expect(page.getByText('Bulk Customer Test').first()).toBeVisible();
  });

  test('New Sale Invoice: enter 150 items one by one with random qty > 0 under 6x CPU slowdown', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const username = `bulk-slow-${Date.now()}`;
    await registerAndLogin(page, username);

    await seedAccountsAndInventory(page);

    // Apply 6x CPU slowdown via Chrome DevTools Protocol
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });

    // Navigate to New Sale Invoice via sidebar router link
    await page.locator('a[href="/sale/invoices/new"]').click();
    await expect(
      page.getByRole('heading', { name: 'New Sale Invoice' }),
    ).toBeVisible({ timeout: 20_000 });

    // Select customer: Bulk Customer Test
    const partyInput = page.locator('input[placeholder="Select a party"]');
    await expect(partyInput).toBeVisible({ timeout: 10_000 });
    await partyInput.fill('Bulk Customer Test');
    const partyOption = page
      .locator('[role="option"]')
      .filter({ hasText: 'Bulk Customer Test' })
      .first();
    await expect(partyOption).toBeVisible({ timeout: 10_000 });
    await partyOption.click();
    await expect(page.getByText('Bulk Customer Test').first()).toBeVisible();

    // Start adding 150 items one by one
    const addNewItemBtn = page.getByRole('button', { name: 'Add New Item' });
    await addNewItemBtn.click();

    const startTotal = Date.now();
    let lastBatchTime = Date.now();
    const milestones: Array<{
      itemIndex: number;
      elapsedMs: number;
      rateMsPerItem: number;
      domRowCount: number;
    }> = [];

    for (let i = 0; i < ITEM_COUNT; i++) {
      const itemName = `Item ${String(i + 1).padStart(3, '0')}`;
      const qty = ((i * 7 + 13) % 20) + 1;

      // 1. Locate the item select input in the unselected row
      const itemInput = page
        .locator('input[placeholder="Select item"]')
        .first();
      await expect(itemInput).toBeVisible({ timeout: 15_000 });
      await itemInput.fill(itemName);

      // 2. Click matching option in the VirtualSelect dropdown
      const option = page
        .locator('[role="option"]')
        .filter({ hasText: itemName })
        .first();
      await expect(option).toBeVisible({ timeout: 15_000 });
      await option.click();

      // 3. Locate the quantity spinbutton for the active row and fill qty
      const lastRow = page.locator('tbody tr[data-index]').last();
      const qtyInput = lastRow.locator('input[type="number"]');
      await expect(qtyInput).toBeVisible({ timeout: 10_000 });
      await qtyInput.fill(String(qty));

      // 4. Press Enter in quantity to commit row and auto-append next row
      if (i < ITEM_COUNT - 1) {
        await qtyInput.press('Enter');
        // Fallback: if Enter didn't append the row within 800ms, click Add New Item
        const nextItemInput = page
          .locator('input[placeholder="Select item"]')
          .first();
        const hasNext = await nextItemInput
          .isVisible({ timeout: 800 })
          .catch(() => false);
        if (!hasNext) {
          await addNewItemBtn.click();
        }
      }

      // Track milestones at key intervals
      if ([1, 10, 25, 50, 75, 100, 125, 150].includes(i + 1)) {
        const now = Date.now();
        const batchCount = i === 0 ? 1 : i === 9 ? 9 : 25;
        const rateMsPerItem = (now - lastBatchTime) / batchCount;
        const domRowCount = await page.locator('tbody tr[data-index]').count();
        milestones.push({
          itemIndex: i + 1,
          elapsedMs: now - startTotal,
          rateMsPerItem: Math.round(rateMsPerItem),
          domRowCount,
        });
        lastBatchTime = now;
        // eslint-disable-next-line no-console
        console.log(
          `[6x CPU Pressure] Item ${i + 1}/${ITEM_COUNT}: elapsed=${
            now - startTotal
          }ms, rate=${Math.round(
            rateMsPerItem,
          )}ms/item, domRowsInView=${domRowCount}`,
        );
      }
    }

    // Verify virtualization kept the DOM compact even under 150 items
    const domRowCount = await page.locator('tbody tr[data-index]').count();
    expect(domRowCount).toBeLessThan(50);

    // Test scrolling under 6x CPU slowdown
    const scroller = page.locator('[data-virtuoso-scroller="true"]');
    await expect(scroller).toBeVisible();

    // Scroll to top
    const scrollUpStart = Date.now();
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(page.getByText('Item 001')).toBeVisible({ timeout: 15_000 });
    const scrollUpDuration = Date.now() - scrollUpStart;
    // eslint-disable-next-line no-console
    console.log(`[6x CPU Pressure] Scroll to top took ${scrollUpDuration}ms`);

    // Scroll to bottom
    const scrollDownStart = Date.now();
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.getByText('Item 150')).toBeVisible({ timeout: 15_000 });
    const scrollDownDuration = Date.now() - scrollDownStart;
    // eslint-disable-next-line no-console
    console.log(
      `[6x CPU Pressure] Scroll to bottom took ${scrollDownDuration}ms`,
    );

    // Save invoice with 150 items
    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Handle "Item with no discount" dialog if present
    const saveAnywayButton = page.getByRole('button', { name: 'Save anyway' });
    if (
      await saveAnywayButton.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      await saveAnywayButton.click();
    }

    // Handle "Confirm date" dialog if present
    const confirmDateButton = page.getByRole('button', {
      name: 'Use current date',
    });
    if (
      await confirmDateButton.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      await confirmDateButton.click();
    }

    // Verify successful save and navigation to Invoice Details
    await expect(
      page.getByRole('heading', { name: /SALE INVOICE/i }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('Bulk Customer Test').first()).toBeVisible();

    // Reset CPU throttling rate
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });
});
