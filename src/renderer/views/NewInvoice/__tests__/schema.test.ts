import type { InventoryItem } from 'types';
import { InvoiceType } from 'types';
import { buildNewInvoiceFormSchema, getDefaultFormValues } from '../schema';

const inv = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: overrides.id ?? 1,
  name: overrides.name ?? 'Item',
  price: overrides.price ?? 100,
  quantity: overrides.quantity ?? 5,
  description: overrides.description,
  itemTypeId: overrides.itemTypeId ?? null,
  itemTypeName: overrides.itemTypeName ?? null,
  createdAt: overrides.createdAt,
  updatedAt: overrides.updatedAt,
});

describe('NewInvoice schema', () => {
  it('rejects duplicate inventory items', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 10 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const result = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 10,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
        {
          id: 2,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) =>
        i.message.includes('only be added once'),
      ),
    ).toBe(true);
  });

  it('sale: rejects quantity > stock', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 2 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const result = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 10,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 3,
          discount: 0,
          price: 100,
          discountedPrice: 300,
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) => i.message.includes('Max 2 available')),
    ).toBe(true);
  });

  it('purchase: does not enforce stock cap', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Purchase,
      inventory: [inv({ id: 10, quantity: 2 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const result = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 0,
      invoiceType: InvoiceType.Purchase,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 999,
          discount: 0,
          price: 0,
          discountedPrice: 0,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('single account: requires singleAccountId when not split-by-type', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 10 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const result = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 10,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: -1, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some(
        (i) =>
          i.path.join('.') === 'accountMapping.singleAccountId' &&
          i.message.toLowerCase().includes('select'),
      ),
    ).toBe(true);
  });

  it('sale split-by-type: requires multipleAccountIds aligned to rows', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 10 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => true,
    });

    const result = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 10,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some(
        (i) => i.path.join('.') === 'accountMapping.multipleAccountIds',
      ),
    ).toBe(true);
  });

  it('sections mode: requires a customer per invoice item via multipleAccountIds', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 10 })],
      getUseSingleAccount: () => false,
      getSplitByItemType: () => false,
    });

    const result = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 10,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: undefined, multipleAccountIds: [0] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some(
        (i) =>
          i.path.join('.') === 'accountMapping.multipleAccountIds.0' &&
          i.message.toLowerCase().includes('select'),
      ),
    ).toBe(true);
  });

  it('extraDiscount: requires extraDiscountAccountId and it must be one of invoice accounts', () => {
    const base = {
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      totalAmount: 10,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
      ],
    };

    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 10 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const missing = schema.safeParse({
      ...base,
      extraDiscount: 5,
      extraDiscountAccountId: undefined,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
    });
    expect(missing.success).toBe(false);
    expect(
      missing.error?.issues.some(
        (i) => i.path.join('.') === 'extraDiscountAccountId',
      ),
    ).toBe(true);

    const notInInvoice = schema.safeParse({
      ...base,
      extraDiscount: 5,
      extraDiscountAccountId: 999,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
    });
    expect(notInInvoice.success).toBe(false);
    expect(
      notInInvoice.error?.issues.some((i) =>
        i.message.includes('must be one of the invoice accounts'),
      ),
    ).toBe(true);

    const ok = schema.safeParse({
      ...base,
      extraDiscount: 5,
      extraDiscountAccountId: 123,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
    });
    expect(ok.success).toBe(true);
  });

  it('rejects unparseable date', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 10 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const result = schema.safeParse({
      id: -1,
      date: 'not-a-real-date',
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 10,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) => i.message.includes('valid date')),
    ).toBe(true);
  });

  it('rejects bilty number with non-digits but allows blank', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 10 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const bad = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 10,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '12a',
      cartons: 0,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
      ],
    });
    expect(bad.success).toBe(false);
    expect(
      bad.error?.issues.some((i) => i.message.includes('digits only')),
    ).toBe(true);

    const ok = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 10,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '  ',
      cartons: 0,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it('sale: total amount must be positive', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 10 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const result = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 0,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) =>
        i.message.toLowerCase().includes('total amount'),
      ),
    ).toBe(true);
  });

  it('sale: discount must have at most two decimal places', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 10 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const result = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 10,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 12.345,
          price: 100,
          discountedPrice: 87.655,
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) =>
        i.message.toLowerCase().includes('decimal'),
      ),
    ).toBe(true);
  });

  it('extraDiscount 0 does not require extraDiscountAccountId', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 10 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
    });

    const result = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 10,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('sale: split-by-type accepts when multipleAccountIds aligns with each line', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 10 }), inv({ id: 11, quantity: 10 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => true,
    });

    const result = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 10,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: 1, multipleAccountIds: [10, 20] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
        {
          id: 2,
          inventoryId: 11,
          quantity: 1,
          discount: 0,
          price: 50,
          discountedPrice: 50,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('purchase: multi-account mode requires a vendor id per line', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Purchase,
      inventory: [inv({ id: 10, quantity: 10 })],
      getUseSingleAccount: () => false,
      getSplitByItemType: () => false,
    });

    const result = schema.safeParse({
      id: -1,
      date: new Date().toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 0,
      invoiceType: InvoiceType.Purchase,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: undefined, multipleAccountIds: [0] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 0,
          discountedPrice: 0,
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some(
        (i) =>
          i.path.join('.') === 'accountMapping.multipleAccountIds.0' &&
          i.message.toLowerCase().includes('select'),
      ),
    ).toBe(true);
  });

  it('quotation flow: allows negative placeholder invoice numbers', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 100 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
      getIsQuotationFlow: () => true,
    });

    const result = schema.safeParse({
      id: 5,
      date: new Date().toISOString(),
      invoiceNumber: -42,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 100,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('non-quotation flow: rejects negative invoice numbers', () => {
    const schema = buildNewInvoiceFormSchema({
      invoiceType: InvoiceType.Sale,
      inventory: [inv({ id: 10, quantity: 100 })],
      getUseSingleAccount: () => true,
      getSplitByItemType: () => false,
      getIsQuotationFlow: () => false,
    });

    const result = schema.safeParse({
      id: 5,
      date: new Date().toISOString(),
      invoiceNumber: -42,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 100,
      invoiceType: InvoiceType.Sale,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: 123, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: 10,
          quantity: 1,
          discount: 0,
          price: 100,
          discountedPrice: 100,
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe('getDefaultFormValues', () => {
  it('returns sale-shaped defaults with empty items and unset account ids', () => {
    const v = getDefaultFormValues(InvoiceType.Sale);
    expect(v.invoiceType).toBe(InvoiceType.Sale);
    expect(v.invoiceItems).toEqual([]);
    expect(v.accountMapping.singleAccountId).toBe(-1);
    expect(v.accountMapping.multipleAccountIds).toEqual([]);
    expect(v.extraDiscount).toBe(0);
    expect(v.extraDiscountAccountId).toBeUndefined();
  });
});
