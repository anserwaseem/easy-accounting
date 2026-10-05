import Database from 'better-sqlite3';
import { AccountService } from '../AccountService';
import { AgentTourService } from '../AgentTourService';
import { LedgerService } from '../LedgerService';
import type { SessionContext } from '../../ports';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../db/bootstrap';
import { BULK_RECEIPT_MIN_CREDIT_LINES } from '../../utils/suggestAgentTours';

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

interface Fixture {
  db: Database.Database;
  tours: AgentTourService;
  ledger: LedgerService;
  accounts: AccountService;
  agentHeadId: number;
  otherHeadId: number;
  currentAssetId: number;
  expenseId: number;
}

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
  collectionRole: string | null = null,
): number =>
  Number(
    db
      .prepare(
        `INSERT INTO account (chartId, name, code, collectionRole) VALUES (?, ?, ?, ?)`,
      )
      .run(chartId, name, name, collectionRole).lastInsertRowid,
  );

/** one manual journal: debits then credits, amounts must balance */
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

const setup = async (): Promise<Fixture> => {
  const db = new Database(':memory:');
  const driver = new BetterSqliteDriver(db);
  await bootstrapDatabase(driver);
  db.prepare(
    `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
  ).run(USERNAME, Buffer.from('x'));
  const { id: userId } = db
    .prepare(`SELECT id FROM users WHERE username = ?`)
    .get(USERNAME) as { id: number };
  const currentAssetId = insertChart(
    db,
    userId,
    'Current Asset',
    'Asset',
    null,
  );
  const expenseId = insertChart(db, userId, 'Expense', 'Expense', null);
  const agentHeadId = insertChart(
    db,
    userId,
    "Shahbaz's Parties",
    'Asset',
    currentAssetId,
  );
  const otherHeadId = insertChart(
    db,
    userId,
    "Tariq's Parties",
    'Asset',
    currentAssetId,
  );
  return {
    db,
    tours: new AgentTourService({ db: driver, session }),
    ledger: new LedgerService({ db: driver, session }),
    accounts: new AccountService({ db: driver, session }),
    agentHeadId,
    otherHeadId,
    currentAssetId,
    expenseId,
  };
};

describe('AgentTourService', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await setup();
  });

  afterEach(() => fx.db.close());

  it('saves tours for a custom head and lists them newest first', async () => {
    await fx.tours.insertAgentTour({
      chartId: fx.agentHeadId,
      name: 'Sep 2026',
      startDate: '2026-09-01',
      endDate: '2026-09-25',
    });
    await fx.tours.insertAgentTour({
      chartId: fx.agentHeadId,
      name: ' Oct 2026 ',
      startDate: '2026-09-26',
      endDate: null,
    });
    const list = await fx.tours.getAgentTours(fx.agentHeadId);
    expect(list.map((t) => t.name)).toEqual(['Oct 2026', 'Sep 2026']);
    expect(list[0].endDate).toBeNull();
  });

  it('rejects a main head, an end before start, and overlaps', async () => {
    await expect(
      fx.tours.insertAgentTour({
        chartId: fx.currentAssetId,
        name: 'X',
        startDate: '2026-01-01',
        endDate: null,
      }),
    ).rejects.toThrow('custom head');
    await expect(
      fx.tours.insertAgentTour({
        chartId: fx.agentHeadId,
        name: 'X',
        startDate: '2026-02-10',
        endDate: '2026-02-01',
      }),
    ).rejects.toThrow('end before');

    await fx.tours.insertAgentTour({
      chartId: fx.agentHeadId,
      name: 'Jan',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    await expect(
      fx.tours.insertAgentTour({
        chartId: fx.agentHeadId,
        name: 'Clash',
        startDate: '2026-01-31',
        endDate: '2026-02-10',
      }),
    ).rejects.toThrow('Overlaps "Jan"');
    // another head is independent
    await expect(
      fx.tours.insertAgentTour({
        chartId: fx.otherHeadId,
        name: 'Jan',
        startDate: '2026-01-15',
        endDate: '2026-02-10',
      }),
    ).resolves.toEqual(expect.any(Number));
  });

  it('keeps a running tour the latest one', async () => {
    await fx.tours.insertAgentTour({
      chartId: fx.agentHeadId,
      name: 'Running',
      startDate: '2026-03-01',
      endDate: null,
    });
    await expect(
      fx.tours.insertAgentTour({
        chartId: fx.agentHeadId,
        name: 'Later',
        startDate: '2026-04-01',
        endDate: '2026-04-20',
      }),
    ).rejects.toThrow('Overlaps "Running"');
    await expect(
      fx.tours.insertAgentTour({
        chartId: fx.agentHeadId,
        name: 'Earlier',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      }),
    ).resolves.toEqual(expect.any(Number));
  });

  it('updates without clashing with itself, and deletes', async () => {
    const id = await fx.tours.insertAgentTour({
      chartId: fx.agentHeadId,
      name: 'Jan',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    await fx.tours.updateAgentTour(id, {
      chartId: fx.agentHeadId,
      name: 'January',
      startDate: '2026-01-02',
      endDate: '2026-02-02',
    });
    const [saved] = await fx.tours.getAgentTours(fx.agentHeadId);
    expect(saved).toMatchObject({ name: 'January', endDate: '2026-02-02' });
    expect(await fx.tours.deleteAgentTour(id)).toBe(true);
    expect(await fx.tours.getAgentTours(fx.agentHeadId)).toEqual([]);
  });

  it('saves a batch all or nothing', async () => {
    await expect(
      fx.tours.insertAgentTours([
        {
          chartId: fx.agentHeadId,
          name: 'A',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        },
        {
          chartId: fx.agentHeadId,
          name: 'B',
          startDate: '2026-01-20',
          endDate: '2026-02-20',
        },
      ]),
    ).rejects.toThrow('overlaps');
    expect(await fx.tours.getAgentTours(fx.agentHeadId)).toEqual([]);

    expect(
      await fx.tours.insertAgentTours([
        {
          chartId: fx.agentHeadId,
          name: 'A',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        },
        {
          chartId: fx.agentHeadId,
          name: 'B',
          startDate: '2026-02-01',
          endDate: '2026-02-28',
        },
      ]),
    ).toBe(2);
  });

  it('suggests one tour per bulk receipt day and skips saved windows', async () => {
    const cash = insertAccountRow(fx.db, fx.currentAssetId, 'Cash');
    const shops = Array.from(
      { length: BULK_RECEIPT_MIN_CREDIT_LINES },
      (_, i) => insertAccountRow(fx.db, fx.agentHeadId, `Shop ${i}`),
    );
    const settle = (date: string, lines: number[]) =>
      insertJournal(
        fx.db,
        date,
        [[cash, lines.length * 100]],
        lines.map((id) => [id, 100]),
      );
    settle('2026-07-26', shops);
    settle('2026-08-30', shops);
    // one shop paying alone is not a tour settlement
    settle('2026-08-10', [shops[0]]);
    settle('2026-09-27', shops.slice(0, BULK_RECEIPT_MIN_CREDIT_LINES - 1));

    const suggested = await fx.tours.suggestAgentTours(fx.agentHeadId);
    expect(suggested).toEqual([
      expect.objectContaining({
        name: 'Jul 2026',
        startDate: '2026-07-01',
        endDate: '2026-07-26',
        creditLines: BULK_RECEIPT_MIN_CREDIT_LINES,
      }),
      expect.objectContaining({
        name: 'Aug 2026',
        startDate: '2026-07-27',
        endDate: '2026-08-30',
      }),
    ]);
    expect(await fx.tours.suggestAgentTours(fx.otherHeadId)).toEqual([]);

    await fx.tours.insertAgentTour({
      chartId: fx.agentHeadId,
      name: 'July (real)',
      startDate: '2026-07-05',
      endDate: '2026-07-26',
    });
    const afterSave = await fx.tours.suggestAgentTours(fx.agentHeadId);
    expect(afterSave.map((t) => t.name)).toEqual(['Aug 2026']);
  });
});

describe('LedgerService.getTourCollectionsForAccountIds', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await setup();
  });

  afterEach(() => fx.db.close());

  it('counts receipt-account credits per tour and ignores the rest', async () => {
    const cash = insertAccountRow(fx.db, fx.currentAssetId, 'Cash');
    const transfer = insertAccountRow(
      fx.db,
      fx.currentAssetId,
      'Old balance',
      'exclude',
    );
    const discount = insertAccountRow(fx.db, fx.expenseId, 'Discount');
    const agentInHead = insertAccountRow(
      fx.db,
      fx.otherHeadId,
      'Received from Tariq',
      'receipt',
    );
    const shop = insertAccountRow(fx.db, fx.agentHeadId, 'Shop');
    const quiet = insertAccountRow(fx.db, fx.agentHeadId, 'Quiet shop');

    const jan = await fx.tours.insertAgentTour({
      chartId: fx.agentHeadId,
      name: 'Jan',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    const feb = await fx.tours.insertAgentTour({
      chartId: fx.agentHeadId,
      name: 'Feb',
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    });

    // default rule: top-level Asset counts, boundary days included
    insertJournal(fx.db, '2026-01-01', [[cash, 100]], [[shop, 100]]);
    insertJournal(fx.db, '2026-01-31', [[cash, 50]], [[shop, 50]]);
    // excluded transfer and an expense counterparty never count
    insertJournal(fx.db, '2026-01-15', [[transfer, 900]], [[shop, 900]]);
    insertJournal(fx.db, '2026-01-16', [[discount, 30]], [[shop, 30]]);
    // a receipt override inside a party head counts
    insertJournal(fx.db, '2026-02-10', [[agentInHead, 70]], [[shop, 70]]);
    // multi-line: only the cash share of the shop credit counts
    insertJournal(
      fx.db,
      '2026-02-20',
      [
        [cash, 60],
        [discount, 40],
      ],
      [[shop, 100]],
    );
    // outside every tour
    insertJournal(fx.db, '2026-03-05', [[cash, 999]], [[shop, 999]]);

    const paid = await fx.ledger.getTourCollectionsForAccountIds(
      [shop, quiet],
      [jan, feb],
    );
    expect(paid[shop][jan]).toBe(150);
    expect(paid[shop][feb]).toBe(130);
    expect(paid[quiet]).toBeUndefined();
  });

  it('runs a tour without an end date through today', async () => {
    const cash = insertAccountRow(fx.db, fx.currentAssetId, 'Cash');
    const shop = insertAccountRow(fx.db, fx.agentHeadId, 'Shop');
    const running = await fx.tours.insertAgentTour({
      chartId: fx.agentHeadId,
      name: 'Running',
      startDate: '2020-01-01',
      endDate: null,
    });
    insertJournal(fx.db, '2024-06-01', [[cash, 40]], [[shop, 40]]);
    const paid = await fx.ledger.getTourCollectionsForAccountIds(
      [shop],
      [running],
    );
    expect(paid[shop][running]).toBe(40);
    expect(await fx.ledger.getTourCollectionsForAccountIds([shop], [])).toEqual(
      {},
    );
  });
});

describe('AccountService collectionRole', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await setup();
  });

  afterEach(() => fx.db.close());

  it('round-trips and keeps the stored role when an update omits it', async () => {
    const id = insertAccountRow(fx.db, fx.currentAssetId, 'Cash');
    const base = {
      id,
      name: 'Cash',
      headName: 'Current Asset',
      code: 'Cash',
      address: '',
      phone1: '',
      phone2: '',
      goodsName: '',
      isActive: true,
    };
    await fx.accounts.updateAccount({ ...base, collectionRole: 'exclude' });
    const read = async () =>
      (await fx.accounts.getAccounts()).find((a) => a.id === id)
        ?.collectionRole;
    expect(await read()).toBe('exclude');

    await fx.accounts.updateAccount(base);
    expect(await read()).toBe('exclude');

    await fx.accounts.updateAccount({ ...base, collectionRole: null });
    expect(await read()).toBeNull();
  });
});
