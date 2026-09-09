import Database from 'better-sqlite3';
import { omit } from 'lodash';
import type { Invoice, InvoiceItem, InvoiceType } from 'types';
import { AccountService } from '../AccountService';
import { PricingService } from '../PricingService';
import { LedgerService } from '../LedgerService';
import { JournalService } from '../JournalService';
import { InvoiceService } from '../InvoiceService';
import { VendorStockService } from '../VendorStockService';
import type { SessionContext } from '../../ports';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { AccountService as MainAccountService } from '../../../main/services/Account.service';
import { PricingService as MainPricingService } from '../../../main/services/Pricing.service';
import { LedgerService as MainLedgerService } from '../../../main/services/Ledger.service';
import { JournalService as MainJournalService } from '../../../main/services/Journal.service';
import { InvoiceService as MainInvoiceService } from '../../../main/services/Invoice.service';
import { applyFrozenWebSchema } from '../../../../scripts/generate-schema-snapshot';

jest.mock('electron-log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  verbose: jest.fn(),
  debug: jest.fn(),
  silly: jest.fn(),
  transports: {
    file: { level: 'debug', getFile: jest.fn() },
    console: { level: 'debug' },
  },
}));

jest.mock('../../../main/store', () => ({
  store: {
    get: jest.fn(() => 'testuser'),
    set: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('electron', () => ({ app: { isPackaged: false } }));

const USERNAME = 'testuser';
const session: SessionContext = { getUsername: () => USERNAME };

const DISCOUNT_ACCOUNT_NAME = 'Discount';

const defaultAccountFields = {
  code: null,
  address: null,
  phone1: null,
  phone2: null,
  goodsName: null,
  isActive: true,
  discountProfileId: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function seedBasicSchema(db: Database.Database) {
  applyFrozenWebSchema(db);
  db.prepare(
    `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
  ).run(USERNAME, Buffer.from('x'));
  const userId = (
    db.prepare(`SELECT id FROM users WHERE username = ?`).get(USERNAME) as {
      id: number;
    }
  ).id;
  db.prepare(
    `INSERT INTO chart (date, name, type, userId) VALUES (?, ?, ?, ?)`,
  ).run('2025-01-01', 'Current Asset', 'Asset', userId);
  db.prepare(
    `INSERT INTO chart (date, name, type, userId) VALUES (?, ?, ?, ?)`,
  ).run('2025-01-01', 'Revenue', 'Revenue', userId);
  db.prepare(
    `INSERT INTO chart (date, name, type, userId) VALUES (?, ?, ?, ?)`,
  ).run('2025-01-01', 'Expense', 'Expense', userId);
  return userId;
}

function createCore(db: Database.Database) {
  const driver = new BetterSqliteDriver(db);
  const accounts = new AccountService({ db: driver, session });
  const pricing = new PricingService({ db: driver, session });
  const ledger = new LedgerService({ db: driver, session });
  const journal = new JournalService({
    db: driver,
    session,
    ledgerService: ledger,
  });
  const vendorStock = new VendorStockService({ db: driver });
  const invoices = new InvoiceService({
    db: driver,
    session,
    journalService: journal,
    accountService: accounts,
    pricingService: pricing,
    vendorStockService: vendorStock,
  });
  return { driver, accounts, pricing, ledger, journal, invoices };
}

/** The old main-process services, bound to a given db the way their own tests do. */
function createMainServices(db: Database.Database): {
  accounts: MainAccountService;
  pricing: MainPricingService;
  ledger: MainLedgerService;
  journal: MainJournalService;
  invoices: MainInvoiceService;
} {
  const accounts = Object.create(MainAccountService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (accounts as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (accounts as any).initPreparedStatements();

  const pricing = Object.create(MainPricingService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pricing as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pricing as any).initPreparedStatements();

  const ledger = Object.create(MainLedgerService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ledger as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ledger as any).initPreparedStatements();

  const journal = Object.create(MainJournalService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (journal as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (journal as any).ledgerService = ledger;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (journal as any).initPreparedStatements();

  const invoices = Object.create(MainInvoiceService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (invoices as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (invoices as any).journalService = journal;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (invoices as any).accountService = accounts;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (invoices as any).pricingService = pricing;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (invoices as any).initPreparedStatements();

  return {
    accounts: accounts as MainAccountService,
    pricing: pricing as MainPricingService,
    ledger: ledger as MainLedgerService,
    journal: journal as MainJournalService,
    invoices: invoices as MainInvoiceService,
  };
}

function getSingleNumber(
  db: Database.Database,
  sql: string,
  params?: unknown[],
): number {
  const row = db.prepare(sql).get(params ?? []);
  return Number((row as Record<string, unknown> | undefined)?.id);
}

function getAccountIdByName(db: Database.Database, name: string): number {
  return getSingleNumber(
    db,
    `SELECT id FROM account WHERE TRIM(name) = TRIM(?) LIMIT 1`,
    [name],
  );
}

interface SeededAccounts {
  saleAccountId: number;
  purchaseAccountId: number;
  discountExpenseAccountId: number;
  primaryPartyId: number;
  sectionPartyId: number;
}

interface SeededInventory {
  primaryTypeId: number;
  otherTypeId: number;
  primaryItemId: number;
  otherItemId: number;
}

const computeUiRowTotal = (
  row: Pick<InvoiceItem, 'quantity' | 'price' | 'discount'>,
): number => row.quantity * (row.price ?? 0) * (1 - row.discount / 100);

const computeUiTotal = (
  groups: InvoiceItem[][],
  extraDiscount: number,
): number => {
  const grossRounded = groups.reduce((sum, group) => {
    const raw = group.reduce((s, item) => s + computeUiRowTotal(item), 0);
    return sum + Math.round(raw);
  }, 0);
  return grossRounded - extraDiscount;
};

describe('core InvoiceService', () => {
  let db: Database.Database;
  let core: ReturnType<typeof createCore>;

  const seedBaseAccounts = async (): Promise<SeededAccounts> => {
    await core.accounts.insertAccount({
      name: 'Sale',
      headName: 'Revenue',
      ...defaultAccountFields,
    });
    await core.accounts.insertAccount({
      name: 'Purchase',
      headName: 'Expense',
      ...defaultAccountFields,
    });
    await core.accounts.insertAccount({
      name: DISCOUNT_ACCOUNT_NAME,
      headName: 'Expense',
      ...defaultAccountFields,
    });
    await core.accounts.insertAccount({
      name: 'PrimaryParty',
      headName: 'Current Asset',
      code: 100,
      ...defaultAccountFields,
    });
    await core.accounts.insertAccount({
      name: 'SectionParty',
      headName: 'Current Asset',
      code: 200,
      ...defaultAccountFields,
    });

    return {
      saleAccountId: getAccountIdByName(db, 'Sale'),
      purchaseAccountId: getAccountIdByName(db, 'Purchase'),
      discountExpenseAccountId: getAccountIdByName(db, DISCOUNT_ACCOUNT_NAME),
      primaryPartyId: getAccountIdByName(db, 'PrimaryParty'),
      sectionPartyId: getAccountIdByName(db, 'SectionParty'),
    };
  };

  const seedInventoryAndTypes = async (): Promise<SeededInventory> => {
    await core.pricing.insertItemType('T');
    await core.pricing.insertItemType('TT');
    const primaryTypeId = getSingleNumber(
      db,
      `SELECT id FROM item_types WHERE TRIM(name) = TRIM(?) LIMIT 1`,
      ['T'],
    );
    const otherTypeId = getSingleNumber(
      db,
      `SELECT id FROM item_types WHERE TRIM(name) = TRIM(?) LIMIT 1`,
      ['TT'],
    );
    await core.pricing.setPrimaryItemType(primaryTypeId);

    const insert = db.prepare(
      `INSERT INTO inventory (name, description, price, quantity, itemTypeId)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run('ItemPrimary', null, 101, 50, primaryTypeId);
    insert.run('ItemOther', null, 99, 50, otherTypeId);

    const primaryItemId = getSingleNumber(
      db,
      `SELECT id FROM inventory WHERE TRIM(name) = TRIM(?) LIMIT 1`,
      ['ItemPrimary'],
    );
    const otherItemId = getSingleNumber(
      db,
      `SELECT id FROM inventory WHERE TRIM(name) = TRIM(?) LIMIT 1`,
      ['ItemOther'],
    );
    return { primaryTypeId, otherTypeId, primaryItemId, otherItemId };
  };

  beforeEach(() => {
    db = new Database(':memory:');
    seedBasicSchema(db);
    core = createCore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('sale: single account, no extra discount, posts one journal and decrements inventory', async () => {
    const acc = await seedBaseAccounts();
    const inv = await seedInventoryAndTypes();

    const items: InvoiceItem[] = [
      {
        id: 1,
        inventoryId: inv.primaryItemId,
        quantity: 2,
        discount: 10,
        price: 101,
        discountedPrice: computeUiRowTotal({
          quantity: 2,
          price: 101,
          discount: 10,
        }),
      },
    ];

    const uiTotal = computeUiTotal([items], 0);
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-03-01T12:00:00.000Z').toISOString(),
      invoiceNumber: 1001,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: uiTotal,
      biltyNumber: '',
      cartons: 0,
      accountMapping: {
        singleAccountId: acc.primaryPartyId,
        multipleAccountIds: [],
      },
      invoiceItems: items,
    };

    const { invoiceId, nextInvoiceNumber } = await core.invoices.insertInvoice(
      'Sale' as InvoiceType,
      invoice,
    );
    expect(invoiceId).toBeGreaterThan(0);
    expect(nextInvoiceNumber).toBe(1002);

    const invRow = db
      .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
      .get([inv.primaryItemId]) as { quantity: number };
    expect(invRow.quantity).toBe(48);

    const journalRows = db
      .prepare(`SELECT narration, billNumber FROM journal ORDER BY id`)
      .all() as Array<{ narration: string; billNumber: number }>;
    expect(journalRows).toHaveLength(1);
    expect(journalRows[0].narration).toBe('Sale Invoice #1001');
    expect(journalRows[0].billNumber).toBe(1001);

    const partyLedger = await core.ledger.getLedger(acc.primaryPartyId);
    const saleLedger = await core.ledger.getLedger(acc.saleAccountId);
    expect(partyLedger.at(-1)!.debit).toBe(uiTotal);
    expect(saleLedger.at(-1)!.credit).toBe(uiTotal);
  });

  it('sale: single account, extra discount posts extra-discount journal and reconciles to UI total', async () => {
    const acc = await seedBaseAccounts();
    const inv = await seedInventoryAndTypes();

    const items: InvoiceItem[] = [
      {
        id: 1,
        inventoryId: inv.primaryItemId,
        quantity: 1,
        discount: 10,
        price: 101,
        discountedPrice: computeUiRowTotal({
          quantity: 1,
          price: 101,
          discount: 10,
        }),
      },
    ];

    const extraDiscount = 5;
    const uiTotal = computeUiTotal([items], extraDiscount);
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-03-02T12:00:00.000Z').toISOString(),
      invoiceNumber: 2001,
      extraDiscount,
      extraDiscountAccountId: acc.primaryPartyId,
      totalAmount: uiTotal,
      biltyNumber: '',
      cartons: 0,
      accountMapping: {
        singleAccountId: acc.primaryPartyId,
        multipleAccountIds: [],
      },
      invoiceItems: items,
    };

    await core.invoices.insertInvoice('Sale' as InvoiceType, invoice);

    const journalRows = db
      .prepare(`SELECT narration FROM journal ORDER BY id`)
      .all() as Array<{ narration: string }>;
    expect(journalRows).toHaveLength(2);
    expect(journalRows[0].narration).toBe('Sale Invoice #2001');
    expect(journalRows[1].narration).toBe(
      'Sale Invoice #2001 (extra discount)',
    );

    const partyLedger = await core.ledger.getLedger(acc.primaryPartyId);
    expect(partyLedger.at(-2)!.debit).toBe(uiTotal + extraDiscount);
    expect(partyLedger.at(-1)!.credit).toBe(extraDiscount);

    const net =
      (partyLedger.at(-2)!.debit ?? 0) - (partyLedger.at(-1)!.credit ?? 0);
    expect(net).toBe(uiTotal);
  });

  it('sale: sections/multi-customer posts per-account journals and decrements inventory per item', async () => {
    const acc = await seedBaseAccounts();
    const inv = await seedInventoryAndTypes();

    const itemA: InvoiceItem = {
      id: 1,
      inventoryId: inv.primaryItemId,
      quantity: 2,
      discount: 0,
      price: 101,
      discountedPrice: computeUiRowTotal({
        quantity: 2,
        price: 101,
        discount: 0,
      }),
    };
    const itemB: InvoiceItem = {
      id: 2,
      inventoryId: inv.otherItemId,
      quantity: 3,
      discount: 0,
      price: 99,
      discountedPrice: computeUiRowTotal({
        quantity: 3,
        price: 99,
        discount: 0,
      }),
    };

    const uiTotal = computeUiTotal([[itemA], [itemB]], 0);
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-03-04T12:00:00.000Z').toISOString(),
      invoiceNumber: 4001,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: uiTotal,
      biltyNumber: '',
      cartons: 0,
      accountMapping: {
        singleAccountId: acc.primaryPartyId,
        multipleAccountIds: [acc.primaryPartyId, acc.sectionPartyId],
      },
      invoiceItems: [itemA, itemB],
    };

    await core.invoices.insertInvoice('Sale' as InvoiceType, invoice);

    const invRow1 = db
      .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
      .get([inv.primaryItemId]) as { quantity: number };
    const invRow2 = db
      .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
      .get([inv.otherItemId]) as { quantity: number };
    expect(invRow1.quantity).toBe(48);
    expect(invRow2.quantity).toBe(47);

    const mainJournals = db
      .prepare(`SELECT id FROM journal WHERE narration = ? ORDER BY id`)
      .all(['Sale Invoice #4001']) as Array<{ id: number }>;
    expect(mainJournals).toHaveLength(2);
  });

  it('purchase: single vendor increments inventory and posts purchase journal', async () => {
    const acc = await seedBaseAccounts();
    const inv = await seedInventoryAndTypes();

    const items: InvoiceItem[] = [
      {
        id: 1,
        inventoryId: inv.primaryItemId,
        quantity: 2,
        discount: 0,
        price: 101,
        discountedPrice: 0,
      },
    ];

    const uiTotal = 202;
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Purchase' as InvoiceType,
      date: new Date('2026-03-05T12:00:00.000Z').toISOString(),
      invoiceNumber: 5001,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: uiTotal,
      biltyNumber: '',
      cartons: 0,
      accountMapping: {
        singleAccountId: acc.primaryPartyId,
        multipleAccountIds: [],
      },
      invoiceItems: items,
    };

    await core.invoices.insertInvoice('Purchase' as InvoiceType, invoice);

    const invRow = db
      .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
      .get([inv.primaryItemId]) as { quantity: number };
    expect(invRow.quantity).toBe(52);

    const vendorLedger = await core.ledger.getLedger(acc.primaryPartyId);
    const purchaseLedger = await core.ledger.getLedger(acc.purchaseAccountId);
    expect(vendorLedger.at(-1)!.credit).toBe(uiTotal);
    expect(purchaseLedger.at(-1)!.debit).toBe(uiTotal);
  });

  it('purchase: update rejects when edit would drive inventory negative', async () => {
    const acc = await seedBaseAccounts();
    const inv = await seedInventoryAndTypes();

    db.prepare(`UPDATE inventory SET quantity = 1 WHERE id = ?`).run([
      inv.primaryItemId,
    ]);

    const qtyLarge = 100;
    const price = 10;
    const items: InvoiceItem[] = [
      {
        id: 1,
        inventoryId: inv.primaryItemId,
        quantity: qtyLarge,
        discount: 0,
        price,
        discountedPrice: qtyLarge * price,
      },
    ];

    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Purchase' as InvoiceType,
      date: new Date('2026-03-06T12:00:00.000Z').toISOString(),
      invoiceNumber: 5002,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: qtyLarge * price,
      biltyNumber: '',
      cartons: 0,
      accountMapping: {
        singleAccountId: acc.primaryPartyId,
        multipleAccountIds: [],
      },
      invoiceItems: items,
    };

    const { invoiceId } = await core.invoices.insertInvoice(
      'Purchase' as InvoiceType,
      invoice,
    );

    db.prepare(`UPDATE inventory SET quantity = 50 WHERE id = ?`).run([
      inv.primaryItemId,
    ]);

    const qtySmall = 1;
    const updatedInvoice: Invoice = {
      ...invoice,
      id: invoiceId,
      totalAmount: qtySmall * price,
      invoiceItems: [
        { ...items[0], quantity: qtySmall, discountedPrice: qtySmall * price },
      ],
    };

    await expect(
      core.invoices.updateInvoice(
        'Purchase' as InvoiceType,
        invoiceId,
        updatedInvoice,
      ),
    ).rejects.toThrow(/Stock would go below zero for:.*ItemPrimary/);

    const invRow = db
      .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
      .get([inv.primaryItemId]) as { quantity: number };
    expect(invRow.quantity).toBe(50);
  });

  it('getInvoice and getInvoices reflect a single-account sale after insertInvoice', async () => {
    const acc = await seedBaseAccounts();
    const inv = await seedInventoryAndTypes();

    const items: InvoiceItem[] = [
      {
        id: 1,
        inventoryId: inv.primaryItemId,
        quantity: 2,
        discount: 5,
        price: 101,
        discountedPrice: computeUiRowTotal({
          quantity: 2,
          price: 101,
          discount: 5,
        }),
      },
    ];
    const uiTotal = computeUiTotal([items], 0);
    const invoiceNumber = 9201;

    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-05-01T12:00:00.000Z').toISOString(),
      invoiceNumber,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: uiTotal,
      biltyNumber: '55',
      cartons: 2,
      accountMapping: {
        singleAccountId: acc.primaryPartyId,
        multipleAccountIds: [],
      },
      invoiceItems: items,
    };

    const { invoiceId } = await core.invoices.insertInvoice(
      'Sale' as InvoiceType,
      invoice,
    );

    const view = await core.invoices.getInvoice(invoiceId);
    expect(view.id).toBe(invoiceId);
    expect(view.invoiceNumber).toBe(invoiceNumber);
    expect(view.accountName).toBe('PrimaryParty');
    expect(Number(view.biltyNumber)).toBe(55);
    expect(view.cartons).toBe(2);
    expect(view.invoiceItems).toHaveLength(1);
    expect(view.invoiceItems[0].inventoryItemName).toBe('ItemPrimary');
    expect(view.invoiceItems[0].itemTypeName).toBe('T');

    const list = await core.invoices.getInvoices('Sale' as InvoiceType);
    const listRow = list.find((r) => r.id === invoiceId);
    expect(listRow).toBeDefined();
    expect(listRow!.accountName).toBe('PrimaryParty');
    expect(Number(listRow!.linkedJournalCount)).toBeGreaterThan(0);
  });

  it('returnSaleInvoice: removes journals, restores inventory, stores trimmed reason, and marks returned', async () => {
    const acc = await seedBaseAccounts();
    const inv = await seedInventoryAndTypes();

    const items: InvoiceItem[] = [
      {
        id: 1,
        inventoryId: inv.primaryItemId,
        quantity: 2,
        discount: 10,
        price: 101,
        discountedPrice: computeUiRowTotal({
          quantity: 2,
          price: 101,
          discount: 10,
        }),
      },
    ];
    const uiTotal = computeUiTotal([items], 0);
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-03-01T12:00:00.000Z').toISOString(),
      invoiceNumber: 91001,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: uiTotal,
      biltyNumber: '',
      cartons: 0,
      accountMapping: {
        singleAccountId: acc.primaryPartyId,
        multipleAccountIds: [],
      },
      invoiceItems: items,
    };

    const { invoiceId } = await core.invoices.insertInvoice(
      'Sale' as InvoiceType,
      invoice,
    );

    expect(
      (
        db
          .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
          .get([inv.primaryItemId]) as { quantity: number }
      ).quantity,
    ).toBe(48);

    await core.invoices.returnSaleInvoice(invoiceId, {
      returnReason: '  customer changed mind  ',
    });

    const journalCountAfter = (
      db.prepare(`SELECT COUNT(*) as c FROM journal`).get() as { c: number }
    ).c;
    expect(journalCountAfter).toBe(0);

    const qtyAfterReturn = (
      db
        .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
        .get([inv.primaryItemId]) as { quantity: number }
    ).quantity;
    expect(qtyAfterReturn).toBe(50);

    const returnedRow = db
      .prepare(`SELECT isReturned, returnReason FROM invoices WHERE id = ?`)
      .get([invoiceId]) as { isReturned: number; returnReason: string | null };
    expect(returnedRow.isReturned).toBe(1);
    expect(returnedRow.returnReason).toBe('customer changed mind');

    const view = await core.invoices.getInvoice(invoiceId);
    expect(view.isReturned).toBe(true);
    expect(view.returnReason).toBe('customer changed mind');

    await expect(core.invoices.returnSaleInvoice(invoiceId)).rejects.toThrow();
  });

  it('returnPurchaseInvoice: rejects when return would drive inventory negative', async () => {
    const acc = await seedBaseAccounts();
    const inv = await seedInventoryAndTypes();

    const qtyPurchase = 100;
    const items: InvoiceItem[] = [
      {
        id: 1,
        inventoryId: inv.primaryItemId,
        quantity: qtyPurchase,
        discount: 0,
        price: 10,
        discountedPrice: 0,
      },
    ];
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Purchase' as InvoiceType,
      date: new Date('2026-06-03T12:00:00.000Z').toISOString(),
      invoiceNumber: 93002,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: qtyPurchase * 10,
      biltyNumber: '',
      cartons: 0,
      accountMapping: {
        singleAccountId: acc.primaryPartyId,
        multipleAccountIds: [],
      },
      invoiceItems: items,
    };

    const { invoiceId } = await core.invoices.insertInvoice(
      'Purchase' as InvoiceType,
      invoice,
    );

    db.prepare(`UPDATE inventory SET quantity = 50 WHERE id = ?`).run([
      inv.primaryItemId,
    ]);

    await expect(
      core.invoices.returnPurchaseInvoice(invoiceId, {
        returnReason: 'vendor credit',
      }),
    ).rejects.toThrow(/Stock would go below zero for:.*ItemPrimary/);

    const returnedRow = db
      .prepare(`SELECT isReturned FROM invoices WHERE id = ?`)
      .get([invoiceId]) as { isReturned: number };
    expect(returnedRow.isReturned).toBe(0);
  });
});

describe('core InvoiceService sale quotations', () => {
  let db: Database.Database;
  let core: ReturnType<typeof createCore>;

  const seedMinimalSaleQuotationSetup = async (): Promise<{
    partyId: number;
    itemId: number;
  }> => {
    await core.accounts.insertAccount({
      name: 'Sale',
      headName: 'Revenue',
      ...defaultAccountFields,
    });
    await core.accounts.insertAccount({
      name: 'Purchase',
      headName: 'Expense',
      ...defaultAccountFields,
    });
    await core.accounts.insertAccount({
      name: 'QuoteParty',
      headName: 'Current Asset',
      code: 501,
      ...defaultAccountFields,
    });
    const partyId = getAccountIdByName(db, 'QuoteParty');
    db.prepare(`INSERT INTO item_types (name) VALUES ('QType')`).run();
    const primaryTypeId = getSingleNumber(
      db,
      `SELECT id FROM item_types WHERE TRIM(name) = TRIM(?) LIMIT 1`,
      ['QType'],
    );
    db.prepare(
      `INSERT INTO inventory (name, description, price, quantity, itemTypeId) VALUES (?, ?, ?, ?, ?)`,
    ).run('QuoteItem', null, 50, 10, primaryTypeId);
    const itemId = getSingleNumber(
      db,
      `SELECT id FROM inventory WHERE TRIM(name) = TRIM(?) LIMIT 1`,
      ['QuoteItem'],
    );
    // docs/derived-state-design.md §6 migration 028: quotation-conversion's
    // stock-available check (assertSaleQuotationStockAvailable) now reads
    // inventory_quantity_view (canon), not the raw `inventory.quantity`
    // column seeded above — that raw column stays 10 for the tests that
    // assert the STORED counter directly (unaffected, still a legacy write
    // path), but a real fact is needed too or the view sees no movements
    // and "have" reads 0 regardless of the raw column.
    db.prepare(
      `INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate) VALUES (?, 10, ?)`,
    ).run(itemId, '2026-01-01');
    return { partyId, itemId };
  };

  beforeEach(() => {
    db = new Database(':memory:');
    seedBasicSchema(db);
    core = createCore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('insertQuotationInvoice leaves inventory unchanged and creates no journals', async () => {
    const { partyId, itemId } = await seedMinimalSaleQuotationSetup();

    const items: InvoiceItem[] = [
      {
        id: 1,
        inventoryId: itemId,
        quantity: 3,
        discount: 0,
        price: 50,
        discountedPrice: 150,
      },
    ];
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-04-01T12:00:00.000Z').toISOString(),
      extraDiscount: 0,
      totalAmount: 150,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
      invoiceItems: items,
    };

    const { invoiceId } = await core.invoices.insertQuotationInvoice(
      'Sale' as InvoiceType,
      invoice,
    );
    expect(invoiceId).toBeGreaterThan(0);

    const qty = (
      db
        .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
        .get([itemId]) as { quantity: number }
    ).quantity;
    expect(qty).toBe(10);

    const jCount = (
      db.prepare(`SELECT COUNT(*) as c FROM journal`).get() as { c: number }
    ).c;
    expect(jCount).toBe(0);

    const row = db
      .prepare(`SELECT invoiceNumber, isQuotation FROM invoices WHERE id = ?`)
      .get([invoiceId]) as { invoiceNumber: number; isQuotation: number };
    expect(row.isQuotation).toBe(1);
    expect(row.invoiceNumber).toBeLessThan(0);
  });

  it('getNextInvoiceNumber ignores quotations when assigning next sale number', async () => {
    const { partyId, itemId } = await seedMinimalSaleQuotationSetup();

    const mkInvoice = (n: number): Invoice => ({
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-04-02T12:00:00.000Z').toISOString(),
      invoiceNumber: n,
      extraDiscount: 0,
      totalAmount: 50,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: itemId,
          quantity: 1,
          discount: 0,
          price: 50,
          discountedPrice: 50,
        },
      ],
    });

    await core.invoices.insertInvoice('Sale' as InvoiceType, mkInvoice(7001));

    const qInv: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-04-03T12:00:00.000Z').toISOString(),
      extraDiscount: 0,
      totalAmount: 50,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: itemId,
          quantity: 1,
          discount: 0,
          price: 50,
          discountedPrice: 50,
        },
      ],
    };
    await core.invoices.insertQuotationInvoice('Sale' as InvoiceType, qInv);

    const next = await core.invoices.getNextInvoiceNumber(
      'Sale' as InvoiceType,
    );
    expect(next).toBe(7002);
  });

  it('getAdjacentInvoiceId and getInvoiceIdsFromMinId scope quotations separately from posted invoices', async () => {
    const { partyId, itemId } = await seedMinimalSaleQuotationSetup();

    const mkPosted = (n: number): Invoice => ({
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-05-01T12:00:00.000Z').toISOString(),
      invoiceNumber: n,
      extraDiscount: 0,
      totalAmount: 50,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: itemId,
          quantity: 1,
          discount: 0,
          price: 50,
          discountedPrice: 50,
        },
      ],
    });
    const mkQuotation = (): Invoice => ({
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-05-02T12:00:00.000Z').toISOString(),
      extraDiscount: 0,
      totalAmount: 50,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: itemId,
          quantity: 1,
          discount: 0,
          price: 50,
          discountedPrice: 50,
        },
      ],
    });

    const { invoiceId: posted1 } = await core.invoices.insertInvoice(
      'Sale' as InvoiceType,
      mkPosted(8001),
    );
    const { invoiceId: q1 } = await core.invoices.insertQuotationInvoice(
      'Sale' as InvoiceType,
      mkQuotation(),
    );
    const { invoiceId: q2 } = await core.invoices.insertQuotationInvoice(
      'Sale' as InvoiceType,
      mkQuotation(),
    );
    const { invoiceId: posted2 } = await core.invoices.insertInvoice(
      'Sale' as InvoiceType,
      mkPosted(8002),
    );

    expect(
      await core.invoices.getAdjacentInvoiceId(
        q1,
        'Sale' as InvoiceType,
        'next',
      ),
    ).toBe(posted2);
    expect(
      await core.invoices.getAdjacentInvoiceId(
        q1,
        'Sale' as InvoiceType,
        'next',
        'quotation',
      ),
    ).toBe(q2);
    expect(
      await core.invoices.getAdjacentInvoiceId(
        q1,
        'Sale' as InvoiceType,
        'previous',
        'quotation',
      ),
    ).toBe(0);
    expect(
      await core.invoices.getAdjacentInvoiceId(
        q1,
        'Sale' as InvoiceType,
        'previous',
        'posted',
      ),
    ).toBe(posted1);

    expect(
      await core.invoices.getInvoiceIdsFromMinId(
        'Sale' as InvoiceType,
        q1,
        'posted',
      ),
    ).toEqual([posted2]);
    expect(
      await core.invoices.getInvoiceIdsFromMinId(
        'Sale' as InvoiceType,
        q1,
        'quotation',
      ),
    ).toEqual([q1, q2]);
  });

  it('convertQuotationInvoice fails when stock is short, and succeeds once available', async () => {
    const { partyId, itemId } = await seedMinimalSaleQuotationSetup();

    const shortQInv: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-04-04T12:00:00.000Z').toISOString(),
      extraDiscount: 0,
      totalAmount: 2500,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: itemId,
          quantity: 50,
          discount: 0,
          price: 50,
          discountedPrice: 2500,
        },
      ],
    };
    const { invoiceId: shortId } = await core.invoices.insertQuotationInvoice(
      'Sale' as InvoiceType,
      shortQInv,
    );
    await expect(
      core.invoices.convertQuotationInvoice(shortId),
    ).rejects.toThrow(/Not enough stock/);

    const qInv: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-04-05T12:00:00.000Z').toISOString(),
      extraDiscount: 0,
      totalAmount: 100,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: itemId,
          quantity: 2,
          discount: 0,
          price: 50,
          discountedPrice: 100,
        },
      ],
    };
    const { invoiceId } = await core.invoices.insertQuotationInvoice(
      'Sale' as InvoiceType,
      qInv,
    );

    const { invoiceNumber } = await core.invoices.convertQuotationInvoice(
      invoiceId,
    );
    expect(invoiceNumber).toBe(1);

    const list = await core.invoices.getInvoices('Sale' as InvoiceType);
    expect(list.some((r) => r.id === invoiceId)).toBe(true);

    const qList = await core.invoices.getQuotationInvoices(
      'Sale' as InvoiceType,
    );
    expect(qList.some((r) => r.id === invoiceId)).toBe(false);

    const qty = (
      db
        .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
        .get([itemId]) as { quantity: number }
    ).quantity;
    expect(qty).toBe(8);
  });

  it('getInvoicePdfOutputBaseName uses invoice number for posted and quotation-N for quotations', async () => {
    const { partyId, itemId } = await seedMinimalSaleQuotationSetup();

    const posted: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-07-01T12:00:00.000Z').toISOString(),
      invoiceNumber: 9201,
      extraDiscount: 0,
      totalAmount: 50,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: itemId,
          quantity: 1,
          discount: 0,
          price: 50,
          discountedPrice: 50,
        },
      ],
    };
    const { invoiceId: postedId } = await core.invoices.insertInvoice(
      'Sale' as InvoiceType,
      posted,
    );

    const qInv: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-07-02T12:00:00.000Z').toISOString(),
      extraDiscount: 0,
      totalAmount: 50,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
      invoiceItems: [
        {
          id: 1,
          inventoryId: itemId,
          quantity: 1,
          discount: 0,
          price: 50,
          discountedPrice: 50,
        },
      ],
    };
    const { invoiceId: qId } = await core.invoices.insertQuotationInvoice(
      'Sale' as InvoiceType,
      qInv,
    );

    expect(
      await core.invoices.getInvoicePdfOutputBaseName(
        postedId,
        'Sale' as InvoiceType,
      ),
    ).toBe('9201');
    const pdfName = await core.invoices.getInvoicePdfOutputBaseName(
      qId,
      'Sale' as InvoiceType,
    );
    expect(pdfName).toMatch(/^quotation-\d+$/);
    expect(
      await core.invoices.getInvoicePdfOutputBaseName(
        999_999,
        'Sale' as InvoiceType,
      ),
    ).toBeNull();
  });
});

describe('core InvoiceService matches main-process InvoiceService (parity)', () => {
  it('full sale invoice lifecycle: insert, read, return — identical rows on both sides', async () => {
    const dbOld = new Database(':memory:');
    const dbCore = new Database(':memory:');
    seedBasicSchema(dbOld);
    seedBasicSchema(dbCore);

    const oldServices = createMainServices(dbOld);
    const coreServices = createCore(dbCore);

    // seed identical accounts on both sides
    const accountsToSeed = [
      { name: 'Sale', headName: 'Revenue' },
      { name: 'Purchase', headName: 'Expense' },
      { name: DISCOUNT_ACCOUNT_NAME, headName: 'Expense' },
      { name: 'PrimaryParty', headName: 'Current Asset', code: 100 },
    ];
    accountsToSeed.forEach((a) =>
      oldServices.accounts.insertAccount({ ...defaultAccountFields, ...a }),
    );
    await accountsToSeed.reduce(
      (chain, a) =>
        chain.then(async () => {
          await coreServices.accounts.insertAccount({
            ...defaultAccountFields,
            ...a,
          });
        }),
      Promise.resolve(),
    );

    const oldPartyId = getAccountIdByName(dbOld, 'PrimaryParty');
    const corePartyId = getAccountIdByName(dbCore, 'PrimaryParty');
    expect(corePartyId).toBe(oldPartyId);

    // seed identical inventory directly (same pattern as the InventoryService-independent old test)
    const insertOldItem = dbOld.prepare(
      `INSERT INTO inventory (name, description, price, quantity, itemTypeId) VALUES (?, ?, ?, ?, ?)`,
    );
    const insertCoreItem = dbCore.prepare(
      `INSERT INTO inventory (name, description, price, quantity, itemTypeId) VALUES (?, ?, ?, ?, ?)`,
    );
    insertOldItem.run('ItemPrimary', null, 101, 50, null);
    insertCoreItem.run('ItemPrimary', null, 101, 50, null);
    const oldItemId = getSingleNumber(
      dbOld,
      `SELECT id FROM inventory WHERE TRIM(name) = TRIM(?) LIMIT 1`,
      ['ItemPrimary'],
    );
    const coreItemId = getSingleNumber(
      dbCore,
      `SELECT id FROM inventory WHERE TRIM(name) = TRIM(?) LIMIT 1`,
      ['ItemPrimary'],
    );
    expect(coreItemId).toBe(oldItemId);

    const items: InvoiceItem[] = [
      {
        id: 1,
        inventoryId: oldItemId,
        quantity: 2,
        discount: 10,
        price: 101,
        discountedPrice: computeUiRowTotal({
          quantity: 2,
          price: 101,
          discount: 10,
        }),
      },
    ];
    const uiTotal = computeUiTotal([items], 0);
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-08-01T12:00:00.000Z').toISOString(),
      invoiceNumber: 1,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: uiTotal,
      biltyNumber: '77',
      cartons: 3,
      accountMapping: { singleAccountId: oldPartyId, multipleAccountIds: [] },
      invoiceItems: items,
    };

    const oldResult = oldServices.invoices.insertInvoice(
      'Sale' as InvoiceType,
      invoice,
    );
    const coreResult = await coreServices.invoices.insertInvoice(
      'Sale' as InvoiceType,
      {
        ...invoice,
        accountMapping: {
          singleAccountId: corePartyId,
          multipleAccountIds: [],
        },
      },
    );
    expect(coreResult.invoiceId).toBe(oldResult.invoiceId);
    expect(coreResult.nextInvoiceNumber).toBe(oldResult.nextInvoiceNumber);

    // compare invoices / invoice_items / journal / journal_entry / inventory rows verbatim
    const readInvoiceRow = (db: Database.Database, id: number) =>
      db
        .prepare(
          `SELECT accountId, invoiceType, totalAmount, extraDiscount, biltyNumber, cartons FROM invoices WHERE id = ?`,
        )
        .get([id]);
    expect(readInvoiceRow(dbCore, coreResult.invoiceId)).toEqual(
      readInvoiceRow(dbOld, oldResult.invoiceId),
    );

    const readItemsRows = (db: Database.Database, id: number) =>
      db
        .prepare(
          `SELECT inventoryId, quantity, discount, price FROM invoice_items WHERE invoiceId = ? ORDER BY id`,
        )
        .all([id]);
    expect(readItemsRows(dbCore, coreResult.invoiceId)).toEqual(
      readItemsRows(dbOld, oldResult.invoiceId),
    );

    const readInventoryQty = (db: Database.Database, id: number) =>
      (
        db.prepare(`SELECT quantity FROM inventory WHERE id = ?`).get([id]) as {
          quantity: number;
        }
      ).quantity;
    expect(readInventoryQty(dbCore, coreItemId)).toBe(
      readInventoryQty(dbOld, oldItemId),
    );

    // docs/derived-state-design.md §6 migration 028: coreServices.ledger
    // now reads ledger_view (canon); oldServices.ledger still reads the
    // stored `ledger` table. Facts + derived balance/balanceType must still
    // agree for this ordinary journal-sourced data (no D1/D2 divergence
    // trigger here) — `id`/`createdAt`/`updatedAt` no longer compare (view
    // rows have no physical id; see JournalService.test.ts's identical
    // parity-test comment for the full explanation).
    const stripRowIdentity = <
      T extends { id: unknown; createdAt?: unknown; updatedAt?: unknown },
    >(
      rows: T[],
    ) => rows.map((row) => omit(row, ['id', 'createdAt', 'updatedAt']));
    const oldLedger = oldServices.ledger.getLedger(oldPartyId);
    const coreLedger = await coreServices.ledger.getLedger(corePartyId);
    expect(stripRowIdentity(coreLedger)).toEqual(stripRowIdentity(oldLedger));

    const oldView = oldServices.invoices.getInvoice(oldResult.invoiceId);
    const coreView = await coreServices.invoices.getInvoice(
      coreResult.invoiceId,
    );
    expect(coreView).toEqual(oldView);

    // return on both sides and compare resulting inventory + invoice state
    oldServices.invoices.returnSaleInvoice(oldResult.invoiceId, {
      returnReason: 'parity check',
    });
    await coreServices.invoices.returnSaleInvoice(coreResult.invoiceId, {
      returnReason: 'parity check',
    });

    expect(readInventoryQty(dbCore, coreItemId)).toBe(
      readInventoryQty(dbOld, oldItemId),
    );
    const readReturnedRow = (db: Database.Database, id: number) =>
      db
        .prepare(`SELECT isReturned, returnReason FROM invoices WHERE id = ?`)
        .get([id]);
    expect(readReturnedRow(dbCore, coreResult.invoiceId)).toEqual(
      readReturnedRow(dbOld, oldResult.invoiceId),
    );

    dbOld.close();
    dbCore.close();
  });
});
