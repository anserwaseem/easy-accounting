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
      { name: 'Cash', headName: 'Current Asset', code: undefined },
      {
        name: 'Accounts Receivable',
        headName: 'Current Asset',
        code: undefined,
      },
      { name: 'Sales', headName: 'Revenue', code: 10 },
      { name: 'Inventory', headName: 'Current Asset', code: undefined },
      {
        name: 'Accounts Payable',
        headName: 'Current Liability',
        code: undefined,
      },
    ];
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

    expect(arLedger1[0].balance).toBe(1000);
    expect(arLedger1[0].balanceType).toBe(BalanceType.Dr);
    expect(salesLedger1[0].balance).toBe(1000);
    expect(salesLedger1[0].balanceType).toBe(BalanceType.Cr);

    // Second journal entry: Multiple debits, one credit
    const journal2: Journal = {
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

    console.log('Posting second journal');
    journalService.insertJournal(journal2);

    const cashLedger2 = ledgerService.getLedger(1);
    const inventoryLedger2 = ledgerService.getLedger(4);
    const apLedger2 = ledgerService.getLedger(5);

    console.log('Cash Ledger after second posting:', cashLedger2);
    console.log('Inventory Ledger after second posting:', inventoryLedger2);
    console.log('AP Ledger after second posting:', apLedger2);

    expect(cashLedger2[0].balance).toBe(200);
    expect(cashLedger2[0].balanceType).toBe(BalanceType.Dr);
    expect(inventoryLedger2[0].balance).toBe(800);
    expect(inventoryLedger2[0].balanceType).toBe(BalanceType.Dr);
    expect(apLedger2[0].balance).toBe(1000);
    expect(apLedger2[0].balanceType).toBe(BalanceType.Cr);

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

    expect(cashLedger3[0].balance).toBe(200);
    expect(cashLedger3[0].balanceType).toBe(BalanceType.Cr);

    expect(arLedger3[0].balance).toBe(800);
    expect(arLedger3[0].balanceType).toBe(BalanceType.Dr);

    expect(apLedger3[0].balance).toBe(400);
    expect(apLedger3[0].balanceType).toBe(BalanceType.Cr);

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

    expect(salesLedger4[0].balance).toBe(0);
    expect(salesLedger4[0].balanceType).toBe(BalanceType.Cr);
    expect(arLedger4[0].balance).toBe(0);
    expect(arLedger4[0].balanceType).toBe(BalanceType.Dr);
    expect(cashLedger4[0].balance).toBe(0);
    expect(cashLedger4[0].balanceType).toBe(BalanceType.Dr);
  });

  it('should correctly update ledger balances when inserting a journal with a past date', () => {
    // Create test accounts
    const accounts: InsertAccount[] = [
      { name: 'Cash', headName: 'Current Asset', code: undefined },
      { name: 'Sales', headName: 'Revenue', code: undefined },
    ];
    accounts.forEach((account) => accountService.insertAccount(account));

    // First journal entry: Current date
    const currentDate = new Date();
    const journal1: Journal = {
      id: 1,
      date: currentDate.toISOString(),
      narration: 'New day! New sale!',
      isPosted: true,
      journalEntries: [
        { journalId: 1, accountId: 1, debitAmount: 1000, creditAmount: 0 },
        { journalId: 1, accountId: 2, debitAmount: 0, creditAmount: 1000 },
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
    expect(new Date(cashLedger1[0].date)).toEqual(currentDate);
    expect(cashLedger1[0].debit).toBe(1000);
    expect(cashLedger1[0].balance).toBe(1000);
    expect(cashLedger1[0].balanceType).toBe(BalanceType.Dr);

    // Verify Sales ledger after first posting
    expect(salesLedger1).toHaveLength(1);
    expect(new Date(salesLedger1[0].date)).toEqual(currentDate);
    expect(salesLedger1[0].credit).toBe(1000);
    expect(salesLedger1[0].balance).toBe(1000);
    expect(salesLedger1[0].balanceType).toBe(BalanceType.Cr);

    // Second journal entry: Past date
    const pastDate = new Date(currentDate);
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
    const journal2: Journal = {
      id: 2,
      date: pastDate.toISOString(),
      narration: 'Oops! forgot this sale happened 5 days ago',
      isPosted: true,
      journalEntries: [
        { journalId: 2, accountId: 1, debitAmount: 500, creditAmount: 0 },
        { journalId: 2, accountId: 2, debitAmount: 0, creditAmount: 500 },
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
    expect(new Date(cashLedger2[0].date)).toEqual(pastDate);
    expect(cashLedger2[0].debit).toBe(500);
    expect(cashLedger2[0].balance).toBe(1500);
    expect(cashLedger2[0].balanceType).toBe(BalanceType.Dr);

    expect(new Date(cashLedger2[1].date)).toEqual(currentDate);
    expect(cashLedger2[1].debit).toBe(1000);
    expect(cashLedger2[1].balance).toBe(1000);
    expect(cashLedger2[1].balanceType).toBe(BalanceType.Dr);

    // Check Sales ledger
    expect(salesLedger2).toHaveLength(2);
    expect(new Date(salesLedger2[0].date)).toEqual(pastDate);
    expect(salesLedger2[0].credit).toBe(500);
    expect(salesLedger2[0].balance).toBe(1500);
    expect(salesLedger2[0].balanceType).toBe(BalanceType.Cr);

    expect(new Date(salesLedger2[1].date)).toEqual(currentDate);
    expect(salesLedger2[1].credit).toBe(1000);
    expect(salesLedger2[1].balance).toBe(1000);
    expect(salesLedger2[1].balanceType).toBe(BalanceType.Cr);
  });
});
