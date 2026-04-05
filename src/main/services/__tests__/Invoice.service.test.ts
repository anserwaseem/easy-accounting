import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type {
  InsertAccount,
  Invoice,
  InvoiceItem,
  InvoiceType,
  UserCredentials,
} from '../../../types';
import { BalanceType } from '../../../types';
import { MigrationRunner } from '../../migrations';
import {
  AccountService,
  AuthService,
  DatabaseService,
  InvoiceService,
  LedgerService,
  PricingService,
} from '..';
import { DISCOUNT_ACCOUNT_NAME } from '../../utils/constants';

const TEST_DB_USER: UserCredentials = {
  username: 'testuser',
  password: 'testpassword',
};

jest.mock('electron-log', () => {
  const mockLog = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    verbose: jest.fn(),
    debug: jest.fn(),
    silly: jest.fn(),
    transports: {
      file: { getFile: jest.fn() },
      console: { level: 'debug' },
    },
  };
  return mockLog;
});

jest.mock('../../store', () => ({
  store: {
    get: jest.fn((key) => {
      if (key === 'username') return TEST_DB_USER.username;
      return jest.fn();
    }),
    set: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

const defaultAccountFields: Omit<InsertAccount, 'name' | 'headName'> = {
  code: undefined,
  address: undefined,
  phone1: undefined,
  phone2: undefined,
  goodsName: undefined,
  isActive: true,
  discountProfileId: null,
};

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

interface SeededAccounts {
  saleAccountId: number;
  purchaseAccountId: number;
  discountExpenseAccountId: number;
  primaryPartyId: number;
  sectionPartyId: number;
  typedPartyId: number;
  typedPartyChartId: number;
  typedPartyCode: string;
  typedPartyName: string;
  typedSuffixAccountId: number;
}

interface SeededInventory {
  primaryTypeId: number;
  otherTypeId: number;
  primaryItemId: number;
  otherItemId: number;
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

function getDiscountProfileIdByName(
  db: Database.Database,
  name: string,
): number {
  return getSingleNumber(
    db,
    `SELECT id FROM discount_profiles WHERE TRIM(name) = TRIM(?) LIMIT 1`,
    [name],
  );
}

function getJournalEntryTotals(
  db: Database.Database,
  journalId: number,
): { debit: number; credit: number } {
  const rows = db
    .prepare(
      `SELECT COALESCE(debitAmount, 0) AS d, COALESCE(creditAmount, 0) AS c
       FROM journal_entry WHERE journalId = ?`,
    )
    .all([journalId]) as Array<{ d: number | string; c: number | string }>;
  return {
    debit: rows.reduce((s, r) => s + Number(r.d), 0),
    credit: rows.reduce((s, r) => s + Number(r.c), 0),
  };
}

describe('InvoiceService.insertInvoice', () => {
  let db: Database.Database;
  let invoiceService: InvoiceService;
  let ledgerService: LedgerService;
  let accountService: AccountService;
  let authService: AuthService;
  let pricingService: PricingService;

  const seedBaseAccounts = (): SeededAccounts => {
    accountService.insertAccount({
      name: 'Sale',
      headName: 'Revenue',
      ...defaultAccountFields,
    });
    accountService.insertAccount({
      name: 'Purchase',
      headName: 'Expense',
      ...defaultAccountFields,
    });
    accountService.insertAccount({
      name: DISCOUNT_ACCOUNT_NAME,
      headName: 'Expense',
      ...defaultAccountFields,
    });

    // parties (customers/vendors) live under Asset charts in this app.
    accountService.insertAccount({
      name: 'PrimaryParty',
      headName: 'Current Asset',
      code: 100,
      ...defaultAccountFields,
    });
    accountService.insertAccount({
      name: 'SectionParty',
      headName: 'Current Asset',
      code: 200,
      ...defaultAccountFields,
    });

    const typedPartyName = 'TypedParty';
    const typedPartyCode = 'TP';
    accountService.insertAccount({
      name: typedPartyName,
      headName: 'Current Asset',
      code: typedPartyCode,
      ...defaultAccountFields,
    });
    const typedPartyId = getAccountIdByName(db, typedPartyName);
    const typedPartyChartId = Number(
      (
        db
          .prepare(`SELECT chartId FROM account WHERE id = ? LIMIT 1`)
          .get([typedPartyId]) as { chartId?: number } | undefined
      )?.chartId,
    );

    // suffixed typed account used by split-by-type resolution in renderer; DB just treats it as a distinct party.
    const typedSuffixName = `${typedPartyName}-TT`;
    const typedSuffixCode = `${typedPartyCode}-TT`;
    accountService.insertAccount({
      name: typedSuffixName,
      headName: 'Current Asset',
      code: typedSuffixCode,
      ...defaultAccountFields,
    });

    return {
      saleAccountId: getAccountIdByName(db, 'Sale'),
      purchaseAccountId: getAccountIdByName(db, 'Purchase'),
      discountExpenseAccountId: getAccountIdByName(db, DISCOUNT_ACCOUNT_NAME),
      primaryPartyId: getAccountIdByName(db, 'PrimaryParty'),
      sectionPartyId: getAccountIdByName(db, 'SectionParty'),
      typedPartyId,
      typedPartyChartId,
      typedPartyCode,
      typedPartyName,
      typedSuffixAccountId: getAccountIdByName(db, typedSuffixName),
    };
  };

  const seedInventoryAndTypes = (): SeededInventory => {
    // use PricingService to create item types; then query ids.
    pricingService.insertItemType('T');
    pricingService.insertItemType('TT');
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
    pricingService.setPrimaryItemType(primaryTypeId);

    // insert inventory rows directly for determinism (InventoryService.insertItem doesn't allow quantity).
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

  const seedDiscountProfileForAccount = (
    accountId: number,
    profileName: string,
  ) => {
    pricingService.insertDiscountProfile(profileName);
    const profileId = getDiscountProfileIdByName(db, profileName);
    accountService.updateAccountDiscountProfile(accountId, profileId);
    return profileId;
  };

  beforeEach(async () => {
    db = new Database(':memory:');

    jest.spyOn(DatabaseService, 'getInstance').mockImplementation(
      () =>
        ({
          getDatabase: () => db,
        }) as unknown as DatabaseService,
    );

    const schemaPath = path.join(__dirname, '../../../sql/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSql);

    const migrationRunner = new MigrationRunner();
    await migrationRunner.waitForMigrations();

    authService = new AuthService();
    accountService = new AccountService();
    pricingService = new PricingService();
    invoiceService = new InvoiceService();
    ledgerService = new LedgerService();

    authService.register(TEST_DB_USER);
    // login sets the store username, but store is mocked; still keep it explicit.
    authService.login(TEST_DB_USER);
  });

  it('sale: single account, no extra discount, posts one journal and decrements inventory', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();

    const profileId = seedDiscountProfileForAccount(
      acc.primaryPartyId,
      'DP-Primary',
    );
    pricingService.saveProfileTypeDiscounts(profileId, [
      { itemTypeId: inv.primaryTypeId, discountPercent: 10 },
    ]);

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

    const { invoiceId, nextInvoiceNumber } = invoiceService.insertInvoice(
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
      .prepare(
        `SELECT id, narration, billNumber, discountPercentage FROM journal ORDER BY id`,
      )
      .all() as Array<{
      id: number;
      narration: string;
      billNumber: number;
      discountPercentage?: number;
    }>;
    expect(journalRows).toHaveLength(1);
    expect(journalRows[0].narration).toBe('Sale Invoice #1001');
    expect(journalRows[0].billNumber).toBe(1001);
    expect(journalRows[0].discountPercentage).toBe(10);

    // debit party, credit Sale account for the UI total
    const partyLedger = ledgerService.getLedger(acc.primaryPartyId);
    const saleLedger = ledgerService.getLedger(acc.saleAccountId);
    expect(partyLedger.at(-1)!.debit).toBe(uiTotal);
    expect(partyLedger.at(-1)!.balanceType).toBe(BalanceType.Dr);
    expect(saleLedger.at(-1)!.credit).toBe(uiTotal);
    expect(saleLedger.at(-1)!.balanceType).toBe(BalanceType.Cr);
  });

  it('sale: single account, extra discount posts extra-discount journal and reconciles to UI total', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();

    const profileId = seedDiscountProfileForAccount(
      acc.primaryPartyId,
      'DP-Primary',
    );
    pricingService.saveProfileTypeDiscounts(profileId, [
      { itemTypeId: inv.primaryTypeId, discountPercent: 10 },
    ]);

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

    invoiceService.insertInvoice('Sale' as InvoiceType, invoice);

    const journalRows = db
      .prepare(
        `SELECT id, narration, billNumber, discountPercentage FROM journal ORDER BY id`,
      )
      .all() as Array<{
      id: number;
      narration: string;
      billNumber: number;
      discountPercentage?: number;
    }>;
    expect(journalRows).toHaveLength(2);
    expect(journalRows[0].narration).toBe('Sale Invoice #2001');
    expect(journalRows[0].billNumber).toBe(2001);
    expect(journalRows[0].discountPercentage).toBe(10);
    expect(journalRows[1].narration).toBe(
      'Sale Invoice #2001 (extra discount)',
    );
    expect(journalRows[1].billNumber).toBe(2001);

    // main journal debits party for uiTotal + extraDiscount (see InvoiceService behavior)
    const partyLedger = ledgerService.getLedger(acc.primaryPartyId);
    expect(partyLedger.at(-2)!.debit).toBe(uiTotal + extraDiscount);
    // extra discount journal credits party for extraDiscount
    expect(partyLedger.at(-1)!.credit).toBe(extraDiscount);

    // net debit equals uiTotal (UI truth)
    const net =
      (partyLedger.at(-2)!.debit ?? 0) - (partyLedger.at(-1)!.credit ?? 0);
    expect(net).toBe(uiTotal);
  });

  it('sale: multi-account (type split style), posts per-account journals with rounded group totals and extra discount journal reconciles', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();

    // discounts: typed account gets 0% for other type, primary account gets 10% for primary type
    const primaryProfileId = seedDiscountProfileForAccount(
      acc.typedPartyId,
      'DP-Typed',
    );
    pricingService.saveProfileTypeDiscounts(primaryProfileId, [
      { itemTypeId: inv.primaryTypeId, discountPercent: 10 },
      { itemTypeId: inv.otherTypeId, discountPercent: 0 },
    ]);

    const groupAAccountId = acc.typedPartyId;
    const groupBAccountId = acc.typedSuffixAccountId;

    const groupAItems: InvoiceItem[] = [
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
    const groupBItems: InvoiceItem[] = [
      {
        id: 2,
        inventoryId: inv.otherItemId,
        quantity: 1,
        discount: 0,
        price: 99,
        discountedPrice: computeUiRowTotal({
          quantity: 1,
          price: 99,
          discount: 0,
        }),
      },
    ];

    const extraDiscount = 3;
    const uiTotal = computeUiTotal([groupAItems, groupBItems], extraDiscount);

    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-03-03T12:00:00.000Z').toISOString(),
      invoiceNumber: 3001,
      extraDiscount,
      extraDiscountAccountId: groupAAccountId,
      totalAmount: uiTotal,
      biltyNumber: '',
      cartons: 0,
      accountMapping: {
        // header uses single account id; in split-by-type flows it is the unsuffixed customer
        singleAccountId: acc.typedPartyId,
        // each invoice item maps to an account
        multipleAccountIds: [groupAAccountId, groupBAccountId],
      },
      invoiceItems: [...groupAItems, ...groupBItems],
    };

    invoiceService.insertInvoice('Sale' as InvoiceType, invoice);

    const journalRows = db
      .prepare(
        `SELECT narration, billNumber FROM journal WHERE billNumber = ? ORDER BY id`,
      )
      .all([3001]) as Array<{ narration: string; billNumber: number }>;
    // groupA journal + groupB journal + extra discount journal
    expect(journalRows).toHaveLength(3);
    expect(journalRows[0].narration).toBe('Sale Invoice #3001');
    expect(journalRows[1].narration).toBe('Sale Invoice #3001');
    expect(journalRows[2].narration).toBe(
      'Sale Invoice #3001 (extra discount)',
    );

    const groupAAmount = Math.round(
      groupAItems.reduce((s, i) => s + computeUiRowTotal(i), 0),
    );
    const groupBAmount = Math.round(
      groupBItems.reduce((s, i) => s + computeUiRowTotal(i), 0),
    );

    const typedLedger = ledgerService.getLedger(groupAAccountId);
    const typedSuffixLedger = ledgerService.getLedger(groupBAccountId);

    // each account is debited for its rounded group amount (linked to Sale account on credit)
    expect(
      typedLedger.find(
        (l) =>
          l.debit === groupAAmount && l.linkedAccountId === acc.saleAccountId,
      ),
    ).toBeTruthy();
    expect(
      typedSuffixLedger.find(
        (l) =>
          l.debit === groupBAmount && l.linkedAccountId === acc.saleAccountId,
      ),
    ).toBeTruthy();

    // extra discount journal credits selected account for extra discount and debits Discount expense
    expect(
      typedLedger.find(
        (l) =>
          l.credit === extraDiscount &&
          l.linkedAccountId === acc.discountExpenseAccountId,
      ),
    ).toBeTruthy();
    const discountLedger = ledgerService.getLedger(
      acc.discountExpenseAccountId,
    );
    expect(discountLedger.at(-1)!.debit).toBe(extraDiscount);

    // reconcile: sum(group debits) - extraDiscount == uiTotal
    expect(groupAAmount + groupBAmount - extraDiscount).toBe(uiTotal);
  });

  it('sale: sections/multi-customer posts per-account journals and decrements inventory per item', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();

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

    // in sections mode, multipleAccountIds represent the section's selected party for each row.
    const groupAItems = [itemA];
    const groupBItems = [itemB];
    const uiTotal = computeUiTotal([groupAItems, groupBItems], 0);
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

    invoiceService.insertInvoice('Sale' as InvoiceType, invoice);

    const invRow1 = db
      .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
      .get([inv.primaryItemId]) as { quantity: number };
    const invRow2 = db
      .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
      .get([inv.otherItemId]) as { quantity: number };
    expect(invRow1.quantity).toBe(48);
    expect(invRow2.quantity).toBe(47);

    // two account groups => two main journals
    const mainJournals = db
      .prepare(`SELECT id FROM journal WHERE narration = ? ORDER BY id`)
      .all(['Sale Invoice #4001']) as Array<{ id: number }>;
    expect(mainJournals).toHaveLength(2);
  });

  it('purchase: single vendor increments inventory and posts purchase journal', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();

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

    // purchase UI doesn’t round per section; but DB uses invoice.totalAmount as-is for posting.
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

    invoiceService.insertInvoice('Purchase' as InvoiceType, invoice);

    const invRow = db
      .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
      .get([inv.primaryItemId]) as { quantity: number };
    expect(invRow.quantity).toBe(52);

    const vendorLedger = ledgerService.getLedger(acc.primaryPartyId);
    const purchaseLedger = ledgerService.getLedger(acc.purchaseAccountId);
    // purchase: credit vendor, debit purchase
    expect(vendorLedger.at(-1)!.credit).toBe(uiTotal);
    expect(purchaseLedger.at(-1)!.debit).toBe(uiTotal);
  });

  it('sale: invoices + invoice_items + journal + journal_entry + chart/account + inventory + item_types + discount_profiles + profile_type_discounts align', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();

    const profileId = seedDiscountProfileForAccount(
      acc.primaryPartyId,
      'DP-FullStack',
    );
    pricingService.saveProfileTypeDiscounts(profileId, [
      { itemTypeId: inv.primaryTypeId, discountPercent: 10 },
    ]);

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
    const invoiceNumber = 8451;
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-04-01T12:00:00.000Z').toISOString(),
      invoiceNumber,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: uiTotal,
      biltyNumber: '88',
      cartons: 6,
      accountMapping: {
        singleAccountId: acc.primaryPartyId,
        multipleAccountIds: [],
      },
      invoiceItems: items,
    };

    const { invoiceId } = invoiceService.insertInvoice(
      'Sale' as InvoiceType,
      invoice,
    );

    const invRow = db
      .prepare(`SELECT quantity, itemTypeId, price FROM inventory WHERE id = ?`)
      .get([inv.primaryItemId]) as {
      quantity: number;
      itemTypeId: number;
      price: number;
    };
    expect(invRow.quantity).toBe(48);
    expect(invRow.itemTypeId).toBe(inv.primaryTypeId);
    expect(Number(invRow.price)).toBe(101);

    const primaryTypeRow = db
      .prepare(`SELECT name, isPrimary FROM item_types WHERE id = ? LIMIT 1`)
      .get([inv.primaryTypeId]) as { name: string; isPrimary: number };
    expect(primaryTypeRow.name.trim()).toBe('T');
    expect(primaryTypeRow.isPrimary).toBe(1);

    const ptd = db
      .prepare(
        `SELECT discountPercent FROM profile_type_discounts
         WHERE profileId = ? AND itemTypeId = ? LIMIT 1`,
      )
      .get([profileId, inv.primaryTypeId]) as { discountPercent: number };
    expect(Number(ptd.discountPercent)).toBe(10);

    const dpRow = db
      .prepare(`SELECT name, isActive FROM discount_profiles WHERE id = ?`)
      .get([profileId]) as { name: string; isActive: number };
    expect(dpRow.name).toBe('DP-FullStack');
    expect(dpRow.isActive).toBe(1);

    const header = db
      .prepare(
        `SELECT id, accountId, invoiceType, totalAmount, extraDiscount, biltyNumber, cartons
         FROM invoices WHERE id = ?`,
      )
      .get([invoiceId]) as {
      id: number;
      accountId: number;
      invoiceType: string;
      totalAmount: number;
      extraDiscount: number;
      biltyNumber: number | null;
      cartons: number | null;
    };
    expect(header.accountId).toBe(acc.primaryPartyId);
    expect(header.invoiceType).toBe('Sale');
    expect(Number(header.totalAmount)).toBe(uiTotal);
    expect(Number(header.extraDiscount)).toBe(0);
    expect(Number(header.biltyNumber)).toBe(88);
    expect(header.cartons).toBe(6);

    const lines = db
      .prepare(
        `SELECT invoiceId, inventoryId, quantity, discount, price, accountId
         FROM invoice_items WHERE invoiceId = ? ORDER BY id`,
      )
      .all([invoiceId]) as Array<{
      invoiceId: number;
      inventoryId: number;
      quantity: number;
      discount: number;
      price: number;
      accountId: number | null;
    }>;
    expect(lines).toHaveLength(1);
    expect(lines[0].inventoryId).toBe(inv.primaryItemId);
    expect(lines[0].quantity).toBe(2);
    expect(Number(lines[0].discount)).toBe(10);
    expect(Number(lines[0].price)).toBe(101);
    expect(lines[0].accountId).toBe(acc.primaryPartyId);

    const partyChart = db
      .prepare(
        `SELECT c.name AS chartName, c.type AS chartType
         FROM account a JOIN chart c ON c.id = a.chartId
         WHERE a.id = ?`,
      )
      .get([acc.primaryPartyId]) as { chartName: string; chartType: string };
    expect(partyChart.chartType).toBe('Asset');

    const saleChart = db
      .prepare(
        `SELECT c.type AS chartType FROM account a JOIN chart c ON c.id = a.chartId WHERE a.id = ?`,
      )
      .get([acc.saleAccountId]) as { chartType: string };
    expect(saleChart.chartType).toBe('Revenue');

    const jRow = db
      .prepare(
        `SELECT id, billNumber, discountPercentage, isPosted FROM journal WHERE billNumber = ? LIMIT 1`,
      )
      .get([invoiceNumber]) as {
      id: number;
      billNumber: number;
      discountPercentage: number | null;
      isPosted: number;
    };
    expect(jRow.billNumber).toBe(invoiceNumber);
    expect(Number(jRow.discountPercentage)).toBe(10);
    expect(jRow.isPosted).toBe(1);

    const { debit, credit } = getJournalEntryTotals(db, jRow.id);
    expect(debit).toBe(uiTotal);
    expect(credit).toBe(uiTotal);

    const jeAccounts = db
      .prepare(
        `SELECT accountId, debitAmount, creditAmount FROM journal_entry WHERE journalId = ? ORDER BY id`,
      )
      .all([jRow.id]) as Array<{
      accountId: number;
      debitAmount: number;
      creditAmount: number;
    }>;
    expect(jeAccounts).toHaveLength(2);
    const debitLine = jeAccounts.find((e) => Number(e.debitAmount) > 0);
    const creditLine = jeAccounts.find((e) => Number(e.creditAmount) > 0);
    expect(debitLine?.accountId).toBe(acc.primaryPartyId);
    expect(creditLine?.accountId).toBe(acc.saleAccountId);

    const partyLedgerRows = db
      .prepare(`SELECT COUNT(*) AS c FROM ledger WHERE accountId = ?`)
      .get([acc.primaryPartyId]) as { c: number };
    const saleLedgerRows = db
      .prepare(`SELECT COUNT(*) AS c FROM ledger WHERE accountId = ?`)
      .get([acc.saleAccountId]) as { c: number };
    expect(Number(partyLedgerRows.c)).toBeGreaterThanOrEqual(1);
    expect(Number(saleLedgerRows.c)).toBeGreaterThanOrEqual(1);
  });

  it('purchase: invoices + invoice_items + journal + journal_entry + inventory match a single vendor line', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();

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
    const invoiceNumber = 8452;
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Purchase' as InvoiceType,
      date: new Date('2026-04-02T12:00:00.000Z').toISOString(),
      invoiceNumber,
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

    const { invoiceId } = invoiceService.insertInvoice(
      'Purchase' as InvoiceType,
      invoice,
    );

    const header = db
      .prepare(
        `SELECT invoiceType, totalAmount, accountId FROM invoices WHERE id = ?`,
      )
      .get([invoiceId]) as {
      invoiceType: string;
      totalAmount: number;
      accountId: number;
    };
    expect(header.invoiceType).toBe('Purchase');
    expect(Number(header.totalAmount)).toBe(uiTotal);
    expect(header.accountId).toBe(acc.primaryPartyId);

    const line = db
      .prepare(
        `SELECT inventoryId, quantity, discount, price, accountId FROM invoice_items WHERE invoiceId = ?`,
      )
      .get([invoiceId]) as {
      inventoryId: number;
      quantity: number;
      discount: number;
      price: number;
      accountId: number | null;
    };
    expect(line.inventoryId).toBe(inv.primaryItemId);
    expect(line.quantity).toBe(2);
    expect(Number(line.price)).toBe(101);
    expect(line.accountId).toBe(acc.primaryPartyId);

    const qtyAfter = (
      db
        .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
        .get([inv.primaryItemId]) as { quantity: number }
    ).quantity;
    expect(qtyAfter).toBe(52);

    const jRow = db
      .prepare(`SELECT id FROM journal WHERE billNumber = ? LIMIT 1`)
      .get([invoiceNumber]) as { id: number };
    const { debit, credit } = getJournalEntryTotals(db, jRow.id);
    expect(debit).toBe(uiTotal);
    expect(credit).toBe(uiTotal);

    const je = db
      .prepare(
        `SELECT accountId, debitAmount, creditAmount FROM journal_entry WHERE journalId = ? ORDER BY id`,
      )
      .all([jRow.id]) as Array<{
      accountId: number;
      debitAmount: number;
      creditAmount: number;
    }>;
    const debitLine = je.find((e) => Number(e.debitAmount) > 0);
    const creditLine = je.find((e) => Number(e.creditAmount) > 0);
    expect(debitLine?.accountId).toBe(acc.purchaseAccountId);
    expect(creditLine?.accountId).toBe(acc.primaryPartyId);

    expect(
      Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS c FROM ledger WHERE accountId = ?`)
            .get([acc.primaryPartyId]) as { c: number }
        ).c,
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS c FROM ledger WHERE accountId = ?`)
            .get([acc.purchaseAccountId]) as { c: number }
        ).c,
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it('sale: two invoice_items on one account produce two invoice_items rows, one balanced journal, two inventory deltas', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();

    const itemA: InvoiceItem = {
      id: 1,
      inventoryId: inv.primaryItemId,
      quantity: 1,
      discount: 0,
      price: 101,
      discountedPrice: computeUiRowTotal({
        quantity: 1,
        price: 101,
        discount: 0,
      }),
    };
    const itemB: InvoiceItem = {
      id: 2,
      inventoryId: inv.otherItemId,
      quantity: 1,
      discount: 0,
      price: 99,
      discountedPrice: computeUiRowTotal({
        quantity: 1,
        price: 99,
        discount: 0,
      }),
    };
    const uiTotal = computeUiTotal([[itemA, itemB]], 0);
    const invoiceNumber = 8453;

    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-04-03T12:00:00.000Z').toISOString(),
      invoiceNumber,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: uiTotal,
      biltyNumber: '',
      cartons: 0,
      accountMapping: {
        singleAccountId: acc.primaryPartyId,
        multipleAccountIds: [],
      },
      invoiceItems: [itemA, itemB],
    };

    const { invoiceId } = invoiceService.insertInvoice(
      'Sale' as InvoiceType,
      invoice,
    );

    const lines = db
      .prepare(
        `SELECT inventoryId, quantity FROM invoice_items WHERE invoiceId = ? ORDER BY id`,
      )
      .all([invoiceId]) as Array<{ inventoryId: number; quantity: number }>;
    expect(lines).toEqual([
      { inventoryId: inv.primaryItemId, quantity: 1 },
      { inventoryId: inv.otherItemId, quantity: 1 },
    ]);

    expect(
      (
        db
          .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
          .get([inv.primaryItemId]) as { quantity: number }
      ).quantity,
    ).toBe(49);
    expect(
      (
        db
          .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
          .get([inv.otherItemId]) as { quantity: number }
      ).quantity,
    ).toBe(49);

    const jRow = db
      .prepare(`SELECT id FROM journal WHERE billNumber = ?`)
      .get([invoiceNumber]) as { id: number };
    const { debit, credit } = getJournalEntryTotals(db, jRow.id);
    expect(debit).toBe(uiTotal);
    expect(credit).toBe(uiTotal);
  });

  it('getInvoice and getInvoices reflect a single-account sale after insertInvoice', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();

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

    const { invoiceId } = invoiceService.insertInvoice(
      'Sale' as InvoiceType,
      invoice,
    );

    const view = invoiceService.getInvoice(invoiceId);
    expect(view.id).toBe(invoiceId);
    expect(view.invoiceNumber).toBe(invoiceNumber);
    expect(view.invoiceType).toBe('Sale');
    expect(Number(view.totalAmount)).toBe(uiTotal);
    expect(view.accountName).toBe('PrimaryParty');
    expect(Number(view.extraDiscount ?? 0)).toBe(0);
    expect(Number(view.biltyNumber)).toBe(55);
    expect(view.cartons).toBe(2);

    expect(view.invoiceItems).toHaveLength(1);
    const line = view.invoiceItems[0];
    expect(line.inventoryId).toBe(inv.primaryItemId);
    expect(line.quantity).toBe(2);
    expect(Number(line.discount)).toBe(5);
    expect(Number(line.price)).toBe(101);
    expect(line.inventoryItemName).toBe('ItemPrimary');
    expect(line.itemTypeName).toBe('T');
    expect(line.accountName).toBeUndefined();
    expect(Number(line.discountedPrice)).toBe(
      computeUiRowTotal({ quantity: 2, price: 101, discount: 5 }),
    );

    const list = invoiceService.getInvoices('Sale' as InvoiceType);
    const listRow = list.find((r) => r.id === invoiceId);
    expect(listRow).toBeDefined();
    expect(listRow!.invoiceNumber).toBe(invoiceNumber);
    expect(listRow!.accountName).toBe('PrimaryParty');
    expect(Number(listRow!.totalAmount)).toBe(uiTotal);
    expect(Number(listRow!.biltyNumber)).toBe(55);
    expect(listRow!.cartons).toBe(2);
    expect(Number(listRow!.linkedJournalCount)).toBeGreaterThan(0);
  });

  it('getInvoice shows per-line account names when invoice_items map to different parties', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();

    const itemA: InvoiceItem = {
      id: 1,
      inventoryId: inv.primaryItemId,
      quantity: 1,
      discount: 0,
      price: 101,
      discountedPrice: computeUiRowTotal({
        quantity: 1,
        price: 101,
        discount: 0,
      }),
    };
    const itemB: InvoiceItem = {
      id: 2,
      inventoryId: inv.otherItemId,
      quantity: 1,
      discount: 0,
      price: 99,
      discountedPrice: computeUiRowTotal({
        quantity: 1,
        price: 99,
        discount: 0,
      }),
    };
    const uiTotal = computeUiTotal([[itemA], [itemB]], 0);
    const invoiceNumber = 9202;

    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-05-02T12:00:00.000Z').toISOString(),
      invoiceNumber,
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

    const { invoiceId } = invoiceService.insertInvoice(
      'Sale' as InvoiceType,
      invoice,
    );

    const view = invoiceService.getInvoice(invoiceId);
    expect(
      String(view.accountName)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .sort(),
    ).toEqual(['PrimaryParty', 'SectionParty']);

    const byInventoryId = new Map(
      view.invoiceItems.map((row) => [row.inventoryId, row]),
    );
    expect(byInventoryId.get(inv.primaryItemId)?.accountName).toBe(
      'PrimaryParty',
    );
    expect(byInventoryId.get(inv.otherItemId)?.accountName).toBe(
      'SectionParty',
    );

    const list = invoiceService.getInvoices('Sale' as InvoiceType);
    const listRow = list.find((r) => r.id === invoiceId);
    expect(listRow).toBeDefined();
    const names = String(listRow!.accountName)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    expect(names).toEqual(['PrimaryParty', 'SectionParty']);
  });

  it('returnSaleInvoice: removes journals, restores inventory, stores trimmed reason, and marks returned', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();

    const profileId = seedDiscountProfileForAccount(
      acc.primaryPartyId,
      'DP-Primary',
    );
    pricingService.saveProfileTypeDiscounts(profileId, [
      { itemTypeId: inv.primaryTypeId, discountPercent: 10 },
    ]);

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

    const { invoiceId } = invoiceService.insertInvoice(
      'Sale' as InvoiceType,
      invoice,
    );

    const qtyBeforeReturn = (
      db
        .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
        .get([inv.primaryItemId]) as { quantity: number }
    ).quantity;

    const journalCountBefore = (
      db.prepare(`SELECT COUNT(*) as c FROM journal`).get() as { c: number }
    ).c;

    expect(journalCountBefore).toBeGreaterThan(0);
    expect(qtyBeforeReturn).toBe(48);

    invoiceService.returnSaleInvoice(invoiceId, {
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

    const view = invoiceService.getInvoice(invoiceId);
    expect(view.isReturned).toBe(true);
    expect(view.returnReason).toBe('customer changed mind');

    expect(() => invoiceService.returnSaleInvoice(invoiceId)).toThrow();
  });

  it('returnPurchaseInvoice: removes journals, reduces inventory to pre-purchase level, stores reason, marks returned', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();

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
      date: new Date('2026-06-01T12:00:00.000Z').toISOString(),
      invoiceNumber: 93001,
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

    const { invoiceId } = invoiceService.insertInvoice(
      'Purchase' as InvoiceType,
      invoice,
    );

    const qtyAfterPurchase = (
      db
        .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
        .get([inv.primaryItemId]) as { quantity: number }
    ).quantity;
    expect(qtyAfterPurchase).toBe(52);

    const journalCountBefore = (
      db.prepare(`SELECT COUNT(*) as c FROM journal`).get() as { c: number }
    ).c;
    expect(journalCountBefore).toBeGreaterThan(0);

    invoiceService.returnPurchaseInvoice(invoiceId, {
      returnReason: '  defective stock  ',
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
    expect(returnedRow.returnReason).toBe('defective stock');

    const view = invoiceService.getInvoice(invoiceId);
    expect(view.isReturned).toBe(true);
    expect(view.returnReason).toBe('defective stock');

    expect(() => invoiceService.returnPurchaseInvoice(invoiceId)).toThrow();
  });

  it('returnPurchaseInvoice: throws when invoice is a sale', () => {
    const acc = seedBaseAccounts();
    const inv = seedInventoryAndTypes();
    const items: InvoiceItem[] = [
      {
        id: 1,
        inventoryId: inv.primaryItemId,
        quantity: 1,
        discount: 0,
        price: 101,
        discountedPrice: 101,
      },
    ];
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-06-02T12:00:00.000Z').toISOString(),
      invoiceNumber: 94001,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 101,
      biltyNumber: '',
      cartons: 0,
      accountMapping: {
        singleAccountId: acc.primaryPartyId,
        multipleAccountIds: [],
      },
      invoiceItems: items,
    };
    const { invoiceId } = invoiceService.insertInvoice(
      'Sale' as InvoiceType,
      invoice,
    );
    expect(() => invoiceService.returnPurchaseInvoice(invoiceId, {})).toThrow();
  });
});
