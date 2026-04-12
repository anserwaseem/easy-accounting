import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { UserCredentials } from '../../../types';
import { MigrationRunner } from '../../migrations';
import { AccountService, AuthService, DatabaseService } from '..';

const TEST_DB_USER: UserCredentials = {
  username: 'testuser',
  password: 'testpassword',
};

jest.mock('electron-log', () => ({
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
}));

jest.mock('../../store', () => ({
  store: {
    get: jest.fn((key) => {
      if (key === 'username') return TEST_DB_USER.username;
      return undefined;
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

describe('AccountService.getReceivables', () => {
  let db: Database.Database;
  let accountService: AccountService;
  let authService: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

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

    authService.register(TEST_DB_USER);
    authService.login(TEST_DB_USER);
  });

  afterEach(() => {
    db.close();
  });

  function seedReceivablesData() {
    const chartResult = db
      .prepare(
        `INSERT INTO chart (name, type, userId) VALUES (?, 'Asset', (SELECT id FROM users WHERE username = ?))`,
      )
      .run('Debtors', TEST_DB_USER.username);
    const chartId = chartResult.lastInsertRowid as number;

    // Customer A
    const acc1 = db
      .prepare(`INSERT INTO account (name, chartId, code) VALUES (?, ?, ?)`)
      .run('Customer A', chartId, 'CUST-001');
    const acc1Id = acc1.lastInsertRowid as number;

    // Customer B
    const acc2 = db
      .prepare(`INSERT INTO account (name, chartId, code) VALUES (?, ?, ?)`)
      .run('Customer B', chartId, 'CUST-002');
    const acc2Id = acc2.lastInsertRowid as number;

    // Create invoices for Customer A
    const inv1 = db
      .prepare(
        `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount) VALUES (?, ?, 'Sale', ?, ?)`,
      )
      .run(1001, acc1Id, '2024-01-15T00:00:00.000Z', 5000);
    const inv1Id = inv1.lastInsertRowid as number;

    const inv2 = db
      .prepare(
        `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount) VALUES (?, ?, 'Sale', ?, ?)`,
      )
      .run(1002, acc1Id, '2024-02-10T00:00:00.000Z', 3000);
    const inv2Id = inv2.lastInsertRowid as number;

    // Invoice for Customer B
    db.prepare(
      `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount) VALUES (?, ?, 'Sale', ?, ?)`,
    ).run(1003, acc2Id, '2024-01-20T00:00:00.000Z', 8000);

    // Invoice items for discount% calculation
    db.prepare(
      `INSERT INTO inventory (name, price, quantity, itemTypeId) VALUES ('TestItem', 100, 100, 1)`,
    ).run();

    // Invoice 1001: 10 items at $500 each, 5% discount → gross 5000, discount 50 (1%)
    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount)
       VALUES (?, 1, 10, 500, 5)`,
    ).run(inv1Id);
    // Invoice 1002: 5 items at $400 each, 10% discount → gross 2000, discount 50 (2.5%)
    db.prepare(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount)
       VALUES (?, 1, 5, 400, 10)`,
    ).run(inv2Id);

    // Journal entries (InvoiceService creates journal entries; ledger particulars reference them)
    const j1 = db
      .prepare(
        `INSERT INTO journal (billNumber, date, narration, isPosted)
         VALUES (?, ?, ?, ?)`,
      )
      .run(1001, '2024-01-15T00:00:00.000Z', 'Sale Invoice #1001', 1);
    const j1Id = j1.lastInsertRowid as number;

    const j2 = db
      .prepare(
        `INSERT INTO journal (billNumber, date, narration, isPosted)
         VALUES (?, ?, ?, ?)`,
      )
      .run(1002, '2024-02-10T00:00:00.000Z', 'Sale Invoice #1002', 1);
    const j2Id = j2.lastInsertRowid as number;

    const j3 = db
      .prepare(
        `INSERT INTO journal (billNumber, date, narration, isPosted)
         VALUES (?, ?, ?, ?)`,
      )
      .run(1003, '2024-01-20T00:00:00.000Z', 'Sale Invoice #1003', 1);
    const j3Id = j3.lastInsertRowid as number;

    // Ledger entries: debit = invoices, credit = receipts
    // Customer A: two invoices with Journal #N pattern for bill number resolution
    db.prepare(
      `INSERT INTO ledger (accountId, date, debit, credit, balance, balanceType, particulars)
       VALUES (?, ?, ?, 0, ?, 'Dr', ?)`,
    ).run(acc1Id, '2024-01-15', 5000, 5000, `Journal #${j1Id}`);
    db.prepare(
      `INSERT INTO ledger (accountId, date, debit, credit, balance, balanceType, particulars)
       VALUES (?, ?, ?, 0, ?, 'Dr', ?)`,
    ).run(acc1Id, '2024-02-10', 3000, 8000, `Journal #${j2Id}`);

    // Customer A: two receipts (partial payments)
    db.prepare(
      `INSERT INTO ledger (accountId, date, debit, credit, balance, balanceType, particulars)
       VALUES (?, ?, 0, ?, ?, 'Cr', ?)`,
    ).run(acc1Id, '2024-02-01', 4000, 1000, 'Receipt #1001');
    db.prepare(
      `INSERT INTO ledger (accountId, date, debit, credit, balance, balanceType, particulars)
       VALUES (?, ?, 0, ?, ?, 'Cr', ?)`,
    ).run(acc1Id, '2024-03-01', 2000, -1000, 'Receipt #1002');

    // Customer B: one invoice + one full payment
    db.prepare(
      `INSERT INTO ledger (accountId, date, debit, credit, balance, balanceType, particulars)
       VALUES (?, ?, ?, 0, ?, 'Dr', ?)`,
    ).run(acc2Id, '2024-01-20', 8000, 8000, `Journal #${j3Id}`);
    db.prepare(
      `INSERT INTO ledger (accountId, date, debit, credit, balance, balanceType, particulars)
       VALUES (?, ?, 0, ?, ?, 'Cr', ?)`,
    ).run(acc2Id, '2024-02-15', 8000, 0, 'Receipt #1003');

    return { acc1Id, acc2Id };
  }

  it('should return rows with summary data per account', () => {
    seedReceivablesData();

    const result = accountService.getReceivables(
      'Debtors',
      '2024-01-01',
      '2024-03-31',
    ) as { rows: Array<Record<string, unknown>>; kpis: Record<string, number> };

    expect(result.rows).toHaveLength(2);

    const customerA = result.rows.find((r) => r.accountName === 'Customer A');
    expect(customerA).toBeDefined();
    expect(customerA?.billedAmount).toBe(8000);
    expect(customerA?.collectedAmount).toBe(6000);
    expect(customerA?.outstandingAmount).toBe(2000);
    expect(customerA?.billCount).toBe(2);

    const customerB = result.rows.find((r) => r.accountName === 'Customer B');
    expect(customerB).toBeDefined();
    expect(customerB?.billedAmount).toBe(8000);
    expect(customerB?.collectedAmount).toBe(8000);
    expect(customerB?.outstandingAmount).toBe(0);
  });

  it('should return bills array for each account in expanded view', () => {
    seedReceivablesData();

    const result = accountService.getReceivables(
      'Debtors',
      '2024-01-01',
      '2024-03-31',
    ) as { rows: Array<Record<string, unknown>> };

    const customerA = result.rows.find((r) => r.accountName === 'Customer A');
    expect(customerA).toBeDefined();
    expect(Array.isArray(customerA?.bills)).toBe(true);

    const bills = customerA?.bills as Array<Record<string, unknown>>;
    expect(bills).toHaveLength(2);

    // First bill: Invoice #1001, $5000
    // FIFO: $4000 + $1000 (from second receipt) = $5000 fully clears bill 1
    expect(bills[0].billNumber).toBe('1001');
    expect(bills[0].billAmount).toBe(5000);
    expect(bills[0].remainingBalance).toBe(0);
    expect(bills[0].daysStatus).toBe('Cleared');

    // Second bill: Invoice #1002, $3000, only $1000 from second receipt left → $2000 remaining
    expect(bills[1].billNumber).toBe('1002');
    expect(bills[1].billAmount).toBe(3000);
    expect(bills[1].remainingBalance).toBe(2000);
    expect(bills[1].daysStatus).toContain('days pending');
  });

  it('should compute discountPercent from invoice_items', () => {
    seedReceivablesData();

    const result = accountService.getReceivables(
      'Debtors',
      '2024-01-01',
      '2024-03-31',
    ) as { rows: Array<Record<string, unknown>> };

    const customerA = result.rows.find((r) => r.accountName === 'Customer A');
    const bills = customerA?.bills as Array<Record<string, unknown>>;

    // Invoice #1001: 10 * 500 = 5000 gross, 5 * 10 = 50 discount => 1%
    expect(bills[0].discountPercent).toBe(1);

    // Invoice #1002: 5 * 400 = 2000 gross, 10 * 5 = 50 discount => 2.5%
    expect(bills[1].discountPercent).toBe(2.5);
  });

  it('should mark fully paid bills as "Cleared"', () => {
    seedReceivablesData();

    const result = accountService.getReceivables(
      'Debtors',
      '2024-01-01',
      '2024-03-31',
    ) as { rows: Array<Record<string, unknown>> };

    const customerB = result.rows.find((r) => r.accountName === 'Customer B');
    const bills = customerB?.bills as Array<Record<string, unknown>>;

    expect(bills).toHaveLength(1);
    expect(bills[0].remainingBalance).toBe(0);
    expect(bills[0].daysStatus).toBe('Cleared');
  });

  it('should return empty rows for non-existent head', () => {
    seedReceivablesData();

    const result = accountService.getReceivables(
      'NonExistent',
      '2024-01-01',
      '2024-03-31',
    ) as { rows: Array<Record<string, unknown>> };

    expect(result.rows).toHaveLength(0);
  });

  it('should include lastBillDate, lastReceiptDate, avgDaysToClear, unallocatedReceipts', () => {
    seedReceivablesData();

    const result = accountService.getReceivables(
      'Debtors',
      '2024-01-01',
      '2024-03-31',
    ) as { rows: Array<Record<string, unknown>> };

    const customerA = result.rows.find((r) => r.accountName === 'Customer A');
    // bill date matches second invoice date
    expect(customerA?.lastBillDate).toBeTruthy();
    expect(customerA?.lastReceiptDate).toBeTruthy();
    expect(customerA?.avgDaysToClear).toBeDefined();
    expect(customerA?.unallocatedReceipts).toBe(0);
  });

  it('should include accountCode in summary rows', () => {
    seedReceivablesData();

    const result = accountService.getReceivables(
      'Debtors',
      '2024-01-01',
      '2024-03-31',
    ) as { rows: Array<Record<string, unknown>> };

    const customerA = result.rows.find((r) => r.accountName === 'Customer A');
    expect(customerA?.accountCode).toBe('CUST-001');

    const customerB = result.rows.find((r) => r.accountName === 'Customer B');
    expect(customerB?.accountCode).toBe('CUST-002');
  });
});
