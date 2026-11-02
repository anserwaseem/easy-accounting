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

describe('Cheque and commission payable linkage', () => {
  it('applies a held cheque to a settlement and guards over-application', async () => {
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
    const cheque = new ChequeService({
      db: driver,
      session,
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

    const chequeId = await cheque.recordReceivedCheque({
      chartId: agentHeadId,
      chequeNumber: 'L1',
      amount: 40,
      receivedDate: '2026-01-16',
      allocations: [{ accountId: shopId, amount: 40 }],
    });

    await cheque.transferCustody({
      chequeId,
      toHolder: 'agent',
      eventDate: '2026-01-16',
      heldForCommission: true,
      notes: 'held for commission',
    });

    await cheque.applyToCommission(chequeId, settlement.id as number, 4);
    const after = await cheque.getCheque(chequeId);
    expect(after.commissionSettlementId).toBe(settlement.id);
    expect(after.commissionAppliedAmount).toBe(4);

    await expect(
      cheque.applyToCommission(chequeId, settlement.id as number, 1),
    ).rejects.toThrow('already linked');

    const secondChequeId = await cheque.recordReceivedCheque({
      chartId: agentHeadId,
      chequeNumber: 'L2',
      amount: 10,
      receivedDate: '2026-01-17',
      allocations: [{ accountId: shopId, amount: 10 }],
    });
    await cheque.transferCustody({
      chequeId: secondChequeId,
      toHolder: 'agent',
      eventDate: '2026-01-17',
      heldForCommission: true,
    });
    await cheque.applyToCommission(secondChequeId, settlement.id as number, 6);

    const thirdChequeId = await cheque.recordReceivedCheque({
      chartId: agentHeadId,
      chequeNumber: 'L3',
      amount: 5,
      receivedDate: '2026-01-18',
      allocations: [{ accountId: shopId, amount: 5 }],
    });
    await cheque.transferCustody({
      chequeId: thirdChequeId,
      toHolder: 'agent',
      eventDate: '2026-01-18',
      heldForCommission: true,
    });
    await expect(
      cheque.applyToCommission(thirdChequeId, settlement.id as number, 5),
    ).rejects.toThrow('exceeds outstanding');

    db.close();
  });
});
