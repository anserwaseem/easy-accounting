import { test, expect } from 'playwright-soak-test';
import type { Page } from '@playwright/test';

const PASSWORD = 'e2e-soak-password';
const SPLIT_ITEM_COUNT = 150;

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

interface SplitSeededData {
  baseAccountId: number;
  accountTId: number;
  accountTTId: number;
  typeTId: number;
  typeTTId: number;
  sourceInvoiceId: number;
  totalAmountT: number;
  totalAmountTT: number;
  grandTotal: number;
}

async function seedSplitByItemTypeData(page: Page): Promise<SplitSeededData> {
  return page.evaluate(async (count) => {
    // 1. Create base ledger accounts
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

    // 2. Insert item types: 'T' and 'TT'
    await window.easyAccounting.api.insertItemType('T');
    await window.easyAccounting.api.insertItemType('TT');

    const itemTypes =
      (await window.easyAccounting.api.getItemTypes()) as Array<{
        id: number;
        name: string;
      }>;
    const typeT = itemTypes.find((it) => it.name === 'T');
    const typeTT = itemTypes.find((it) => it.name === 'TT');
    if (!typeT || !typeTT)
      throw new Error('Failed to create item types T and TT');

    // 3. Create Discount Profile with policy: T -> 10%, TT -> 20%
    await window.easyAccounting.api.insertDiscountProfile('Wholesale Tier');
    const profiles =
      (await window.easyAccounting.api.getDiscountProfiles()) as Array<{
        id: number;
        name: string;
      }>;
    const profile = profiles.find((p) => p.name === 'Wholesale Tier');
    if (!profile) throw new Error('Failed to create discount profile');

    await window.easyAccounting.api.saveDiscountProfileTypeDiscounts(
      profile.id,
      [
        { itemTypeId: typeT.id, discountPercent: 10 },
        { itemTypeId: typeTT.id, discountPercent: 20 },
      ],
    );

    // 4. Create base customer and suffixed accounts
    // Base account: Wholesale Central (code WC)
    await window.easyAccounting.api.insertAccount({
      name: 'Wholesale Central',
      code: 'WC',
      headName: 'Current Asset',
      type: 'Asset',
      discountProfileId: profile.id,
    });
    // Suffixed account 1: Wholesale Central-T (code WC-T)
    await window.easyAccounting.api.insertAccount({
      name: 'Wholesale Central-T',
      code: 'WC-T',
      headName: 'Current Asset',
      type: 'Asset',
      discountProfileId: profile.id,
    });
    // Suffixed account 2: Wholesale Central-TT (code WC-TT)
    await window.easyAccounting.api.insertAccount({
      name: 'Wholesale Central-TT',
      code: 'WC-TT',
      headName: 'Current Asset',
      type: 'Asset',
      discountProfileId: profile.id,
    });

    const accounts = (await window.easyAccounting.api.getAccounts()) as Array<{
      id: number;
      name: string;
      code?: string;
    }>;
    const baseAccount = accounts.find((a) => a.name === 'Wholesale Central');
    const accountT = accounts.find((a) => a.name === 'Wholesale Central-T');
    const accountTT = accounts.find((a) => a.name === 'Wholesale Central-TT');

    if (!baseAccount || !accountT || !accountTT) {
      throw new Error('Failed to create customer family accounts');
    }

    // 5. Create 150 inventory items (75 of type T, 75 of type TT)
    const halfCount = Math.floor(count / 2);
    for (let i = 1; i <= halfCount; i++) {
      await window.easyAccounting.api.insertInventoryItem({
        name: `SKU-T-${String(i).padStart(3, '0')}`,
        price: 100,
        itemTypeId: typeT.id,
      });
    }
    for (let i = 1; i <= halfCount; i++) {
      await window.easyAccounting.api.insertInventoryItem({
        name: `SKU-TT-${String(i).padStart(3, '0')}`,
        price: 200,
        itemTypeId: typeTT.id,
      });
    }

    const inventory =
      (await window.easyAccounting.api.getInventory()) as Array<{
        id: number;
        name: string;
        price: number;
        itemTypeId: number;
      }>;

    const tItems = inventory
      .filter((item) => item.name.startsWith('SKU-T-'))
      .sort((a, b) => a.name.localeCompare(b.name));
    const ttItems = inventory
      .filter((item) => item.name.startsWith('SKU-TT-'))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (tItems.length < halfCount || ttItems.length < halfCount) {
      throw new Error('Inventory items seeding incomplete');
    }

    // Adjust stock so we have ample inventory
    for (const item of [...tItems, ...ttItems]) {
      await window.easyAccounting.api.applyStockAdjustment({
        inventoryId: item.id,
        quantityDelta: 1000,
        reason: 'split soak stock',
      });
    }

    // 6. Build invoice items
    let totalAmountT = 0;
    let totalAmountTT = 0;
    const invoiceItems: Array<{
      id: number;
      inventoryId: number;
      quantity: number;
      price: number;
      discount: number;
      discountedPrice: number;
    }> = [];
    const multipleAccountIds: number[] = [];

    // First half: T items (10% discount, accountT)
    for (let i = 0; i < halfCount; i++) {
      const item = tItems[i];
      const qty = (i % 5) + 1; // 1 to 5
      const price = item.price; // 100
      const discount = 10;
      const discountedPrice = qty * price * (1 - discount / 100);
      totalAmountT += discountedPrice;
      invoiceItems.push({
        id: invoiceItems.length + 1,
        inventoryId: item.id,
        quantity: qty,
        price,
        discount,
        discountedPrice,
      });
      multipleAccountIds.push(accountT.id);
    }

    // Second half: TT items (20% discount, accountTT)
    for (let i = 0; i < halfCount; i++) {
      const item = ttItems[i];
      const qty = (i % 5) + 1; // 1 to 5
      const price = item.price; // 200
      const discount = 20;
      const discountedPrice = qty * price * (1 - discount / 100);
      totalAmountTT += discountedPrice;
      invoiceItems.push({
        id: invoiceItems.length + 1,
        inventoryId: item.id,
        quantity: qty,
        price,
        discount,
        discountedPrice,
      });
      multipleAccountIds.push(accountTT.id);
    }

    const grandTotal = totalAmountT + totalAmountTT;

    // 7. Insert the source invoice
    const { invoiceId } = await window.easyAccounting.api.insertInvoice(
      'Sale',
      {
        invoiceNumber: 8001,
        date: new Date().toISOString(),
        totalAmount: grandTotal,
        useSingleAccount: true,
        accountMapping: {
          singleAccountId: baseAccount.id,
          multipleAccountIds,
        },
        invoiceItems,
      },
    );

    return {
      baseAccountId: baseAccount.id,
      accountTId: accountT.id,
      accountTTId: accountTT.id,
      typeTId: typeT.id,
      typeTTId: typeTT.id,
      sourceInvoiceId: invoiceId,
      totalAmountT,
      totalAmountTT,
      grandTotal,
    };
  }, SPLIT_ITEM_COUNT);
}

test.describe('Split-By-Item-Type Wholesale Stress & Soak Tests', () => {
  test.use({
    soakOptions: {
      clock: false,
    },
  });

  test('150-item Split-By-Item-Type Wholesale Invoice handles dual-account resolution, virtualized account column, and split journal persistence', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const username = `split-whs-${Date.now()}`;
    await registerAndLogin(page, username);

    const seeded = await seedSplitByItemTypeData(page);
    expect(seeded.sourceInvoiceId).toBeGreaterThan(0);

    // Navigate to Sale Invoices list
    await page
      .getByRole('link', { name: 'Sale Invoices', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Sale Invoices' }),
    ).toBeVisible();

    // Duplicate source invoice to open New Sale Invoice populated with 150 split items
    const duplicateButton = page.getByRole('button', {
      name: 'Duplicate invoice',
    });
    await expect(duplicateButton).toBeVisible();
    await duplicateButton.click();

    // Verify New Sale Invoice page is loaded
    await expect(
      page.getByRole('heading', { name: 'New Sale Invoice' }),
    ).toBeVisible({ timeout: 20_000 });

    // Verify base customer is selected
    await expect(page.getByText('Wholesale Central').first()).toBeVisible({
      timeout: 10_000,
    });

    // Verify Split ledger by item type checkbox is checked
    const splitCheckbox = page.locator('#splitByItemType');
    await expect(splitCheckbox).toBeVisible();
    await expect(splitCheckbox).toBeChecked();

    // Verify "Account" column header exists
    await expect(page.locator('thead').getByText('Account')).toBeVisible();

    // Verify TableVirtuoso is virtualizing (small subset rendered in DOM)
    const renderedRows = page.locator('tbody tr[data-index]');
    await expect(renderedRows.first()).toBeVisible();
    const domRowCount = await renderedRows.count();
    expect(domRowCount).toBeLessThan(40);
    expect(domRowCount).toBeGreaterThanOrEqual(5);

    // Verify top rows show Wholesale Central-T with WC-T badge
    const firstRow = page.locator('tbody tr[data-index="0"]');
    await expect(firstRow).toBeVisible();
    await expect(firstRow.getByText('Wholesale Central-T')).toBeVisible();
    await expect(firstRow.getByText('WC-T')).toBeVisible();

    // Find the virtual scroller container
    const scroller = page.locator('[data-virtuoso-scroller="true"]');
    await expect(scroller).toBeVisible();

    // Scroll down to the bottom (where TT items live)
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);

    // Verify bottom row renders Wholesale Central-TT with WC-TT badge
    const lastRow = page.locator('tbody tr[data-index="149"]');
    await expect(lastRow).toBeVisible();
    await expect(lastRow.getByText('Wholesale Central-TT')).toBeVisible();
    await expect(lastRow.getByText('WC-TT')).toBeVisible();

    // Scroll back to top
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    await expect(page.getByText('SKU-T-001')).toBeVisible();

    // Save the 150-item split invoice
    const saveButton = page.getByRole('button', { name: 'Save', exact: true });
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // If "Item with no discount" dialog appears, accept
    const saveAnywayButton = page.getByRole('button', {
      name: 'Save anyway',
    });
    if (
      await saveAnywayButton.isVisible({ timeout: 2000 }).catch(() => false)
    ) {
      await saveAnywayButton.click();
    }

    // Confirm date dialog
    const confirmDateButton = page.getByRole('button', {
      name: 'Use current date',
    });
    await expect(confirmDateButton).toBeVisible({ timeout: 10_000 });
    await confirmDateButton.click();

    // Verify successful save and navigation to Invoice Details
    await expect(
      page.getByRole('heading', { name: /SALE INVOICE/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Verify in backend: 2 split journals were posted
    const validation = await page.evaluate(
      async ({ tId, ttId, expectedT, expectedTT }) => {
        const invoices = (await window.easyAccounting.api.getInvoices(
          'Sale',
        )) as Array<{
          id: number;
          invoiceNumber: number;
          totalAmount: number;
        }>;
        const newInv = invoices.find((inv) => inv.invoiceNumber !== 8001);
        if (!newInv) throw new Error('New duplicated invoice not found in DB');

        const journals =
          (await window.easyAccounting.api.getJournals()) as Array<{
            id: number;
            narration: string;
            amount: number;
          }>;

        const invJournals = journals.filter(
          (j) => j.narration?.includes(`Sale Invoice #${newInv.invoiceNumber}`),
        );
        const expectedParticulars = new Set(
          invJournals.map((j) => `Journal #${j.id}`),
        );

        // Verify ledgers for both suffixed accounts
        const ledgerT = (await window.easyAccounting.api.getLedger(
          tId,
        )) as Array<{
          id: number;
          particulars: string;
          debit: number;
          credit: number;
        }>;
        const ledgerTT = (await window.easyAccounting.api.getLedger(
          ttId,
        )) as Array<{
          id: number;
          particulars: string;
          debit: number;
          credit: number;
        }>;

        const tEntries = ledgerT.filter((l) =>
          expectedParticulars.has(l.particulars),
        );
        const ttEntries = ledgerTT.filter((l) =>
          expectedParticulars.has(l.particulars),
        );

        return {
          invoiceId: newInv.id,
          invoiceNumber: newInv.invoiceNumber,
          journalCount: invJournals.length,
          tEntryCount: tEntries.length,
          ttEntryCount: ttEntries.length,
          tDebit: tEntries.reduce((s, e) => s + (e.debit || 0), 0),
          ttDebit: ttEntries.reduce((s, e) => s + (e.debit || 0), 0),
          expectedT,
          expectedTT,
        };
      },
      {
        tId: seeded.accountTId,
        ttId: seeded.accountTTId,
        expectedT: seeded.totalAmountT,
        expectedTT: seeded.totalAmountTT,
      },
    );

    expect(validation.journalCount).toBe(2);
    expect(validation.tEntryCount).toBe(1);
    expect(validation.ttEntryCount).toBe(1);
    expect(Math.round(validation.tDebit)).toBe(Math.round(seeded.totalAmountT));
    expect(Math.round(validation.ttDebit)).toBe(
      Math.round(seeded.totalAmountTT),
    );
  });

  test('interactive inline item additions dynamically resolve suffixed accounts and apply tier discount policies', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const username = `split-interactive-${Date.now()}`;
    await registerAndLogin(page, username);

    const seeded = await seedSplitByItemTypeData(page);

    // Navigate to New Sale Invoice
    await page.locator('a[href="/sale/invoices/new"]').click();
    await expect(
      page.getByRole('heading', { name: 'New Sale Invoice' }),
    ).toBeVisible({ timeout: 15_000 });

    // Verify Split ledger by item type checkbox is checked by default
    const splitCheckbox = page.locator('#splitByItemType');
    await expect(splitCheckbox).toBeVisible();
    await expect(splitCheckbox).toBeChecked();

    // Select customer: Wholesale Central
    const partyInput = page.locator('input[placeholder="Select a party"]');
    await expect(partyInput).toBeVisible({ timeout: 10_000 });
    await partyInput.fill('Wholesale Central');
    const partyOption = page
      .locator('[role="option"]')
      .filter({ hasText: 'Wholesale Central' })
      .first();
    await expect(partyOption).toBeVisible({ timeout: 10_000 });
    await partyOption.click();

    // Verify Account column is now shown in headers
    await expect(page.locator('thead').getByText('Account')).toBeVisible();

    // Click Add New Item
    const addNewItemBtn = page.getByRole('button', { name: 'Add New Item' });
    await addNewItemBtn.click();

    // 1. Select a T item (SKU-T-001)
    const firstItemInput = page
      .locator('input[placeholder="Select item"]')
      .first();
    await expect(firstItemInput).toBeVisible();
    await firstItemInput.fill('SKU-T-001');

    const optionT = page
      .locator('[role="option"]')
      .filter({ hasText: 'SKU-T-001' })
      .first();
    await expect(optionT).toBeVisible({ timeout: 10_000 });
    await optionT.click();

    // Verify Account resolves to Wholesale Central-T (WC-T)
    const row0 = page.locator('tbody tr[data-index="0"]');
    await expect(row0.getByText('Wholesale Central-T')).toBeVisible({
      timeout: 10_000,
    });
    await expect(row0.getByText('WC-T')).toBeVisible();

    // Verify Discount field automatically displays 10%
    await expect(row0.getByText('10%')).toBeVisible({ timeout: 5000 });

    // Fill quantity 4
    const qtyInput0 = row0.locator('input[type="number"]');
    await qtyInput0.fill('4');
    await qtyInput0.blur();

    // 2. Add next row and select a TT item (SKU-TT-001)
    await addNewItemBtn.click();
    const secondItemInput = page
      .locator('input[placeholder="Select item"]')
      .first();
    await expect(secondItemInput).toBeVisible({ timeout: 10_000 });
    await secondItemInput.fill('SKU-TT-001');

    const optionTT = page
      .locator('[role="option"]')
      .filter({ hasText: 'SKU-TT-001' })
      .first();
    await expect(optionTT).toBeVisible({ timeout: 10_000 });
    await optionTT.click();

    // Verify second row Account resolves to Wholesale Central-TT (WC-TT)
    const row1 = page.locator('tbody tr[data-index="1"]');
    await expect(row1.getByText('Wholesale Central-TT')).toBeVisible({
      timeout: 10_000,
    });
    await expect(row1.getByText('WC-TT')).toBeVisible();

    // Verify Discount field automatically displays 20%
    await expect(row1.getByText('20%')).toBeVisible({ timeout: 5000 });

    // Fill quantity 5
    const qtyInput1 = row1.locator('input[type="number"]');
    await qtyInput1.fill('5');
    await qtyInput1.blur();

    // Save the invoice
    const saveBtn = page.getByRole('button', { name: 'Save', exact: true });
    await saveBtn.click();

    const confirmDate = page.getByRole('button', { name: 'Use current date' });
    await expect(confirmDate).toBeVisible({ timeout: 10_000 });
    await confirmDate.click();

    // Wait for invoice details
    await expect(
      page.getByRole('heading', { name: /SALE INVOICE/i }),
    ).toBeVisible({ timeout: 20_000 });

    // Validate ledger entries in backend:
    // T line: qty 4 * 100 * 0.9 = 360 to accountT
    // TT line: qty 5 * 200 * 0.8 = 800 to accountTT
    const result = await page.evaluate(
      async ({ tId, ttId }) => {
        const ledgerT = (await window.easyAccounting.api.getLedger(
          tId,
        )) as Array<{
          debit: number;
        }>;
        const ledgerTT = (await window.easyAccounting.api.getLedger(
          ttId,
        )) as Array<{
          debit: number;
        }>;
        return {
          totalT: ledgerT.reduce((s, e) => s + (e.debit || 0), 0),
          totalTT: ledgerTT.reduce((s, e) => s + (e.debit || 0), 0),
        };
      },
      { tId: seeded.accountTId, ttId: seeded.accountTTId },
    );

    // Initial seed had totalAmountT and totalAmountTT; this new invoice adds 360 and 800
    expect(result.totalT).toBe(seeded.totalAmountT + 360);
    expect(result.totalTT).toBe(seeded.totalAmountTT + 800);
  });
});
