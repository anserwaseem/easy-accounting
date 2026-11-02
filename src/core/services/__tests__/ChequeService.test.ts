import Database from 'better-sqlite3';
import { ChequeService } from '../ChequeService';
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

interface Fixture {
  db: Database.Database;
  cheque: ChequeService;
  agentHeadId: number;
  currentAssetId: number;
  bankId: number;
  shopId: number;
}

const setup = async (): Promise<Fixture> => {
  const db = new Database(':memory:');
  const driver = new BetterSqliteDriver(db);
  await bootstrapDatabase(driver);
  db.prepare(
    `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
  ).run(USERNAME, Buffer.from('x'));

  const currentAssetId = insertChart(db, 1, 'Current Asset', 'Asset', null);
  const agentHeadId = insertChart(db, 1, 'Agent Head', 'Asset', currentAssetId);

  const ledger = new LedgerService({ db: driver, session });
  const journal = new JournalService({
    db: driver,
    session,
    ledgerService: ledger,
  });
  const cheque = new ChequeService({
    db: driver,
    session,
    journalService: journal,
  });

  const bankId = insertAccountRow(db, currentAssetId, 'Bank');
  const shopId = insertAccountRow(db, agentHeadId, 'Shop');

  return { db, cheque, agentHeadId, currentAssetId, bankId, shopId };
};

describe('ChequeService', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await setup();
  });

  afterEach(() => fx.db.close());

  it('records a pending cheque with allocations', async () => {
    const id = await fx.cheque.recordReceivedCheque({
      chartId: fx.agentHeadId,
      chequeNumber: 'CHQ-1',
      amount: 100,
      receivedDate: '2026-01-01',
      allocations: [{ accountId: fx.shopId, amount: 100 }],
      notes: null,
    });
    const c = await fx.cheque.getCheque(id);
    expect(c.status).toBe('pending');
    expect(c.holder).toBe('business');
    expect(c.amount).toBe(100);
    expect(c.allocations).toHaveLength(1);
    expect(c.allocations?.[0].amount).toBe(100);
    expect(c.presentments).toHaveLength(0);
    expect(c.chequeNumber).toBe('CHQ-1');
  });

  it('rejects allocation that does not sum to amount', async () => {
    await expect(
      fx.cheque.recordReceivedCheque({
        chartId: fx.agentHeadId,
        chequeNumber: 'CHQ-2',
        amount: 100,
        receivedDate: '2026-01-01',
        allocations: [{ accountId: fx.shopId, amount: 90 }],
      }),
    ).rejects.toThrow('sum to cheque amount');
  });

  it('clears a cheque and posts a receipt on the actual clearance date', async () => {
    const id = await fx.cheque.recordReceivedCheque({
      chartId: fx.agentHeadId,
      chequeNumber: 'CHQ-3',
      amount: 100,
      receivedDate: '2026-01-01',
      allocations: [{ accountId: fx.shopId, amount: 100 }],
    });
    const cleared = await fx.cheque.clearCheque({
      chequeId: id,
      bankAccountId: fx.bankId,
      actualClearanceDate: '2026-01-15',
    });
    expect(cleared.status).toBe('cleared');
    expect(cleared.actualClearanceDate).toBe('2026-01-15');
    expect(cleared.clearedJournalId).not.toBeNull();
    await expect(
      fx.cheque.clearCheque({
        chequeId: id,
        bankAccountId: fx.bankId,
        actualClearanceDate: '2026-01-20',
      }),
    ).rejects.toThrow('already cleared');
  });

  it('marks bounced and allows re-presentment then clearance', async () => {
    const id = await fx.cheque.recordReceivedCheque({
      chartId: fx.agentHeadId,
      chequeNumber: 'CHQ-4',
      amount: 50,
      receivedDate: '2026-01-01',
      allocations: [{ accountId: fx.shopId, amount: 50 }],
    });
    const p1 = await fx.cheque.markBounced(id, '2026-01-05', 'bounced once');
    expect(p1).toBeGreaterThan(0);
    const after = await fx.cheque.getCheque(id);
    expect(after.status).toBe('bounced');
    expect(after.presentments).toHaveLength(1);
    expect(after.presentments?.[0].outcome).toBe('bounced');

    const p2 = await fx.cheque.addPresentment({
      chequeId: id,
      presentmentDate: '2026-01-10',
      outcome: 'pending',
      notes: 're-presented',
    });
    expect(p2).toBeGreaterThan(0);
    const cleared = await fx.cheque.clearCheque({
      chequeId: id,
      bankAccountId: fx.bankId,
      actualClearanceDate: '2026-01-12',
    });
    expect(cleared.status).toBe('cleared');
    expect(cleared.actualClearanceDate).toBe('2026-01-12');
  });

  it('transfers custody without clearing and logs an event', async () => {
    const id = await fx.cheque.recordReceivedCheque({
      chartId: fx.agentHeadId,
      chequeNumber: 'CHQ-5',
      amount: 75,
      receivedDate: '2026-01-01',
      allocations: [{ accountId: fx.shopId, amount: 75 }],
    });
    await fx.cheque.transferCustody({
      chequeId: id,
      toHolder: 'agent',
      eventDate: '2026-01-02',
      heldForCommission: true,
      notes: 'handed to agent',
    });
    const c = await fx.cheque.getCheque(id);
    expect(c.status).toBe('pending');
    expect(c.holder).toBe('agent');
    expect(c.heldForCommission).toBe(true);
    expect(c.presentments).toHaveLength(0);
    expect(c.custodyEvents).toHaveLength(2);
  });

  it('links a cheque to a commission settlement with duplicate guard', async () => {
    const id = await fx.cheque.recordReceivedCheque({
      chartId: fx.agentHeadId,
      chequeNumber: 'CHQ-6',
      amount: 40,
      receivedDate: '2026-01-01',
      allocations: [{ accountId: fx.shopId, amount: 40 }],
    });
    await fx.cheque.applyToCommission(id, 999, 40);
    const c = await fx.cheque.getCheque(id);
    expect(c.commissionSettlementId).toBe(999);
    expect(c.commissionAppliedAmount).toBe(40);
    await expect(fx.cheque.applyToCommission(id, 1000, 10)).rejects.toThrow(
      'already linked',
    );
  });
});
