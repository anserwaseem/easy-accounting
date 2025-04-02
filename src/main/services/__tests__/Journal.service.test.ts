import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { MigrationRunner } from '../../migrations';
import {
  Journal,
  BalanceType,
  JournalEntry,
  InsertAccount,
  UserCredentials,
} from '../../../types';
import {
  AccountService,
  AuthService,
  DatabaseService,
  JournalService,
  LedgerService,
} from '..';

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

const defaultAccountFields = {
  code: undefined,
  address: undefined,
  phone1: undefined,
  phone2: undefined,
  goodsName: undefined,
};

describe('Journal Posting', () => {
  let journalService: JournalService;
  let ledgerService: LedgerService;
  let accountService: AccountService;
  let authService: AuthService;
  let db: Database.Database;

  beforeEach(async () => {
    // Use in-memory database for testing
    db = new Database(':memory:');

    // Override the DatabaseService to use our in-memory database
    jest.spyOn(DatabaseService, 'getInstance').mockImplementation(
      () =>
        ({
          getDatabase: () => db,
        }) as any,
    );

    // Read and execute the schema SQL
    const schemaPath = path.join(__dirname, '../../../sql/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSql);

    // Run migrations (if any) and wait for them to complete
    const migrationRunner = new MigrationRunner();
    await migrationRunner.waitForMigrations();

    // Initialize services
    journalService = new JournalService();
    ledgerService = new LedgerService();
    accountService = new AccountService();
    authService = new AuthService();

    // Register a test user
    authService.register(TEST_DB_USER);
  });

  it('should correctly update ledger balances for multiple debit/credit entries', () => {
    // Create test accounts
    const accounts: InsertAccount[] = [
      { name: 'Cash', headName: 'Current Asset' },
      {
        name: 'Accounts Receivable',
        headName: 'Current Asset',
      },
      { name: 'Sale', headName: 'Revenue', code: 10 },
      { name: 'Inventory', headName: 'Current Asset' },
      {
        name: 'Accounts Payable',
        headName: 'Current Liability',
      },
      { name: 'Bank', headName: 'Current Asset' },
    ].map((account) => ({
      ...account,
      ...defaultAccountFields,
    }));
    accounts.forEach((account) => accountService.insertAccount(account));

    // First journal entry: Sale on credit (one debit, one credit)
    const journal1: Journal = {
      id: 1,
      date: new Date().toISOString(),
      narration: 'Sale on credit',
      isPosted: true,
      journalEntries: [
        { journalId: 1, accountId: 2, debitAmount: 1000, creditAmount: 0 },
        { journalId: 1, accountId: 3, debitAmount: 0, creditAmount: 1000 },
      ] as JournalEntry[],
    };

    console.log('Posting first journal');
    journalService.insertJournal(journal1);

    const arLedger1 = ledgerService.getLedger(2);
    const salesLedger1 = ledgerService.getLedger(3);

    console.log('AR Ledger after first posting:', arLedger1);
    console.log('Sales Ledger after first posting:', salesLedger1);

    expect(arLedger1.at(-1)!.balance).toBe(1000);
    expect(arLedger1.at(-1)!.balanceType).toBe(BalanceType.Dr);
    expect(salesLedger1.at(-1)!.balance).toBe(1000);
    expect(salesLedger1.at(-1)!.balanceType).toBe(BalanceType.Cr);

    // Second journal entry (a): Multiple debits, one credit
    const journal2a: Journal = {
      id: 2,
      date: new Date().toISOString(),
      narration: 'Purchase of inventory on account',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 4, debitAmount: 800, creditAmount: 0 },
        { journalId: 2, accountId: 1, debitAmount: 200, creditAmount: 0 },
        { journalId: 2, accountId: 5, debitAmount: 0, creditAmount: 1000 },
      ] as JournalEntry[],
    };

    console.log('Posting journal 2a');
    journalService.insertJournal(journal2a);

    const cashLedger2 = ledgerService.getLedger(1);
    const inventoryLedger2 = ledgerService.getLedger(4);
    const apLedger2 = ledgerService.getLedger(5);

    console.log('Cash Ledger after 2a:', cashLedger2);
    console.log('Inventory Ledger after 2a:', inventoryLedger2);
    console.log('AP Ledger after 2a:', apLedger2);

    expect(cashLedger2.at(-1)!.balance).toBe(200);
    expect(cashLedger2.at(-1)!.balanceType).toBe(BalanceType.Dr);
    expect(inventoryLedger2.at(-1)!.balance).toBe(800);
    expect(inventoryLedger2.at(-1)!.balanceType).toBe(BalanceType.Dr);
    expect(apLedger2.at(-1)!.balance).toBe(1000);
    expect(apLedger2.at(-1)!.balanceType).toBe(BalanceType.Cr);

    // Third journal entry: Payment to creditors
    const journal3: Journal = {
      id: 3,
      date: new Date().toISOString(),
      narration: 'Payment to creditors',
      isPosted: true,
      journalEntries: [
        { journalId: 3, accountId: 5, debitAmount: 600, creditAmount: 0 },
        { journalId: 3, accountId: 1, debitAmount: 0, creditAmount: 400 },
        { journalId: 3, accountId: 2, debitAmount: 0, creditAmount: 200 },
      ] as JournalEntry[],
    };

    console.log('Posting third journal');
    journalService.insertJournal(journal3);

    const cashLedger3 = ledgerService.getLedger(1);
    const arLedger3 = ledgerService.getLedger(2);
    const apLedger3 = ledgerService.getLedger(5);

    console.log('Cash Ledger after third posting:', cashLedger3);
    console.log('AR Ledger after third posting:', arLedger3);
    console.log('AP Ledger after third posting:', apLedger3);

    expect(cashLedger3.at(-1)!.balance).toBe(200);
    expect(cashLedger3.at(-1)!.balanceType).toBe(BalanceType.Cr);

    expect(arLedger3.at(-1)!.balance).toBe(800);
    expect(arLedger3.at(-1)!.balanceType).toBe(BalanceType.Dr);

    expect(apLedger3.at(-1)!.balance).toBe(400);
    expect(apLedger3.at(-1)!.balanceType).toBe(BalanceType.Cr);

    // Fourth journal entry: Sales return
    const journal4: Journal = {
      id: 4,
      date: new Date().toISOString(),
      narration: 'Product returned by customer',
      isPosted: true,
      journalEntries: [
        { journalId: 4, accountId: 3, debitAmount: 1000, creditAmount: 0 },
        { journalId: 4, accountId: 2, debitAmount: 0, creditAmount: 800 },
        { journalId: 4, accountId: 1, debitAmount: 0, creditAmount: 200 },
      ] as JournalEntry[],
    };

    console.log('Posting fourth journal');
    journalService.insertJournal(journal4);

    const salesLedger4 = ledgerService.getLedger(3);
    const arLedger4 = ledgerService.getLedger(2);
    const cashLedger4 = ledgerService.getLedger(1);

    console.log('Sales Ledger after fourth posting:', salesLedger4);
    console.log('AR Ledger after fourth posting:', arLedger4);
    console.log('Cash Ledger after fourth posting:', cashLedger4);

    expect(salesLedger4.at(-1)!.balance).toBe(0);
    expect(salesLedger4.at(-1)!.balanceType).toBe(BalanceType.Cr);
    expect(arLedger4.at(-1)!.balance).toBe(0);
    expect(arLedger4.at(-1)!.balanceType).toBe(BalanceType.Dr);
    expect(cashLedger4.at(-1)!.balance).toBe(0);
    expect(cashLedger4.at(-1)!.balanceType).toBe(BalanceType.Dr);

    // Second journal entry (b): Sale via cash and bank
    const journal2b: Journal = {
      id: 2,
      date: new Date().toISOString(),
      narration: 'Sale via cash and bank',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 400, creditAmount: 0 }, // Cash debit
        { journalId: 2, accountId: 6, debitAmount: 600, creditAmount: 0 }, // Bank debit
        { journalId: 2, accountId: 3, debitAmount: 0, creditAmount: 1000 }, // Sales credit
      ] as JournalEntry[],
    };

    console.log('Posting journal 2b');
    journalService.insertJournal(journal2b);

    const cashLedger2b = ledgerService.getLedger(1);
    const bankLedger2b = ledgerService.getLedger(6);
    const salesLedger2b = ledgerService.getLedger(3);

    console.log('Cash Ledger after 2b:', cashLedger2b);
    console.log('Bank Ledger after 2b:', bankLedger2b);
    console.log('Sales Ledger after 2b:', salesLedger2b);

    expect(cashLedger2b.at(-1)!.balance).toBe(400);
    expect(cashLedger2b.at(-1)!.balanceType).toBe(BalanceType.Dr);
    expect(bankLedger2b.at(-1)!.balance).toBe(600);
    expect(bankLedger2b.at(-1)!.balanceType).toBe(BalanceType.Dr);
    expect(salesLedger2b.at(-1)!.balance).toBe(1000);
    expect(salesLedger2b.at(-1)!.balanceType).toBe(BalanceType.Cr);

    // Second journal entry (c): Return of sale made in 2b
    const journal2c: Journal = {
      id: 3,
      date: new Date().toISOString(),
      narration: 'Return of sale made via cash and bank',
      isPosted: true,
      journalEntries: [
        { journalId: 3, accountId: 3, debitAmount: 1000, creditAmount: 0 }, // Sales debit (reversing revenue)
        { journalId: 3, accountId: 1, debitAmount: 0, creditAmount: 400 }, // Cash credit (paying back cash)
        { journalId: 3, accountId: 6, debitAmount: 0, creditAmount: 600 }, // Bank credit (refunding bank amount)
      ] as JournalEntry[],
    };

    console.log('Posting journal 2c');
    journalService.insertJournal(journal2c);

    const cashLedger2c = ledgerService.getLedger(1);
    const bankLedger2c = ledgerService.getLedger(6);
    const salesLedger2c = ledgerService.getLedger(3);

    console.log('Cash Ledger after 2c:', cashLedger2c);
    console.log('Bank Ledger after 2c:', bankLedger2c);
    console.log('Sales Ledger after 2c:', salesLedger2c);

    expect(cashLedger2c.at(-1)!.balance).toBe(0);
    expect(bankLedger2c.at(-1)!.balance).toBe(0);
    expect(salesLedger2c.at(-1)!.balance).toBe(0);
  });

  it('should correctly update ledger balances when inserting a journal with a past date', () => {
    // Create test accounts
    const accounts: InsertAccount[] = [
      { name: 'Cash', headName: 'Current Asset' },
      { name: 'Sale', headName: 'Revenue' },
    ].map((account) => ({
      ...account,
      ...defaultAccountFields,
    }));
    accounts.forEach((account) => accountService.insertAccount(account));

    // First journal entry: Current date
    const currentDate = new Date();
    const journal1: Journal = {
      id: 1,
      date: currentDate.toISOString(),
      narration: 'New day! New sale!',
      isPosted: true,
      journalEntries: [
        { journalId: 1, accountId: 1, debitAmount: 200, creditAmount: 0 },
        { journalId: 1, accountId: 2, debitAmount: 0, creditAmount: 200 },
      ] as JournalEntry[],
    };

    console.log('Posting first journal');
    journalService.insertJournal(journal1);

    // Check balances after first posting
    const cashLedger1 = ledgerService.getLedger(1);
    const salesLedger1 = ledgerService.getLedger(2);
    console.log('Cash Ledger after first posting:', cashLedger1);
    console.log('Sales Ledger after first posting:', salesLedger1);

    // Verify Cash ledger after first posting
    expect(cashLedger1).toHaveLength(1);
    expect(new Date(cashLedger1.at(-1)!.date)).toEqual(currentDate);
    expect(cashLedger1.at(-1)!.debit).toBe(200);
    expect(cashLedger1.at(-1)!.balance).toBe(200);
    expect(cashLedger1.at(-1)!.balanceType).toBe(BalanceType.Dr);

    // Verify Sales ledger after first posting
    expect(salesLedger1).toHaveLength(1);
    expect(new Date(salesLedger1.at(-1)!.date)).toEqual(currentDate);
    expect(salesLedger1.at(-1)!.credit).toBe(200);
    expect(salesLedger1.at(-1)!.balance).toBe(200);
    expect(salesLedger1.at(-1)!.balanceType).toBe(BalanceType.Cr);

    // Second journal entry: Past date
    const pastDate = new Date(currentDate);
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
    const journal2: Journal = {
      id: 2,
      date: pastDate.toISOString(),
      narration: 'Oops! forgot this sale happened 5 days ago',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 150, creditAmount: 0 },
        { journalId: 2, accountId: 2, debitAmount: 0, creditAmount: 150 },
      ] as JournalEntry[],
    };

    console.log('Posting second journal');
    journalService.insertJournal(journal2);

    // Verify ledger entries after second posting
    const cashLedger2 = ledgerService.getLedger(1);
    const salesLedger2 = ledgerService.getLedger(2);
    console.log('Cash Ledger after first posting:', cashLedger2);
    console.log('Sales Ledger after first posting:', salesLedger2);

    // Check Cash ledger
    expect(cashLedger2).toHaveLength(2);
    expect(new Date(cashLedger2.at(-1)!.date)).toEqual(currentDate);
    expect(cashLedger2.at(-1)!.debit).toBe(200);
    expect(cashLedger2.at(-1)!.balance).toBe(350);
    expect(cashLedger2.at(-1)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger2.at(-2)!.date)).toEqual(pastDate);
    expect(cashLedger2.at(-2)!.debit).toBe(150);
    expect(cashLedger2.at(-2)!.balance).toBe(150);
    expect(cashLedger2.at(-2)!.balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger
    expect(salesLedger2).toHaveLength(2);
    expect(new Date(salesLedger2.at(-1)!.date)).toEqual(currentDate);
    expect(salesLedger2.at(-1)!.credit).toBe(200);
    expect(salesLedger2.at(-1)!.balance).toBe(350);
    expect(salesLedger2.at(-1)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger2.at(-2)!.date)).toEqual(pastDate);
    expect(salesLedger2.at(-2)!.credit).toBe(150);
    expect(salesLedger2.at(-2)!.balance).toBe(150);
    expect(salesLedger2.at(-2)!.balanceType).toBe(BalanceType.Cr);
  });

  it('should correctly update ledger entries when journal with past date is posted', () => {
    // Create test accounts
    const accounts: InsertAccount[] = [
      { name: 'Cash', headName: 'Current Asset' },
      { name: 'Sale', headName: 'Revenue' },
      { name: 'Bank', headName: 'Current Asset' },
    ].map((account) => ({
      ...account,
      ...defaultAccountFields,
    }));
    accounts.forEach((account) => accountService.insertAccount(account));

    // First journal entry
    const date18 = new Date('01/18/2024');
    const journal1: Journal = {
      id: 1,
      date: date18.toISOString(),
      narration: '18/01',
      isPosted: true,
      journalEntries: [
        { journalId: 1, accountId: 1, debitAmount: 200, creditAmount: 0 },
        { journalId: 1, accountId: 2, debitAmount: 0, creditAmount: 200 },
      ] as JournalEntry[],
    };

    console.log('Posting first journal');
    journalService.insertJournal(journal1);

    // Check balances after first posting
    const cashLedger1 = ledgerService.getLedger(1);
    const salesLedger1 = ledgerService.getLedger(2);
    console.log('Cash Ledger after first posting:', cashLedger1);
    console.log('Sales Ledger after first posting:', salesLedger1);

    // Verify Cash ledger after first posting
    expect(cashLedger1).toHaveLength(1);
    expect(new Date(cashLedger1.at(-1)!.date)).toEqual(date18);
    expect(cashLedger1.at(-1)!.debit).toBe(200);
    expect(cashLedger1.at(-1)!.balance).toBe(200);
    expect(cashLedger1.at(-1)!.balanceType).toBe(BalanceType.Dr);

    // Verify Sales ledger after first posting
    expect(salesLedger1).toHaveLength(1);
    expect(new Date(salesLedger1.at(-1)!.date)).toEqual(date18);
    expect(salesLedger1.at(-1)!.credit).toBe(200);
    expect(salesLedger1.at(-1)!.balance).toBe(200);
    expect(salesLedger1.at(-1)!.balanceType).toBe(BalanceType.Cr);

    // Second journal entry
    const date15 = new Date('01/15/2024');
    const journal2: Journal = {
      id: 2,
      date: date15.toISOString(),
      narration: 'Oops! forgot this sale happened 5 days ago',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 150, creditAmount: 0 },
        { journalId: 2, accountId: 2, debitAmount: 0, creditAmount: 150 },
      ] as JournalEntry[],
    };

    console.log('Posting second journal');
    journalService.insertJournal(journal2);

    // Verify ledger entries after second posting
    const cashLedger2 = ledgerService.getLedger(1);
    const salesLedger2 = ledgerService.getLedger(2);
    console.log('Cash Ledger after first posting:', cashLedger2);
    console.log('Sales Ledger after first posting:', salesLedger2);

    // Check Cash ledger
    expect(cashLedger2).toHaveLength(2);
    expect(new Date(cashLedger2.at(-1)!.date)).toEqual(date18);
    expect(cashLedger2.at(-1)!.debit).toBe(200);
    expect(cashLedger2.at(-1)!.balance).toBe(350);
    expect(cashLedger2.at(-1)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger2.at(-2)!.date)).toEqual(date15);
    expect(cashLedger2.at(-2)!.debit).toBe(150);
    expect(cashLedger2.at(-2)!.balance).toBe(150);
    expect(cashLedger2.at(-2)!.balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger
    expect(salesLedger2).toHaveLength(2);
    expect(new Date(salesLedger2.at(-1)!.date)).toEqual(date18);
    expect(salesLedger2.at(-1)!.credit).toBe(200);
    expect(salesLedger2.at(-1)!.balance).toBe(350);
    expect(salesLedger2.at(-1)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger2.at(-2)!.date)).toEqual(date15);
    expect(salesLedger2.at(-2)!.credit).toBe(150);
    expect(salesLedger2.at(-2)!.balance).toBe(150);
    expect(salesLedger2.at(-2)!.balanceType).toBe(BalanceType.Cr);

    // Third journal entry
    const date17 = new Date('01/17/2024');
    const journal3: Journal = {
      id: 2,
      date: date17.toISOString(),
      narration: '17/01',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 250, creditAmount: 0 },
        { journalId: 2, accountId: 2, debitAmount: 0, creditAmount: 250 },
      ] as JournalEntry[],
    };

    console.log('Posting third journal');
    journalService.insertJournal(journal3);

    // Verify ledger entries after third posting
    const cashLedger3 = ledgerService.getLedger(1);
    const salesLedger3 = ledgerService.getLedger(2);
    console.log('Cash Ledger after third posting:', cashLedger3);
    console.log('Sales Ledger after third posting:', salesLedger3);

    // Check Cash ledger
    expect(cashLedger3).toHaveLength(3);
    expect(new Date(cashLedger3.at(-1)!.date)).toEqual(date18);
    expect(cashLedger3.at(-1)!.debit).toBe(200);
    expect(cashLedger3.at(-1)!.balance).toBe(600);
    expect(cashLedger3.at(-1)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger3.at(-2)!.date)).toEqual(date17);
    expect(cashLedger3.at(-2)!.debit).toBe(250);
    expect(cashLedger3.at(-2)!.balance).toBe(400);
    expect(cashLedger3.at(-2)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger3.at(-3)!.date)).toEqual(date15);
    expect(cashLedger3.at(-3)!.debit).toBe(150);
    expect(cashLedger3.at(-3)!.balance).toBe(150);
    expect(cashLedger3.at(-3)!.balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger
    expect(salesLedger3).toHaveLength(3);
    expect(new Date(salesLedger3.at(-1)!.date)).toEqual(date18);
    expect(salesLedger3.at(-1)!.credit).toBe(200);
    expect(salesLedger3.at(-1)!.balance).toBe(600);
    expect(salesLedger3.at(-1)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger3.at(-2)!.date)).toEqual(date17);
    expect(salesLedger3.at(-2)!.credit).toBe(250);
    expect(salesLedger3.at(-2)!.balance).toBe(400);
    expect(salesLedger3.at(-2)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger3.at(-3)!.date)).toEqual(date15);
    expect(salesLedger3.at(-3)!.credit).toBe(150);
    expect(salesLedger3.at(-3)!.balance).toBe(150);
    expect(salesLedger3.at(-3)!.balanceType).toBe(BalanceType.Cr);

    // Fourth journal entry
    const date19 = new Date('01/19/2024');
    const journal4: Journal = {
      id: 2,
      date: date19.toISOString(),
      narration: '19/01',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 100, creditAmount: 0 },
        { journalId: 2, accountId: 2, debitAmount: 0, creditAmount: 100 },
      ] as JournalEntry[],
    };

    console.log('Posting fourth journal');
    journalService.insertJournal(journal4);

    // Verify ledger entries after fourth posting
    const cashLedger4 = ledgerService.getLedger(1);
    const salesLedger4 = ledgerService.getLedger(2);
    console.log('Cash Ledger after fourth posting:', cashLedger4);
    console.log('Sales Ledger after fourth posting:', salesLedger4);

    // Check Cash ledger
    expect(cashLedger4).toHaveLength(4);
    expect(new Date(cashLedger4.at(-1)!.date)).toEqual(date19);
    expect(cashLedger4.at(-1)!.debit).toBe(100);
    expect(cashLedger4.at(-1)!.balance).toBe(700);
    expect(cashLedger4.at(-1)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger4.at(-2)!.date)).toEqual(date18);
    expect(cashLedger4.at(-2)!.debit).toBe(200);
    expect(cashLedger4.at(-2)!.balance).toBe(600);
    expect(cashLedger4.at(-2)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger4.at(-3)!.date)).toEqual(date17);
    expect(cashLedger4.at(-3)!.debit).toBe(250);
    expect(cashLedger4.at(-3)!.balance).toBe(400);
    expect(cashLedger4.at(-3)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger4.at(-4)!.date)).toEqual(date15);
    expect(cashLedger4.at(-4)!.debit).toBe(150);
    expect(cashLedger4.at(-4)!.balance).toBe(150);
    expect(cashLedger4.at(-4)!.balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger
    expect(salesLedger4).toHaveLength(4);
    expect(new Date(salesLedger4.at(-1)!.date)).toEqual(date19);
    expect(salesLedger4.at(-1)!.credit).toBe(100);
    expect(salesLedger4.at(-1)!.balance).toBe(700);
    expect(salesLedger4.at(-1)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger4.at(-2)!.date)).toEqual(date18);
    expect(salesLedger4.at(-2)!.credit).toBe(200);
    expect(salesLedger4.at(-2)!.balance).toBe(600);
    expect(salesLedger4.at(-2)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger4.at(-3)!.date)).toEqual(date17);
    expect(salesLedger4.at(-3)!.credit).toBe(250);
    expect(salesLedger4.at(-3)!.balance).toBe(400);
    expect(salesLedger4.at(-3)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger4.at(-4)!.date)).toEqual(date15);
    expect(salesLedger4.at(-4)!.credit).toBe(150);
    expect(salesLedger4.at(-4)!.balance).toBe(150);
    expect(salesLedger4.at(-4)!.balanceType).toBe(BalanceType.Cr);

    // Fifth journal entry
    const date01 = new Date('01/01/2024');
    const journal5: Journal = {
      id: 5,
      date: date01.toISOString(),
      narration: '01/01',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 100, creditAmount: 0 },
        { journalId: 2, accountId: 3, debitAmount: 200, creditAmount: 0 },
        { journalId: 2, accountId: 2, debitAmount: 0, creditAmount: 300 },
      ] as JournalEntry[],
    };

    console.log('Posting fifth journal');
    journalService.insertJournal(journal5);

    // Verify ledger entries after fifth posting
    const cashLedger5 = ledgerService.getLedger(1);
    const salesLedger5 = ledgerService.getLedger(2);
    const bankLedger5 = ledgerService.getLedger(3);
    console.log('Cash Ledger after fifth posting:', cashLedger5);
    console.log('Sales Ledger after fifth posting:', salesLedger5);
    console.log('Bank Ledger after fifth posting:', bankLedger5);

    // Check Cash ledger
    expect(cashLedger5).toHaveLength(5);
    expect(new Date(cashLedger5.at(0)!.date)).toEqual(date01);
    expect(cashLedger5.at(0)!.debit).toBe(100);
    expect(cashLedger5.at(0)!.balance).toBe(100);
    expect(cashLedger5.at(0)!.balanceType).toBe(BalanceType.Dr);

    // Check Bank ledger
    expect(bankLedger5).toHaveLength(1);
    expect(new Date(bankLedger5.at(0)!.date)).toEqual(date01);
    expect(bankLedger5.at(0)!.debit).toBe(200);
    expect(bankLedger5.at(0)!.balance).toBe(200);
    expect(bankLedger5.at(0)!.balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger
    expect(salesLedger5).toHaveLength(6);
    expect(new Date(salesLedger5.at(0)!.date)).toEqual(date01);
    expect(salesLedger5.at(0)!.credit).toBe(100);
    expect(salesLedger5.at(0)!.balance).toBe(100);
    expect(salesLedger5.at(0)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger5.at(1)!.date)).toEqual(date01);
    expect(salesLedger5.at(1)!.credit).toBe(200);
    expect(salesLedger5.at(1)!.balance).toBe(300);
    expect(salesLedger5.at(1)!.balanceType).toBe(BalanceType.Cr);
  });

  it('should correctly update ledger when journal with current & past date is posted', () => {
    // Create test accounts
    const accounts: InsertAccount[] = [
      { name: 'Cash', headName: 'Current Asset' },
      { name: 'Sale', headName: 'Revenue' },
      { name: 'Bank', headName: 'Current Asset' },
    ].map((account) => ({
      ...account,
      ...defaultAccountFields,
    }));
    accounts.forEach((account) => accountService.insertAccount(account));

    // First journal entry
    const date18 = new Date('01/18/2024');
    const journal1: Journal = {
      id: 1,
      date: date18.toISOString(),
      narration: '18/01',
      isPosted: true,
      journalEntries: [
        { journalId: 1, accountId: 1, debitAmount: 200, creditAmount: 0 },
        { journalId: 1, accountId: 2, debitAmount: 0, creditAmount: 200 },
      ] as JournalEntry[],
    };

    console.log('Posting first journal');
    journalService.insertJournal(journal1);

    // Check balances after first posting
    const cashLedger1 = ledgerService.getLedger(1);
    const salesLedger1 = ledgerService.getLedger(2);
    console.log('Cash Ledger after first posting:', cashLedger1);
    console.log('Sales Ledger after first posting:', salesLedger1);

    // Verify Cash ledger after first posting
    expect(cashLedger1).toHaveLength(1);
    expect(new Date(cashLedger1.at(-1)!.date)).toEqual(date18);
    expect(cashLedger1.at(-1)!.debit).toBe(200);
    expect(cashLedger1.at(-1)!.balance).toBe(200);
    expect(cashLedger1.at(-1)!.balanceType).toBe(BalanceType.Dr);

    // Verify Sales ledger after first posting
    expect(salesLedger1).toHaveLength(1);
    expect(new Date(salesLedger1.at(-1)!.date)).toEqual(date18);
    expect(salesLedger1.at(-1)!.credit).toBe(200);
    expect(salesLedger1.at(-1)!.balance).toBe(200);
    expect(salesLedger1.at(-1)!.balanceType).toBe(BalanceType.Cr);

    // Second journal entry
    const date15 = new Date('01/15/2024');
    const journal2: Journal = {
      id: 2,
      date: date15.toISOString(),
      narration: 'Oops! forgot this sale happened 5 days ago',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 150, creditAmount: 0 },
        { journalId: 2, accountId: 2, debitAmount: 0, creditAmount: 150 },
      ] as JournalEntry[],
    };

    console.log('Posting second journal');
    journalService.insertJournal(journal2);

    // Verify ledger entries after second posting
    const cashLedger2 = ledgerService.getLedger(1);
    const salesLedger2 = ledgerService.getLedger(2);
    console.log('Cash Ledger after first posting:', cashLedger2);
    console.log('Sales Ledger after first posting:', salesLedger2);

    // Check Cash ledger
    expect(cashLedger2).toHaveLength(2);
    expect(new Date(cashLedger2.at(-1)!.date)).toEqual(date18);
    expect(cashLedger2.at(-1)!.debit).toBe(200);
    expect(cashLedger2.at(-1)!.balance).toBe(350);
    expect(cashLedger2.at(-1)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger2.at(-2)!.date)).toEqual(date15);
    expect(cashLedger2.at(-2)!.debit).toBe(150);
    expect(cashLedger2.at(-2)!.balance).toBe(150);
    expect(cashLedger2.at(-2)!.balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger
    expect(salesLedger2).toHaveLength(2);
    expect(new Date(salesLedger2.at(-1)!.date)).toEqual(date18);
    expect(salesLedger2.at(-1)!.credit).toBe(200);
    expect(salesLedger2.at(-1)!.balance).toBe(350);
    expect(salesLedger2.at(-1)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger2.at(-2)!.date)).toEqual(date15);
    expect(salesLedger2.at(-2)!.credit).toBe(150);
    expect(salesLedger2.at(-2)!.balance).toBe(150);
    expect(salesLedger2.at(-2)!.balanceType).toBe(BalanceType.Cr);

    // Third journal entry
    const date17 = new Date('01/17/2024');
    const journal3: Journal = {
      id: 2,
      date: date17.toISOString(),
      narration: '17/01',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 250, creditAmount: 0 },
        { journalId: 2, accountId: 2, debitAmount: 0, creditAmount: 250 },
      ] as JournalEntry[],
    };

    console.log('Posting third journal');
    journalService.insertJournal(journal3);

    // Verify ledger entries after third posting
    const cashLedger3 = ledgerService.getLedger(1);
    const salesLedger3 = ledgerService.getLedger(2);
    console.log('Cash Ledger after third posting:', cashLedger3);
    console.log('Sales Ledger after third posting:', salesLedger3);

    // Check Cash ledger
    expect(cashLedger3).toHaveLength(3);
    expect(new Date(cashLedger3.at(-1)!.date)).toEqual(date18);
    expect(cashLedger3.at(-1)!.debit).toBe(200);
    expect(cashLedger3.at(-1)!.balance).toBe(600);
    expect(cashLedger3.at(-1)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger3.at(-2)!.date)).toEqual(date17);
    expect(cashLedger3.at(-2)!.debit).toBe(250);
    expect(cashLedger3.at(-2)!.balance).toBe(400);
    expect(cashLedger3.at(-2)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger3.at(-3)!.date)).toEqual(date15);
    expect(cashLedger3.at(-3)!.debit).toBe(150);
    expect(cashLedger3.at(-3)!.balance).toBe(150);
    expect(cashLedger3.at(-3)!.balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger
    expect(salesLedger3).toHaveLength(3);
    expect(new Date(salesLedger3.at(-1)!.date)).toEqual(date18);
    expect(salesLedger3.at(-1)!.credit).toBe(200);
    expect(salesLedger3.at(-1)!.balance).toBe(600);
    expect(salesLedger3.at(-1)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger3.at(-2)!.date)).toEqual(date17);
    expect(salesLedger3.at(-2)!.credit).toBe(250);
    expect(salesLedger3.at(-2)!.balance).toBe(400);
    expect(salesLedger3.at(-2)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger3.at(-3)!.date)).toEqual(date15);
    expect(salesLedger3.at(-3)!.credit).toBe(150);
    expect(salesLedger3.at(-3)!.balance).toBe(150);
    expect(salesLedger3.at(-3)!.balanceType).toBe(BalanceType.Cr);

    // Fourth journal entry
    const date19 = new Date('01/19/2024');
    const journal4: Journal = {
      id: 22,
      date: date19.toISOString(),
      narration: '19/01',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 50, creditAmount: 0 },
        { journalId: 2, accountId: 3, debitAmount: 50, creditAmount: 0 },
        { journalId: 2, accountId: 2, debitAmount: 0, creditAmount: 100 },
      ] as JournalEntry[],
    };

    console.log('Posting fourth journal');
    journalService.insertJournal(journal4);

    // Verify ledger entries after fourth posting
    const cashLedger4 = ledgerService.getLedger(1);
    const salesLedger4 = ledgerService.getLedger(2);
    const bankLedger4 = ledgerService.getLedger(3);
    console.log('Cash Ledger after fourth posting:', cashLedger4);
    console.log('Sales Ledger after fourth posting:', salesLedger4);
    console.log('Bank Ledger after fourth posting:', bankLedger4);

    // Check Bank ledger
    expect(bankLedger4).toHaveLength(1);
    expect(new Date(bankLedger4.at(0)!.date)).toEqual(date19);
    expect(bankLedger4.at(0)!.debit).toBe(50);
    expect(bankLedger4.at(0)!.balance).toBe(50);
    expect(bankLedger4.at(0)!.balanceType).toBe(BalanceType.Dr);

    // Check Cash ledger
    expect(cashLedger4).toHaveLength(4);
    expect(new Date(cashLedger4.at(-1)!.date)).toEqual(date19);
    expect(cashLedger4.at(-1)!.debit).toBe(50);
    expect(cashLedger4.at(-1)!.balance).toBe(650);
    expect(cashLedger4.at(-1)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger4.at(-2)!.date)).toEqual(date18);
    expect(cashLedger4.at(-2)!.debit).toBe(200);
    expect(cashLedger4.at(-2)!.balance).toBe(600);
    expect(cashLedger4.at(-2)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger4.at(-3)!.date)).toEqual(date17);
    expect(cashLedger4.at(-3)!.debit).toBe(250);
    expect(cashLedger4.at(-3)!.balance).toBe(400);
    expect(cashLedger4.at(-3)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger4.at(-4)!.date)).toEqual(date15);
    expect(cashLedger4.at(-4)!.debit).toBe(150);
    expect(cashLedger4.at(-4)!.balance).toBe(150);
    expect(cashLedger4.at(-4)!.balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger
    expect(salesLedger4).toHaveLength(5);
    expect(new Date(salesLedger4.at(-1)!.date)).toEqual(date19);
    expect(salesLedger4.at(-1)!.credit).toBe(50);
    expect(salesLedger4.at(-1)!.balance).toBe(700);
    expect(salesLedger4.at(-1)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger4.at(-2)!.date)).toEqual(date19);
    expect(salesLedger4.at(-2)!.credit).toBe(50);
    expect(salesLedger4.at(-2)!.balance).toBe(650);
    expect(salesLedger4.at(-2)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger4.at(-3)!.date)).toEqual(date18);
    expect(salesLedger4.at(-3)!.credit).toBe(200);
    expect(salesLedger4.at(-3)!.balance).toBe(600);
    expect(salesLedger4.at(-3)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger4.at(-4)!.date)).toEqual(date17);
    expect(salesLedger4.at(-4)!.credit).toBe(250);
    expect(salesLedger4.at(-4)!.balance).toBe(400);
    expect(salesLedger4.at(-4)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger4.at(-5)!.date)).toEqual(date15);
    expect(salesLedger4.at(-5)!.credit).toBe(150);
    expect(salesLedger4.at(-5)!.balance).toBe(150);
    expect(salesLedger4.at(-5)!.balanceType).toBe(BalanceType.Cr);

    // Fifth journal entry
    const date01 = new Date('01/01/2024');
    const journal5: Journal = {
      id: 5,
      date: date01.toISOString(),
      narration: '01/01',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 100, creditAmount: 0 },
        { journalId: 2, accountId: 3, debitAmount: 200, creditAmount: 0 },
        { journalId: 2, accountId: 2, debitAmount: 0, creditAmount: 300 },
      ] as JournalEntry[],
    };

    console.log('Posting fifth journal');
    journalService.insertJournal(journal5);

    // Verify ledger entries after fifth posting
    const cashLedger5 = ledgerService.getLedger(1);
    const salesLedger5 = ledgerService.getLedger(2);
    const bankLedger5 = ledgerService.getLedger(3);
    console.log('Cash Ledger after fifth posting:', cashLedger5);
    console.log('Sales Ledger after fifth posting:', salesLedger5);
    console.log('Bank Ledger after fifth posting:', bankLedger5);

    // Check Cash ledger
    expect(cashLedger5).toHaveLength(5);
    expect(new Date(cashLedger5.at(0)!.date)).toEqual(date01);
    expect(cashLedger5.at(0)!.debit).toBe(100);
    expect(cashLedger5.at(0)!.balance).toBe(100);
    expect(cashLedger5.at(0)!.balanceType).toBe(BalanceType.Dr);

    // Check Bank ledger
    expect(bankLedger5).toHaveLength(2);
    expect(new Date(bankLedger5.at(0)!.date)).toEqual(date01);
    expect(bankLedger5.at(0)!.debit).toBe(200);
    expect(bankLedger5.at(0)!.balance).toBe(200);
    expect(bankLedger5.at(0)!.balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger
    expect(salesLedger5).toHaveLength(7);
    expect(new Date(salesLedger5.at(0)!.date)).toEqual(date01);
    expect(salesLedger5.at(0)!.credit).toBe(100);
    expect(salesLedger5.at(0)!.balance).toBe(100);
    expect(salesLedger5.at(0)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger5.at(1)!.date)).toEqual(date01);
    expect(salesLedger5.at(1)!.credit).toBe(200);
    expect(salesLedger5.at(1)!.balance).toBe(300);
    expect(salesLedger5.at(1)!.balanceType).toBe(BalanceType.Cr);
  });

  it('should correctly handle balance type changes when adding debit entries to credit balance', () => {
    // Create test accounts
    const accounts: InsertAccount[] = [
      { name: 'Cash', headName: 'Current Asset' },
      { name: 'Sale', headName: 'Revenue' },
    ].map((account) => ({
      ...account,
      ...defaultAccountFields,
    }));
    accounts.forEach((account) => accountService.insertAccount(account));

    // First journal entry: Create initial credit balance
    const date1 = new Date('01/01/2024');
    const journal1: Journal = {
      id: 1,
      date: date1.toISOString(),
      narration: 'Initial credit entry',
      isPosted: true,
      journalEntries: [
        { journalId: 1, accountId: 1, debitAmount: 0, creditAmount: 1000 },
        { journalId: 1, accountId: 2, debitAmount: 1000, creditAmount: 0 },
      ] as JournalEntry[],
    };

    console.log('Posting first journal - initial credit');
    journalService.insertJournal(journal1);

    // Verify initial credit balance
    const cashLedger1 = ledgerService.getLedger(1);
    expect(cashLedger1).toHaveLength(1);
    expect(new Date(cashLedger1.at(-1)!.date)).toEqual(date1);
    expect(cashLedger1.at(-1)!.credit).toBe(1000);
    expect(cashLedger1.at(-1)!.balance).toBe(1000);
    expect(cashLedger1.at(-1)!.balanceType).toBe(BalanceType.Cr);

    // Second journal entry: Add smaller debit amount
    const date2 = new Date('01/02/2024');
    const journal2: Journal = {
      id: 2,
      date: date2.toISOString(),
      narration: 'Smaller debit entry',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 600, creditAmount: 0 },
        { journalId: 2, accountId: 2, debitAmount: 0, creditAmount: 600 },
      ] as JournalEntry[],
    };

    console.log('Posting second journal - smaller debit');
    journalService.insertJournal(journal2);

    // Verify balance after smaller debit
    const cashLedger2 = ledgerService.getLedger(1);
    expect(cashLedger2).toHaveLength(2);
    expect(new Date(cashLedger2.at(-1)!.date)).toEqual(date2);
    expect(cashLedger2.at(-1)!.debit).toBe(600);
    expect(cashLedger2.at(-1)!.balance).toBe(400);
    expect(cashLedger2.at(-1)!.balanceType).toBe(BalanceType.Cr); // Should still be Cr

    // Third journal entry: Add larger debit amount
    const date3 = new Date('01/03/2024');
    const journal3: Journal = {
      id: 3,
      date: date3.toISOString(),
      narration: 'Larger debit entry',
      isPosted: true,
      journalEntries: [
        { journalId: 3, accountId: 1, debitAmount: 800, creditAmount: 0 },
        { journalId: 3, accountId: 2, debitAmount: 0, creditAmount: 800 },
      ] as JournalEntry[],
    };

    console.log('Posting third journal - larger debit');
    journalService.insertJournal(journal3);

    // Verify balance after larger debit
    const cashLedger3 = ledgerService.getLedger(1);
    expect(cashLedger3).toHaveLength(3);
    expect(new Date(cashLedger3.at(-1)!.date)).toEqual(date3);
    expect(cashLedger3.at(-1)!.debit).toBe(800);
    expect(cashLedger3.at(-1)!.balance).toBe(400);
    expect(cashLedger3.at(-1)!.balanceType).toBe(BalanceType.Dr); // Should switch to Dr
  });

  it('should correctly handle balance type changes and calculations when adding credit entries to debit balance', () => {
    // Create test accounts
    const accounts: InsertAccount[] = [
      { name: 'Cash', headName: 'Current Asset' },
      { name: 'Sale', headName: 'Revenue' },
    ].map((account) => ({
      ...account,
      ...defaultAccountFields,
    }));
    accounts.forEach((account) => accountService.insertAccount(account));

    // First journal entry: Create initial debit balance
    const date1 = new Date('01/01/2024');
    const journal1: Journal = {
      id: 1,
      date: date1.toISOString(),
      narration: 'Initial debit entry',
      isPosted: true,
      journalEntries: [
        { journalId: 1, accountId: 1, debitAmount: 1000, creditAmount: 0 },
        { journalId: 1, accountId: 2, debitAmount: 0, creditAmount: 1000 },
      ] as JournalEntry[],
    };

    console.log('Posting first journal - initial debit');
    journalService.insertJournal(journal1);

    // Verify initial debit balance
    const cashLedger1 = ledgerService.getLedger(1);
    expect(cashLedger1).toHaveLength(1);
    expect(new Date(cashLedger1.at(-1)!.date)).toEqual(date1);
    expect(cashLedger1.at(-1)!.debit).toBe(1000);
    expect(cashLedger1.at(-1)!.balance).toBe(1000);
    expect(cashLedger1.at(-1)!.balanceType).toBe(BalanceType.Dr);

    // Second journal entry: Add smaller credit amount
    const date2 = new Date('01/02/2024');
    const journal2: Journal = {
      id: 2,
      date: date2.toISOString(),
      narration: 'Smaller credit entry',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 0, creditAmount: 600 },
        { journalId: 2, accountId: 2, debitAmount: 600, creditAmount: 0 },
      ] as JournalEntry[],
    };

    console.log('Posting second journal - smaller credit');
    journalService.insertJournal(journal2);

    // Verify balance after smaller credit
    const cashLedger2 = ledgerService.getLedger(1);
    expect(cashLedger2).toHaveLength(2);
    expect(new Date(cashLedger2.at(-1)!.date)).toEqual(date2);
    expect(cashLedger2.at(-1)!.credit).toBe(600);
    expect(cashLedger2.at(-1)!.balance).toBe(400);
    expect(cashLedger2.at(-1)!.balanceType).toBe(BalanceType.Dr); // Should still be Dr

    // Third journal entry: Add larger credit amount
    const date3 = new Date('01/03/2024');
    const journal3: Journal = {
      id: 3,
      date: date3.toISOString(),
      narration: 'Larger credit entry',
      isPosted: true,
      journalEntries: [
        { journalId: 3, accountId: 1, debitAmount: 0, creditAmount: 800 },
        { journalId: 3, accountId: 2, debitAmount: 800, creditAmount: 0 },
      ] as JournalEntry[],
    };

    console.log('Posting third journal - larger credit');
    journalService.insertJournal(journal3);

    // Verify balance after larger credit
    const cashLedger3 = ledgerService.getLedger(1);
    expect(cashLedger3).toHaveLength(3);
    expect(new Date(cashLedger3.at(-1)!.date)).toEqual(date3);
    expect(cashLedger3.at(-1)!.credit).toBe(800);
    expect(cashLedger3.at(-1)!.balance).toBe(400);
    expect(cashLedger3.at(-1)!.balanceType).toBe(BalanceType.Cr); // Should switch to Cr
  });

  it('should throw error when journal has multiple debits and multiple credits', () => {
    // Create test accounts
    const accounts: InsertAccount[] = [
      { name: 'Cash', headName: 'Current Asset' },
      { name: 'Bank', headName: 'Current Asset' },
      { name: 'Sale', headName: 'Revenue' },
      { name: 'Service', headName: 'Revenue' },
    ].map((account) => ({
      ...account,
      ...defaultAccountFields,
    }));
    accounts.forEach((account) => accountService.insertAccount(account));

    // Try to create invalid journal with multiple debits and credits
    const invalidJournal: Journal = {
      id: 1,
      date: new Date().toISOString(),
      narration: 'Invalid journal with multiple debits and credits',
      isPosted: true,
      journalEntries: [
        { journalId: 1, accountId: 1, debitAmount: 100, creditAmount: 0 }, // Cash debit
        { journalId: 1, accountId: 2, debitAmount: 100, creditAmount: 0 }, // Bank debit
        { journalId: 1, accountId: 3, debitAmount: 0, creditAmount: 100 }, // Sale credit
        { journalId: 1, accountId: 4, debitAmount: 0, creditAmount: 100 }, // Service credit
      ] as JournalEntry[],
    };

    expect(() => journalService.insertJournal(invalidJournal)).toThrow();
  });

  it('should correctly handle proportional splitting in multiple debit entries', () => {
    // Create test accounts
    const accounts: InsertAccount[] = [
      { name: 'Cash', headName: 'Current Asset' },
      { name: 'Bank', headName: 'Current Asset' },
      { name: 'Sale', headName: 'Revenue' },
    ].map((account) => ({
      ...account,
      ...defaultAccountFields,
    }));
    accounts.forEach((account) => accountService.insertAccount(account));

    // Create journal with multiple debits against single credit
    const journal: Journal = {
      id: 1,
      date: new Date().toISOString(),
      narration: 'Multiple debits against single credit',
      isPosted: true,
      journalEntries: [
        { journalId: 1, accountId: 1, debitAmount: 600, creditAmount: 0 }, // Cash debit
        { journalId: 1, accountId: 2, debitAmount: 400, creditAmount: 0 }, // Bank debit
        { journalId: 1, accountId: 3, debitAmount: 0, creditAmount: 1000 }, // Sale credit
      ] as JournalEntry[],
    };

    journalService.insertJournal(journal);

    // Verify ledger entries
    const cashLedger = ledgerService.getLedger(1);
    const bankLedger = ledgerService.getLedger(2);
    const salesLedger = ledgerService.getLedger(3);

    // Check Cash ledger (60% of credit)
    expect(cashLedger).toHaveLength(1);
    expect(cashLedger.at(-1)!.debit).toBe(600);
    expect(cashLedger.at(-1)!.balance).toBe(600);
    expect(cashLedger.at(-1)!.balanceType).toBe(BalanceType.Dr);

    // Check Bank ledger (40% of credit)
    expect(bankLedger).toHaveLength(1);
    expect(bankLedger.at(-1)!.debit).toBe(400);
    expect(bankLedger.at(-1)!.balance).toBe(400);
    expect(bankLedger.at(-1)!.balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger
    expect(salesLedger).toHaveLength(2);
    expect(salesLedger.at(-1)!.balance).toBe(1000);
    expect(salesLedger.at(-1)!.balanceType).toBe(BalanceType.Cr);
  });

  it('should correctly handle proportional splitting in multiple credit entries', () => {
    // Create test accounts
    const accounts: InsertAccount[] = [
      { name: 'Cash', headName: 'Current Asset' },
      { name: 'Sale', headName: 'Revenue' },
      { name: 'Service', headName: 'Revenue' },
    ].map((account) => ({
      ...account,
      ...defaultAccountFields,
    }));
    accounts.forEach((account) => accountService.insertAccount(account));

    // Create journal with single debit against multiple credits
    const journal: Journal = {
      id: 1,
      date: new Date().toISOString(),
      narration: 'Single debit against multiple credits',
      isPosted: true,
      journalEntries: [
        { journalId: 1, accountId: 1, debitAmount: 1000, creditAmount: 0 }, // Cash debit
        { journalId: 1, accountId: 2, debitAmount: 0, creditAmount: 600 }, // Sale credit
        { journalId: 1, accountId: 3, debitAmount: 0, creditAmount: 400 }, // Service credit
      ] as JournalEntry[],
    };

    journalService.insertJournal(journal);

    // Verify ledger entries
    const cashLedger = ledgerService.getLedger(1);
    const salesLedger = ledgerService.getLedger(2);
    const serviceLedger = ledgerService.getLedger(3);

    // Check Cash ledger
    expect(cashLedger).toHaveLength(2);
    expect(cashLedger.at(-1)!.balance).toBe(1000);
    expect(cashLedger.at(-1)!.balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger (60% of debit)
    expect(salesLedger).toHaveLength(1);
    expect(salesLedger.at(-1)!.credit).toBe(600);
    expect(salesLedger.at(-1)!.balance).toBe(600);
    expect(salesLedger.at(-1)!.balanceType).toBe(BalanceType.Cr);

    // Check Service ledger (40% of debit)
    expect(serviceLedger).toHaveLength(1);
    expect(serviceLedger.at(-1)!.credit).toBe(400);
    expect(serviceLedger.at(-1)!.balance).toBe(400);
    expect(serviceLedger.at(-1)!.balanceType).toBe(BalanceType.Cr);
  });

  it('should correctly rebuild ledger when past entries are added', () => {
    // Create test accounts
    const accounts: InsertAccount[] = [
      { name: 'Cash', headName: 'Current Asset' },
      { name: 'Sale', headName: 'Revenue' },
    ].map((account) => ({
      ...account,
      ...defaultAccountFields,
    }));
    accounts.forEach((account) => accountService.insertAccount(account));

    // First journal entry - current date
    const currentDate = new Date();
    const journal1: Journal = {
      id: 1,
      date: currentDate.toISOString(),
      narration: 'Current date entry',
      isPosted: true,
      journalEntries: [
        { journalId: 1, accountId: 1, debitAmount: 1000, creditAmount: 0 },
        { journalId: 1, accountId: 2, debitAmount: 0, creditAmount: 1000 },
      ] as JournalEntry[],
    };

    journalService.insertJournal(journal1);

    // Second journal entry - past date
    const pastDate = new Date(currentDate);
    pastDate.setDate(pastDate.getDate() - 5);
    const journal2: Journal = {
      id: 2,
      date: pastDate.toISOString(),
      narration: 'Past date entry',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 500, creditAmount: 0 },
        { journalId: 2, accountId: 2, debitAmount: 0, creditAmount: 500 },
      ] as JournalEntry[],
    };

    journalService.insertJournal(journal2);

    // Verify ledger entries are in correct order and balances are correct
    const cashLedger = ledgerService.getLedger(1);
    const salesLedger = ledgerService.getLedger(2);

    // Check Cash ledger
    expect(cashLedger).toHaveLength(2);
    expect(new Date(cashLedger.at(-1)!.date)).toEqual(currentDate);
    expect(cashLedger.at(-1)!.debit).toBe(1000);
    expect(cashLedger.at(-1)!.balance).toBe(1500);
    expect(cashLedger.at(-1)!.balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger.at(-2)!.date)).toEqual(pastDate);
    expect(cashLedger.at(-2)!.debit).toBe(500);
    expect(cashLedger.at(-2)!.balance).toBe(500);
    expect(cashLedger.at(-2)!.balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger
    expect(salesLedger).toHaveLength(2);
    expect(new Date(salesLedger.at(-1)!.date)).toEqual(currentDate);
    expect(salesLedger.at(-1)!.credit).toBe(1000);
    expect(salesLedger.at(-1)!.balance).toBe(1500);
    expect(salesLedger.at(-1)!.balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger.at(-2)!.date)).toEqual(pastDate);
    expect(salesLedger.at(-2)!.credit).toBe(500);
    expect(salesLedger.at(-2)!.balance).toBe(500);
    expect(salesLedger.at(-2)!.balanceType).toBe(BalanceType.Cr);
  });
});
