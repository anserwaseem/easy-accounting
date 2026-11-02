import Database from 'better-sqlite3';
import { ChequeService } from '../ChequeService';
import { CommissionService } from '../CommissionService';
import { JournalService } from '../JournalService';
import { LedgerService } from '../LedgerService';
import type { SessionContext } from '../../ports';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../db/bootstrap';

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

const USERNAME = 'testuser';
const session: SessionContext = { getUsername: () => USERNAME };

const insertChart = (
  db: Database.Database,
  userId: number,
  name: string,
  type: string,
  parentId: number | null,
): number =>
  Number(
    db
      .prepare(
        `INSERT INTO chart (date, name, type, userId, parentId) VALUES ('2025-01-01', ?, ?, ?, ?)`,
      )
      .run(name, type, userId, parentId).lastInsertRowid,
  );

const insertAccountRow = (
  db: Database.Database,
  chartId: number,
  name: string,
): number =>
  Number(
    db
      .prepare(`INSERT INTO account (chartId, name, code) VALUES (?, ?, ?)`)
      .run(chartId, name, name).lastInsertRowid,
  );

const insertJournal = (
  db: Database.Database,
  date: string,
  debits: [number, number][],
  credits: [number, number][],
): number => {
  const journalId = Number(
    db
      .prepare(
        `INSERT INTO journal (date, narration, isPosted) VALUES (?, 'test', 1)`,
      )
      .run(date).lastInsertRowid,
  );
  const line = db.prepare(
    `INSERT INTO journal_entry (journalId, debitAmount, creditAmount, accountId) VALUES (?, ?, ?, ?)`,
  );
  debits.forEach(([accountId, amount]) =>
    line.run(journalId, amount, 0, accountId),
  );
  credits.forEach(([accountId, amount]) =>
    line.run(journalId, 0, amount, accountId),
  );
  return journalId;
};

describe('CommissionService.getTourCollectionBase', () => {
  it('sums cash/bank receipts plus cheques and splits cleared/pending', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);
    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run(USERNAME, Buffer.from('x'));

    const currentAssetId = insertChart(db, 1, 'Current Asset', 'Asset', null);
    const expenseHeadId = insertChart(db, 1, 'Expense', 'Expense', null);
    const agentHeadId = insertChart(
      db,
      1,
      'Agent Head',
      'Asset',
      currentAssetId,
    );

    const ledger = new LedgerService({ db: driver, session });
    const journal = new JournalService({
      db: driver,
      session,
      ledgerService: ledger,
    });
    const commission = new CommissionService({
      db: driver,
      journalService: journal,
    });
    const cheque = new ChequeService({
      db: driver,
      session,
      journalService: journal,
    });

    const bankId = insertAccountRow(db, currentAssetId, 'Bank');
    const shopId = insertAccountRow(db, agentHeadId, 'Shop');
    const discountId = insertAccountRow(db, expenseHeadId, 'Discount');

    // cash receipt 100 counts; discount-only 30 does not
    insertJournal(db, '2026-01-10', [[bankId, 100]], [[shopId, 100]]);
    insertJournal(db, '2026-01-11', [[discountId, 30]], [[shopId, 30]]);

    // pending cheque 50
    await cheque.recordReceivedCheque({
      chartId: agentHeadId,
      chequeNumber: 'P1',
      amount: 50,
      receivedDate: '2026-01-12',
      allocations: [{ accountId: shopId, amount: 50 }],
    });
    // cleared cheque 40
    const clearedId = await cheque.recordReceivedCheque({
      chartId: agentHeadId,
      chequeNumber: 'C1',
      amount: 40,
      receivedDate: '2026-01-13',
      allocations: [{ accountId: shopId, amount: 40 }],
    });
    await cheque.clearCheque({
      chequeId: clearedId,
      bankAccountId: bankId,
      actualClearanceDate: '2026-01-20',
    });

    const base = await commission.getTourCollectionBase(
      agentHeadId,
      '2026-01-01',
      '2026-01-31',
    );

    expect(base.cashBankTotal).toBe(100);
    expect(base.chequesTotal).toBe(90);
    expect(base.clearedChequesTotal).toBe(40);
    expect(base.pendingChequesTotal).toBe(50);
    expect(base.totalBase).toBe(190);
    expect(base.clearedBase).toBe(140);
    expect(base.pendingBase).toBe(50);
    expect(base.chequeCount).toBe(2);

    db.close();
  });
});
