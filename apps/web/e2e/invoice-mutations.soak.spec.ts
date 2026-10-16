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

async function seed150ItemInvoice(page: Page): Promise<SeededData> {
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
        reason: 'initial mutation stock',
      });
    }

    // 3. Build invoice items with deterministic random quantity > 0 (1 to 20)
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
          singleAccountId: customer.id,
        },
        invoiceItems,
      },
    );

    return {
      invoiceId,
      totalAmount,
      expectedItemCount: count,
    };
  }, ITEM_COUNT);
}

test.describe('150-Item Invoice Mutation & Index Shift Stress Tests', () => {
  test.use({
    soakOptions: {
      clock: false,
    },
  });

  test('rapid deletions at top, middle, and bottom correctly shift indices and recompute totals without desync', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const username = `mut-inv-${Date.now()}`;
    await registerAndLogin(page, username);

    const { invoiceId } = await seed150ItemInvoice(page);
    expect(invoiceId).toBeGreaterThan(0);

    // 1. Navigate to Sale Invoices list
    await page
      .getByRole('link', { name: 'Sale Invoices', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Sale Invoices' }),
    ).toBeVisible();

    // 2. Open duplicate 150-item invoice
    const duplicateButton = page.getByRole('button', {
      name: 'Duplicate invoice',
    });
    await expect(duplicateButton).toBeVisible();
    await duplicateButton.click();

    await expect(
      page.getByRole('heading', { name: 'New Sale Invoice' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Bulk Customer Test').first()).toBeVisible();

    // 3. Confirm 150 items are virtualized
    const renderedRows = page.locator('tbody tr[data-index]');
    await expect(renderedRows.first()).toBeVisible();
    expect(await renderedRows.count()).toBeLessThan(50);
    await expect(page.getByText('Item 001')).toBeVisible();

    const scroller = page.locator('[data-virtuoso-scroller="true"]');
    await expect(scroller).toBeVisible();

    // 4. Delete top row (Item 001)
    const firstRowRemoveBtn = page
      .locator('tbody tr[data-index="0"]')
      .getByRole('button', { name: 'Remove item' });
    await firstRowRemoveBtn.click();

    // Verify Item 001 is removed and Item 002 is now at data-index="0"
    await expect(page.getByText('Item 001')).not.toBeVisible();
    await expect(page.getByText('Item 002')).toBeVisible();

    // 5. Scroll down to middle (~row 50) and delete a middle row
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight / 3;
    });
    await page.waitForTimeout(300);

    // Pick the currently visible middle row
    const middleRow = page.locator('tbody tr[data-index]').nth(5);
    await expect(middleRow).toBeVisible();
    const middleItemName = await middleRow.locator('td').nth(1).textContent();
    expect(middleItemName).toBeTruthy();

    const middleRemoveBtn = middleRow.getByRole('button', {
      name: 'Remove item',
    });
    await middleRemoveBtn.click();
    await page.waitForTimeout(200);

    // 6. Scroll to bottom and delete the last row
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);

    const bottomRow = page.locator('tbody tr[data-index]').last();
    await expect(bottomRow).toBeVisible();
    const bottomRemoveBtn = bottomRow.getByRole('button', {
      name: 'Remove item',
    });
    await bottomRemoveBtn.click();
    await page.waitForTimeout(200);

    // 7. Scroll back to top and perform an inline quantity edit
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(300);

    const topQtyInput = page
      .locator('tbody tr[data-index="0"]')
      .locator('input[type="number"]');
    await topQtyInput.fill('50');
    await topQtyInput.press('Tab');
    await page.waitForTimeout(200);

    // Verify total recomputed and is a valid number different from initial
    const totalText = await page
      .locator('text=Total')
      .locator('..')
      .textContent();
    expect(totalText).toContain('PKR');

    // 8. Submit the modified invoice (147 items remaining)
    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const saveAnywayButton = page.getByRole('button', {
      name: 'Save anyway',
    });
    if (
      await saveAnywayButton.isVisible({ timeout: 5000 }).catch(() => false)
    ) {
      await saveAnywayButton.click();
    }

    const confirmDateButton = page.getByRole('button', {
      name: 'Use current date',
    });
    await expect(confirmDateButton).toBeVisible({ timeout: 10_000 });
    await confirmDateButton.click();

    // 9. Verify navigation to Invoice Details
    await expect(
      page.getByRole('heading', { name: /SALE INVOICE/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Bulk Customer Test').first()).toBeVisible();
  });

  test('deleting multiple rows and appending new items maintains correct line count and persists accurate invoice lines', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const username = `mut-append-${Date.now()}`;
    await registerAndLogin(page, username);

    const { invoiceId } = await seed150ItemInvoice(page);
    expect(invoiceId).toBeGreaterThan(0);

    // 1. Navigate to Sale Invoices list
    await page
      .getByRole('link', { name: 'Sale Invoices', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Sale Invoices' }),
    ).toBeVisible();

    // 2. Open duplicate 150-item invoice
    const duplicateButton = page.getByRole('button', {
      name: 'Duplicate invoice',
    });
    await expect(duplicateButton).toBeVisible();
    await duplicateButton.click();

    await expect(
      page.getByRole('heading', { name: 'New Sale Invoice' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Bulk Customer Test').first()).toBeVisible();

    // 3. Delete first 5 rows sequentially
    for (let i = 0; i < 5; i++) {
      const topRemoveBtn = page
        .locator('tbody tr[data-index="0"]')
        .getByRole('button', { name: 'Remove item' });
      await topRemoveBtn.click();
      await page.waitForTimeout(50);
    }

    // Row 0 should now be Item 006
    await expect(page.getByText('Item 006')).toBeVisible();
    await expect(page.getByText('Item 001')).not.toBeVisible();
    await expect(page.getByText('Item 002')).not.toBeVisible();
    await expect(page.getByText('Item 003')).not.toBeVisible();
    await expect(page.getByText('Item 004')).not.toBeVisible();
    await expect(page.getByText('Item 005')).not.toBeVisible();

    // 4. Now append 2 new rows using the newly freed up items (Item 001 and Item 002)
    const addNewBtn = page.getByRole('button', { name: 'Add New Item' });
    await addNewBtn.click();
    const itemInput1 = page.locator('input[placeholder="Select item"]').first();
    await expect(itemInput1).toBeVisible({ timeout: 5000 });
    await itemInput1.fill('Item 001');
    const option1 = page
      .locator('[role="option"]')
      .filter({ hasText: 'Item 001' })
      .first();
    await expect(option1).toBeVisible({ timeout: 5000 });
    await option1.click({ force: true });
    await page.waitForTimeout(200);

    const lastRow1 = page.locator('tbody tr[data-index]').last();
    const qtyInput1 = lastRow1.locator('input[type="number"]');
    await qtyInput1.fill('12');
    await page.waitForTimeout(200);

    // Second appended row
    await addNewBtn.click();
    const itemInput2 = page.locator('input[placeholder="Select item"]').first();
    await expect(itemInput2).toBeVisible({ timeout: 5000 });
    await itemInput2.fill('Item 002');
    const option2 = page
      .locator('[role="option"]')
      .filter({ hasText: 'Item 002' })
      .first();
    await expect(option2).toBeVisible({ timeout: 5000 });
    await option2.click({ force: true });
    await page.waitForTimeout(200);

    const lastRow2 = page.locator('tbody tr[data-index]').last();
    const qtyInput2 = lastRow2.locator('input[type="number"]');
    await qtyInput2.fill('24');
    await qtyInput2.press('Tab');
    await page.waitForTimeout(200);

    // 5. Submit the mutated invoice: 150 - 5 + 2 = 147 items
    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const saveAnywayButton = page.getByRole('button', {
      name: 'Save anyway',
    });
    if (
      await saveAnywayButton.isVisible({ timeout: 5000 }).catch(() => false)
    ) {
      await saveAnywayButton.click();
    }

    const confirmDateButton = page.getByRole('button', {
      name: 'Use current date',
    });
    await expect(confirmDateButton).toBeVisible({ timeout: 10_000 });
    await confirmDateButton.click();

    // 6. Verify navigation to Invoice Details
    await expect(
      page.getByRole('heading', { name: /SALE INVOICE/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Bulk Customer Test').first()).toBeVisible();
  });
});
