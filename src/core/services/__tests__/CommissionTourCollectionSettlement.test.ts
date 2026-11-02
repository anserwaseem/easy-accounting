import Database from 'better-sqlite3';
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

describe('CommissionService tour collection settlement', () => {
  it('posts and unposts a settlement', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);
    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run(USERNAME, Buffer.from('x'));

    const currentAssetId = insertChart(db, 1, 'Current Asset', 'Asset', null);
    const expenseHeadId = insertChart(db, 1, 'Expense', 'Expense', null);
    const liabilityHeadId = insertChart(db, 1, 'Liability', 'Liability', null);
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

    const bankId = insertAccountRow(db, currentAssetId, 'Bank');
    const shopId = insertAccountRow(db, agentHeadId, 'Shop');
    const expenseId = insertAccountRow(db, expenseHeadId, 'Commission Expense');
    const payableId = insertAccountRow(
      db,
      liabilityHeadId,
      'Commission Payable',
    );

    insertJournal(db, '2026-01-10', [[bankId, 100]], [[shopId, 100]]);

    await commission.saveCommissionConfig({
      chartId: agentHeadId,
      payableAccountId: payableId,
      expenseAccountId: expenseId,
      rates: [],
      overrides: [],
      tourCollectionRate: 10,
    });

    const settlement = await commission.postTourCollectionCommissionSettlement({
      chartId: agentHeadId,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      postingDate: '2026-01-15',
      payableAccountId: payableId,
      expenseAccountId: expenseId,
      adjustments: [],
    });

    expect(settlement.netCommission).toBe(10);
    expect(settlement.grossCommission).toBe(10);
    expect(settlement.journalId).not.toBeNull();
    expect(settlement.tourCollectionRatePercent).toBe(10);

    const unposted = await commission.unpostTourCollectionCommissionSettlement(
      settlement.id as number,
    );
    expect(unposted).toBe(true);

    db.close();
  });
});
