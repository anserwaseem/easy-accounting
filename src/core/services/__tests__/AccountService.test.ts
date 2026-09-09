import Database from 'better-sqlite3';
import { AccountService } from '../AccountService';
import { ChartService } from '../ChartService';
import type { SessionContext } from '../../ports';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { AccountService as MainAccountService } from '../../../main/services/Account.service';
import { OPENING_BALANCE_EQUITY_ACCOUNT_NAME } from '../../db/openingBalanceBackfill';
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
  ).run('2025-01-01', 'Current Liability', 'Liability', userId);
  return userId;
}

function createCore(db: Database.Database) {
  const driver = new BetterSqliteDriver(db);
  return {
    driver,
    accounts: new AccountService({ db: driver, session }),
    charts: new ChartService({ db: driver, session }),
  };
}

/** The old main-process service, bound to a given db the way its tests do. */
function createMainService(db: Database.Database): MainAccountService {
  const service = Object.create(MainAccountService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).initPreparedStatements();
  return service as MainAccountService;
}

const anAccount = (overrides: Record<string, unknown> = {}) =>
  ({
    name: 'Customer A',
    headName: 'Current Asset',
    code: 101,
    address: null,
    phone1: null,
    phone2: null,
    goodsName: null,
    discountProfileId: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe('core AccountService', () => {
  it('inserts and reads back an account with normalized booleans', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts } = createCore(db);

    expect(await accounts.insertAccount(anAccount())).toBe(true);

    const all = await accounts.getAccounts();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Customer A');
    expect(all[0].headName).toBe('Current Asset');
    expect(all[0].isActive).toBe(true); // 1 → true normalization
    db.close();
  });

  it('insertAccountIfNotExists returns the existing account and re-charts it when headName changes', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts } = createCore(db);

    await accounts.insertAccount(anAccount());
    const existing = await accounts.getAccountByName('Customer A');
    expect(existing).toBeDefined();

    const result = await accounts.insertAccountIfNotExists(
      anAccount({ headName: 'Current Liability' }),
    );
    expect(result.success).toBe(true);
    expect(result.accountId).toBe(existing!.id);

    const moved = await accounts.getAccountByName('Customer A');
    expect(moved!.headName).toBe('Current Liability');

    // still exactly one account — no duplicate was created
    expect(await accounts.getAccounts()).toHaveLength(1);
    db.close();
  });

  it('updateAccount and toggleAccountActive persist', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts } = createCore(db);

    await accounts.insertAccount(anAccount());
    const acc = (await accounts.getAccounts())[0];

    expect(
      await accounts.updateAccount(
        anAccount({ id: acc.id, name: 'Customer B' }),
      ),
    ).toBe(true);
    expect((await accounts.getAccountByName('Customer B'))?.id).toBe(acc.id);

    expect(await accounts.toggleAccountActive(acc.id, false)).toBe(true);
    expect((await accounts.getAccounts())[0].isActive).toBe(false);
    db.close();
  });

  it('deleteAccount refuses when journal entries reference the account', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts } = createCore(db);

    await accounts.insertAccount(anAccount());
    const acc = (await accounts.getAccounts())[0];

    const journalId = db
      .prepare(
        `INSERT INTO journal (date, narration, isPosted) VALUES ('2025-01-02', 'test', 1)`,
      )
      .run().lastInsertRowid;
    db.prepare(
      `INSERT INTO journal_entry (journalId, debitAmount, creditAmount, accountId) VALUES (?, 100, 0, ?)`,
    ).run(journalId, acc.id);

    expect(await accounts.hasJournalEntries(acc.id)).toBe(true);
    expect(await accounts.deleteAccount(acc.id)).toBe(false);
    expect(await accounts.getAccounts()).toHaveLength(1);

    db.prepare(`DELETE FROM journal_entry WHERE accountId = ?`).run(acc.id);
    expect(await accounts.deleteAccount(acc.id)).toBe(true);
    expect(await accounts.getAccounts()).toHaveLength(0);
    db.close();
  });

  it('getAccounts hides the system Opening Balance Equity account, but not a user account of the same name under a non-Equity chart', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, charts } = createCore(db);

    const equityChartId = Number(
      await charts.findOrCreateChart(
        'Equity',
        'Equity',
        USERNAME,
        '2025-01-01',
      ),
    );

    await accounts.insertAccount(
      anAccount({
        name: OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
        headName: 'Equity',
      }),
    );
    await accounts.insertAccount(
      anAccount({
        name: OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
        headName: 'Current Asset',
        code: 202,
      }),
    );
    await accounts.insertAccount(anAccount({ name: 'Customer A' }));

    const all = await accounts.getAccounts();
    expect(all.map((a) => a.name).sort()).toEqual([
      'Customer A',
      OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
    ]);
    const survivor = all.find(
      (a) => a.name === OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
    );
    expect(survivor?.headName).toBe('Current Asset');
    expect(survivor?.chartId).not.toBe(equityChartId);
    db.close();
  });

  it('getAccountByNameAndChart falls back to any chart', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, charts } = createCore(db);

    await accounts.insertAccount(anAccount());
    const acc = (await accounts.getAccounts())[0];
    const otherChartId = Number(
      await charts.findOrCreateChart(
        'Fixed Asset',
        'Asset',
        USERNAME,
        '2025-01-01',
      ),
    );
    expect(otherChartId).not.toBe(acc.chartId);

    const found = await accounts.getAccountByNameAndChart(
      otherChartId,
      ' Customer A ',
    );
    expect(found?.id).toBe(acc.id);
    db.close();
  });

  it('matches the main-process AccountService row for row', async () => {
    // Same operations against two identical databases — one through the old
    // sync service, one through core — must produce identical reads. This is
    // the no-behavior-change contract of the migration.
    const dbOld = new Database(':memory:');
    const dbCore = new Database(':memory:');
    seedBasicSchema(dbOld);
    seedBasicSchema(dbCore);

    const oldService = createMainService(dbOld);
    const { accounts: coreService } = createCore(dbCore);

    const inputs = [
      anAccount(),
      anAccount({
        name: 'Supplier X',
        headName: 'Current Liability',
        code: 201,
      }),
    ];
    inputs.forEach((account) => oldService.insertAccount(account));
    await inputs.reduce(
      (chain, account) =>
        chain.then(async () => {
          await coreService.insertAccount(account);
        }),
      Promise.resolve(),
    );

    oldService.updateAccount(anAccount({ id: 1, name: 'Customer A2' }));
    await coreService.updateAccount(anAccount({ id: 1, name: 'Customer A2' }));
    oldService.toggleAccountActive(2, false);
    await coreService.toggleAccountActive(2, false);

    const oldRows = oldService.getAccounts();
    const coreRows = await coreService.getAccounts();
    expect(coreRows).toEqual(oldRows);

    expect(await coreService.getAccountByName('Customer A2')).toEqual(
      oldService.getAccountByName('Customer A2'),
    );
    dbOld.close();
    dbCore.close();
  });
});

describe('BetterSqliteDriver transactions', () => {
  it('rolls back everything when the transaction body throws', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { driver, accounts } = createCore(db);

    await expect(
      driver.transaction(async () => {
        await accounts.insertAccount(anAccount());
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await accounts.getAccounts()).toHaveLength(0);
    db.close();
  });

  it('commits on success and supports nesting via savepoints', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { driver, accounts } = createCore(db);

    await driver.transaction(async () => {
      await accounts.insertAccount(anAccount());
      // nested transaction that fails must roll back only its own work
      await driver
        .transaction(async () => {
          await accounts.insertAccount(
            anAccount({ name: 'Nested', code: 999 }),
          );
          throw new Error('inner');
        })
        .catch(() => undefined);
    });

    const rows = await accounts.getAccounts();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Customer A');
    db.close();
  });
});
