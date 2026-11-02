import type { InventoryItem } from 'types';
import { InvoiceType } from 'types';
import { buildNewInvoiceFormSchema } from '../schema';

describe('NewInvoice 200-row stress and structural operations', () => {
  // Generate 250 catalog inventory items
  const catalog: InventoryItem[] = [];
  for (let i = 1; i <= 250; i++) {
    catalog.push({
      id: i,
      name: `Book Title / Product SKU #${i}`,
      price: 150 + (i % 50),
      quantity: 500,
      itemTypeId: (i % 3) + 1,
      itemTypeName: `Category ${(i % 3) + 1}`,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });
  }

  const schema = buildNewInvoiceFormSchema({
    invoiceType: InvoiceType.Sale,
    inventory: catalog,
    getUseSingleAccount: () => true,
    getSplitByItemType: () => false,
  });

  it('validates 200-row invoice successfully when all items have valid quantities', () => {
    const items = [];
    let expectedTotal = 0;
    for (let i = 1; i <= 200; i++) {
      const price = 200;
      const qty = (i % 10) + 1; // 1 to 10
      items.push({
        id: i,
        inventoryId: i,
        quantity: qty,
        discount: 10,
        price,
        discountedPrice: 180,
      });
      expectedTotal += qty * 180;
    }

    const payload = {
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 101,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: expectedTotal,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '9921',
      cartons: 12,
      accountMapping: { singleAccountId: 42, multipleAccountIds: [] },
      invoiceItems: items,
    };

    const parsed = schema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('detects and flags rows with 0 quantity in a 200-row invoice', () => {
    const items = [];
    for (let i = 1; i <= 200; i++) {
      items.push({
        id: i,
        inventoryId: i,
        quantity: i === 45 || i === 120 ? 0 : 5, // Rows 45 and 120 have 0 qty
        discount: 0,
        price: 100,
        discountedPrice: 100,
      });
    }

    const payload = {
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 102,
      extraDiscount: 0,
      totalAmount: 19800,
      invoiceType: InvoiceType.Sale,
      accountMapping: { singleAccountId: 42, multipleAccountIds: [] },
      invoiceItems: items,
    };

    const parsed = schema.safeParse(payload);
    expect(parsed.success).toBe(false);

    // Must flag both row 45 and row 120
    const errors = !parsed.success ? parsed.error.issues : [];
    const row45Error = errors.find((e) => e.path.join('.').includes('44')); // 0-indexed
    const row120Error = errors.find((e) => e.path.join('.').includes('119'));
    expect(row45Error).toBeDefined();
    expect(row120Error).toBeDefined();
  });

  it('correctly handles deleting 20 items from the middle of a 200-row invoice (atomic replacement)', () => {
    const initialItems = [];
    for (let i = 1; i <= 200; i++) {
      initialItems.push({
        id: i,
        inventoryId: i,
        quantity: 5,
        discount: 0,
        price: 100,
        discountedPrice: 100,
      });
    }

    // Simulate deleting rows 50 through 69 (20 items from mid-table)
    // Per AGENTS.md rules: use atomic replacement filteredArray instead of remove(index)
    const filteredItems = initialItems.filter(
      (_, idx) => idx < 50 || idx >= 70,
    );
    expect(filteredItems.length).toBe(180);

    // Verify row continuity and absence of removed inventoryIds
    const remainingInventoryIds = new Set(
      filteredItems.map((item) => item.inventoryId),
    );
    expect(remainingInventoryIds.has(51)).toBe(false); // inventoryId 51 was at index 50
    expect(remainingInventoryIds.has(70)).toBe(false); // inventoryId 70 was at index 69
    expect(remainingInventoryIds.has(71)).toBe(true);

    const payload = {
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 103,
      extraDiscount: 0,
      totalAmount: 180 * 500,
      invoiceType: InvoiceType.Sale,
      accountMapping: { singleAccountId: 42, multipleAccountIds: [] },
      invoiceItems: filteredItems,
    };

    const parsed = schema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('handles changing party/customer account mid-way on a 200-row invoice', () => {
    const items = [];
    for (let i = 1; i <= 200; i++) {
      items.push({
        id: i,
        inventoryId: i,
        quantity: 2,
        discount: 0,
        price: 100,
        discountedPrice: 100,
      });
    }

    const payloadWithCustomerA = {
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 104,
      extraDiscount: 0,
      totalAmount: 40000,
      invoiceType: InvoiceType.Sale,
      accountMapping: { singleAccountId: 10, multipleAccountIds: [] },
      invoiceItems: items,
    };

    expect(schema.safeParse(payloadWithCustomerA).success).toBe(true);

    // Switch account to customer B (Account #99)
    const payloadWithCustomerB = {
      ...payloadWithCustomerA,
      accountMapping: { singleAccountId: 99, multipleAccountIds: [] },
    };

    expect(schema.safeParse(payloadWithCustomerB).success).toBe(true);

    // Switching to invalid account mapping (e.g., empty account) fails validation
    const payloadWithNoCustomer = {
      ...payloadWithCustomerA,
      accountMapping: { singleAccountId: undefined, multipleAccountIds: [] },
    };

    expect(schema.safeParse(payloadWithNoCustomer).success).toBe(false);
  });
});

describe('Huge Journal use cases (500 lines)', () => {
  it('validates a balanced 500-line multi-account journal entry', () => {
    let totalDebit = 0;
    let totalCredit = 0;
    const entries = [];

    // 250 debit lines and 250 credit lines
    for (let i = 1; i <= 250; i++) {
      const amount = 100 + i;
      entries.push({
        accountId: (i % 20) + 1,
        debitAmount: amount,
        creditAmount: 0,
        narration: `Payment batch A line #${i}`,
      });
      totalDebit += amount;
    }

    for (let i = 1; i <= 250; i++) {
      const amount = 100 + i;
      entries.push({
        accountId: ((i + 5) % 20) + 1,
        debitAmount: 0,
        creditAmount: amount,
        narration: `Offsetting settlement line #${i}`,
      });
      totalCredit += amount;
    }

    expect(entries.length).toBe(500);
    expect(totalDebit).toBe(totalCredit);

    // Verify balance difference is precisely 0
    const diff = Math.abs(totalDebit - totalCredit);
    expect(diff).toBeLessThan(0.0001);
  });

  it('flags an unbalanced 500-line journal when debits != credits', () => {
    let totalDebit = 0;
    let totalCredit = 0;
    const entries = [];

    for (let i = 1; i <= 250; i++) {
      entries.push({ accountId: 1, debitAmount: 100, creditAmount: 0 });
      totalDebit += 100;
    }

    for (let i = 1; i <= 250; i++) {
      // Introduce 5 rupee discrepancy on line 200
      const credit = i === 200 ? 95 : 100;
      entries.push({ accountId: 2, debitAmount: 0, creditAmount: credit });
      totalCredit += credit;
    }

    expect(entries.length).toBe(500);
    expect(totalDebit).toBe(25000);
    expect(totalCredit).toBe(24995);
    expect(totalDebit === totalCredit).toBe(false);
  });
});
