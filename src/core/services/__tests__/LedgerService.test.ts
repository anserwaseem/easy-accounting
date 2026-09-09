import Database from 'better-sqlite3';
import { BalanceType } from 'types';
import { AccountService } from '../AccountService';
import { LedgerService } from '../LedgerService';
import type { SessionContext } from '../../ports';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { LedgerService as MainLedgerService } from '../../../main/services/Ledger.service';
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
    ledger: new LedgerService({ db: driver, session }),
  };
}

/** The old main-process service, bound to a given db the way its tests do. */
function createMainService(db: Database.Database): MainLedgerService {
  const service = Object.create(MainLedgerService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).initPreparedStatements();
  return service as MainLedgerService;
}

/** insert an account directly (FK target for ledger rows), returns its id. */
async function insertAccount(
  db: Database.Database,
  accounts: AccountService,
  name: string,
  code: number,
): Promise<number> {
  await accounts.insertAccount({
    name,
    headName: 'Current Asset',
    code,
    address: null,
    phone1: null,
    phone2: null,
    goodsName: null,
    discountProfileId: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  const row = db.prepare(`SELECT id FROM account WHERE name = ?`).get(name) as {
    id: number;
  };
  return row.id;
}

const aLedgerEntry = (
  accountId: number,
  overrides: Record<string, unknown> = {},
) =>
  ({
    date: '2025-01-01',
    accountId,
    debit: 100,
    credit: 0,
    balance: 100,
    balanceType: BalanceType.Dr,
    particulars: 'Opening balance',
    linkedAccountId: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

/**
 * docs/derived-state-design.md §6 migration 028: ledger_view is sourced
 * entirely from journal/journal_entry — a row written straight into the
 * `ledger` table via `insertLedger` (as `aLedgerEntry` above does) has no
 * backing journal_entry and so is invisible to every view-backed read
 * (getLedger, getBalance, etc. below `insertJournalPair`). Tests of those
 * read methods seed real facts through this helper instead. Tests of the
 * write-path primitives themselves (insertLedger, deleteLedger,
 * hasNewerEntries — all still operating on the stored `ledger` table
 * unchanged, per the class doc comment) keep using `aLedgerEntry` and assert
 * against the stored table directly.
 */
async function insertJournalPair(
  db: Database.Database,
  opts: {
    date: string;
    debitAccountId: number;
    creditAccountId: number;
    amount: number;
  },
): Promise<number> {
  const { date, debitAccountId, creditAccountId, amount } = opts;
  const journalResult = db
    .prepare(
      `INSERT INTO journal (date, narration, isPosted) VALUES (?, 'test journal', 1)`,
    )
    .run(date);
  const journalId = Number(journalResult.lastInsertRowid);
  db.prepare(
    `INSERT INTO journal_entry (journalId, debitAmount, creditAmount, accountId) VALUES (?, ?, 0, ?)`,
  ).run(journalId, amount, debitAccountId);
  db.prepare(
    `INSERT INTO journal_entry (journalId, debitAmount, creditAmount, accountId) VALUES (?, 0, ?, ?)`,
  ).run(journalId, amount, creditAccountId);
  return journalId;
}

describe('core LedgerService — write-path primitives (stored `ledger` table, unchanged by migration 028)', () => {
  it('insertLedger writes rows directly readable back from the stored table', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger } = createCore(db);
    const accountId = await insertAccount(db, accounts, 'Customer A', 101);

    await ledger.insertLedger(
      aLedgerEntry(accountId, { date: '2025-01-02', particulars: 'Second' }),
    );
    await ledger.insertLedger(
      aLedgerEntry(accountId, { date: '2025-01-01', particulars: 'First' }),
    );

    const stored = db
      .prepare(
        `SELECT particulars FROM ledger WHERE accountId = ? ORDER BY datetime(date, 'localtime') ASC, id ASC`,
      )
      .all(accountId) as Array<{ particulars: string }>;
    expect(stored.map((r) => r.particulars)).toEqual(['First', 'Second']);
    db.close();
  });

  it('deleteLedger removes all stored entries for the account', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger } = createCore(db);
    const accountId = await insertAccount(db, accounts, 'Customer A', 101);

    await ledger.insertLedger(aLedgerEntry(accountId));
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS c FROM ledger WHERE accountId = ?`)
          .get(accountId) as { c: number }
      ).c,
    ).toBe(1);

    await ledger.deleteLedger(accountId);
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS c FROM ledger WHERE accountId = ?`)
          .get(accountId) as { c: number }
      ).c,
    ).toBe(0);
    db.close();
  });

  it('hasNewerEntries reports whether stored entries exist after a given date', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger } = createCore(db);
    const accountId = await insertAccount(db, accounts, 'Customer A', 101);

    await ledger.insertLedger(aLedgerEntry(accountId, { date: '2025-01-05' }));

    expect(await ledger.hasNewerEntries(accountId, '2025-01-01')).toBe(true);
    expect(await ledger.hasNewerEntries(accountId, '2025-01-10')).toBe(false);
    db.close();
  });

  it('getStoredLedger/getStoredBalance read the stored table (write-path internals JournalService relies on)', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger } = createCore(db);
    const accountId = await insertAccount(db, accounts, 'Customer A', 101);

    await ledger.insertLedger(
      aLedgerEntry(accountId, { date: '2025-01-01', balance: 100 }),
    );
    await ledger.insertLedger(
      aLedgerEntry(accountId, { date: '2025-01-05', balance: 300 }),
    );

    const stored = await ledger.getStoredLedger(accountId);
    expect(stored).toHaveLength(2);
    expect(stored.at(-1)!.balance).toBe(300);

    expect(await ledger.getStoredBalance(accountId)).toEqual({
      balance: 300,
      balanceType: BalanceType.Dr,
    });
    db.close();
  });
});

describe('core LedgerService — canonical reads (ledger_view, migration 028)', () => {
  it('getLedger reads entries ordered by date, reconstructing the real counterparty', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger } = createCore(db);
    const customerA = await insertAccount(db, accounts, 'Customer A', 101);
    const counterparty = await insertAccount(db, accounts, 'Payable', 201);

    await insertJournalPair(db, {
      date: '2025-01-02',
      debitAccountId: customerA,
      creditAccountId: counterparty,
      amount: 50,
    });
    await insertJournalPair(db, {
      date: '2025-01-01',
      debitAccountId: customerA,
      creditAccountId: counterparty,
      amount: 30,
    });

    const rows = await ledger.getLedger(customerA);
    expect(rows.map((r) => r.date)).toEqual(['2025-01-01', '2025-01-02']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((rows[0] as any).linkedAccountName).toBe('Payable');
    expect(rows[0].balance).toBe(30);
    expect(rows[1].balance).toBe(80);
    db.close();
  });

  it('getBalance returns the latest running balance from ledger_view', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger } = createCore(db);
    const accountId = await insertAccount(db, accounts, 'Customer A', 101);
    const counterparty = await insertAccount(db, accounts, 'Payable', 201);

    expect(await ledger.getBalance(accountId)).toBeUndefined();

    await insertJournalPair(db, {
      date: '2025-01-01',
      debitAccountId: accountId,
      creditAccountId: counterparty,
      amount: 100,
    });
    await insertJournalPair(db, {
      date: '2025-01-05',
      debitAccountId: accountId,
      creditAccountId: counterparty,
      amount: 200,
    });

    expect(await ledger.getBalance(accountId)).toEqual({
      balance: 300,
      balanceType: BalanceType.Dr,
    });
    db.close();
  });

  it('getBalanceAtDate returns the last entry strictly before the date', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger } = createCore(db);
    const accountId = await insertAccount(db, accounts, 'Customer A', 101);
    const counterparty = await insertAccount(db, accounts, 'Payable', 201);

    await insertJournalPair(db, {
      date: '2025-01-01',
      debitAccountId: accountId,
      creditAccountId: counterparty,
      amount: 100,
    });
    await insertJournalPair(db, {
      date: '2025-01-10',
      debitAccountId: accountId,
      creditAccountId: counterparty,
      amount: 400,
    });

    const atDate = await ledger.getBalanceAtDate(accountId, '2025-01-10');
    expect(atDate).toEqual({
      balance: 100,
      balanceType: BalanceType.Dr,
      date: '2025-01-01',
    });

    expect(await ledger.getBalanceAtDate(accountId, '2025-01-01')).toBeNull();
    db.close();
  });

  it('getLedgerRange returns entries within an inclusive date range', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger } = createCore(db);
    const accountId = await insertAccount(db, accounts, 'Customer A', 101);
    const counterparty = await insertAccount(db, accounts, 'Payable', 201);

    await insertJournalPair(db, {
      date: '2025-01-01',
      debitAccountId: accountId,
      creditAccountId: counterparty,
      amount: 100,
    });
    await insertJournalPair(db, {
      date: '2025-01-05',
      debitAccountId: accountId,
      creditAccountId: counterparty,
      amount: 100,
    });
    await insertJournalPair(db, {
      date: '2025-01-10',
      debitAccountId: accountId,
      creditAccountId: counterparty,
      amount: 100,
    });

    const rows = await ledger.getLedgerRange(
      accountId,
      '2025-01-02',
      '2025-01-05',
    );
    expect(rows.map((r) => r.date)).toEqual(['2025-01-05']);
    db.close();
  });

  it('getBalancesForAccountIds returns latest balance per account', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger } = createCore(db);
    const accountA = await insertAccount(db, accounts, 'Customer A', 101);
    const accountB = await insertAccount(db, accounts, 'Customer B', 102);
    const counterparty = await insertAccount(db, accounts, 'Payable', 201);

    await insertJournalPair(db, {
      date: '2025-01-01',
      debitAccountId: accountA,
      creditAccountId: counterparty,
      amount: 100,
    });
    await insertJournalPair(db, {
      date: '2025-01-05',
      debitAccountId: accountA,
      creditAccountId: counterparty,
      amount: 300,
    });
    await insertJournalPair(db, {
      date: '2025-01-03',
      debitAccountId: accountB,
      creditAccountId: counterparty,
      amount: 50,
    });

    expect(await ledger.getBalancesForAccountIds([])).toEqual({});
    expect(
      await ledger.getBalancesForAccountIds([accountA, accountB, -1]),
    ).toEqual({
      [accountA]: { balance: 400, balanceType: BalanceType.Dr },
      [accountB]: { balance: 50, balanceType: BalanceType.Dr },
    });
    db.close();
  });

  it('getBalancesForAccountIdsAsOfDate returns balance on or before the date', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger } = createCore(db);
    const accountId = await insertAccount(db, accounts, 'Customer A', 101);
    const counterparty = await insertAccount(db, accounts, 'Payable', 201);

    await insertJournalPair(db, {
      date: '2025-01-01',
      debitAccountId: accountId,
      creditAccountId: counterparty,
      amount: 100,
    });
    await insertJournalPair(db, {
      date: '2025-01-10',
      debitAccountId: accountId,
      creditAccountId: counterparty,
      amount: 300,
    });

    expect(
      await ledger.getBalancesForAccountIdsAsOfDate([accountId], '2025-01-05'),
    ).toEqual({ [accountId]: { balance: 100, balanceType: BalanceType.Dr } });
    db.close();
  });

  it('getLedgerRangeForAccountIds and getLedgersUpToDateForAccountIds bucket rows per account', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger } = createCore(db);
    const accountA = await insertAccount(db, accounts, 'Customer A', 101);
    const accountB = await insertAccount(db, accounts, 'Customer B', 102);
    const counterparty = await insertAccount(db, accounts, 'Payable', 201);

    await insertJournalPair(db, {
      date: '2025-01-01',
      debitAccountId: accountA,
      creditAccountId: counterparty,
      amount: 100,
    });
    await insertJournalPair(db, {
      date: '2025-01-15',
      debitAccountId: accountA,
      creditAccountId: counterparty,
      amount: 100,
    });
    await insertJournalPair(db, {
      date: '2025-01-05',
      debitAccountId: accountB,
      creditAccountId: counterparty,
      amount: 100,
    });

    const ranged = await ledger.getLedgerRangeForAccountIds(
      [accountA, accountB],
      '2025-01-01',
      '2025-01-10',
    );
    expect(ranged[accountA]).toHaveLength(1);
    expect(ranged[accountB]).toHaveLength(1);

    const upTo = await ledger.getLedgersUpToDateForAccountIds(
      [accountA, accountB],
      '2025-01-10',
    );
    expect(upTo[accountA]).toHaveLength(1);
    expect(upTo[accountB]).toHaveLength(1);

    expect(
      await ledger.getLedgerRangeForAccountIds([], '2025-01-01', '2025-01-31'),
    ).toEqual({});
    db.close();
  });
});

describe('core LedgerService — parity with the main-process (legacy) LedgerService', () => {
  it('write-path primitives (insertLedger, stored reads) produce identical stored rows', async () => {
    // The old main-process service only ever reads the stored `ledger`
    // table — it has no view-backed equivalent, so a full parity check now
    // only makes sense for the write-path side (insertLedger + the new
    // getStoredLedger/getStoredBalance helpers), which is exactly what
    // stayed unchanged by migration 028. Read-side (view-canon) parity
    // between the two write paths (JournalService/StatementService) and the
    // views is covered instead by
    // src/core/services/__tests__/derivedStateEquivalence.test.ts, which
    // drives the real services rather than raw `ledger` table pokes (raw
    // pokes have no backing journal_entry, so they are invisible to
    // ledger_view by construction — see insertJournalPair's comment above).
    const dbOld = new Database(':memory:');
    const dbCore = new Database(':memory:');
    seedBasicSchema(dbOld);
    seedBasicSchema(dbCore);

    const oldService = createMainService(dbOld);
    const { accounts: coreAccounts, ledger: coreLedger } = createCore(dbCore);

    const accountIdOld = await insertAccount(
      dbOld,
      new AccountService({ db: new BetterSqliteDriver(dbOld), session }),
      'Customer A',
      101,
    );
    const accountIdCore = await insertAccount(
      dbCore,
      coreAccounts,
      'Customer A',
      101,
    );
    expect(accountIdCore).toBe(accountIdOld);

    const entries = [
      aLedgerEntry(accountIdOld, { date: '2025-01-01', balance: 100 }),
      aLedgerEntry(accountIdOld, { date: '2025-01-05', balance: 400 }),
      aLedgerEntry(accountIdOld, { date: '2025-01-03', balance: 200 }),
    ];
    entries.forEach((entry) => oldService.insertLedger(entry));
    await entries.reduce(
      (chain, entry) =>
        chain.then(async () => {
          await coreLedger.insertLedger(entry);
        }),
      Promise.resolve(),
    );

    expect(await coreLedger.getStoredLedger(accountIdCore)).toEqual(
      oldService.getLedger(accountIdOld),
    );
    expect(await coreLedger.getStoredBalance(accountIdCore)).toEqual(
      oldService.getBalance(accountIdOld),
    );

    dbOld.close();
    dbCore.close();
  });
});
