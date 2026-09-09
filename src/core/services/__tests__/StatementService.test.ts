import Database from 'better-sqlite3';
import { BalanceType, type BalanceSheet } from 'types';
import { AccountService } from '../AccountService';
import { ChartService } from '../ChartService';
import { LedgerService } from '../LedgerService';
import { StatementService } from '../StatementService';
import type { SessionContext } from '../../ports';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { AccountService as MainAccountService } from '../../../main/services/Account.service';
import { ChartService as MainChartService } from '../../../main/services/Chart.service';
import { LedgerService as MainLedgerService } from '../../../main/services/Ledger.service';
import { StatementService as MainStatementService } from '../../../main/services/Statement.service';
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

/**
 * Statement.service's setupLedgers calls accountService.insertAccountIfNotExists
 * WITHOUT a `discountProfileId` key (see src/main/services/Statement.service.ts:112-121,
 * preserved verbatim in the port). insertAccount's SQL binds `@discountProfileId` as a
 * named parameter, and better-sqlite3 throws "Missing named parameter" when a brand new
 * account must be inserted through this path — a pre-existing bug in the original
 * service, not introduced by the port (see the "matches main-process" and "surfaces the
 * pre-existing insertAccountIfNotExists bug" tests below, which confirm main and core
 * fail identically). insertAccountIfNotExists only reaches the INSERT when no matching
 * account already exists, so tests that want a clean end-to-end run pre-seed the account.
 */
function seedExistingAccount(
  db: Database.Database,
  userId: number,
  name: string,
  chartName: string,
) {
  const chart = db
    .prepare(`SELECT id FROM chart WHERE name = ? AND userId = ?`)
    .get(chartName, userId) as { id: number };
  db.prepare(
    `INSERT INTO account (name, chartId, code, isActive) VALUES (?, ?, NULL, 1)`,
  ).run(name, chart.id);
}

function createCore(db: Database.Database) {
  const driver = new BetterSqliteDriver(db);
  const chartService = new ChartService({ db: driver, session });
  const accountService = new AccountService({ db: driver, session });
  const ledgerService = new LedgerService({ db: driver, session });
  const statementService = new StatementService({
    db: driver,
    session,
    chartService,
    accountService,
    ledgerService,
  });
  return {
    driver,
    charts: chartService,
    accounts: accountService,
    ledger: ledgerService,
    statements: statementService,
  };
}

/** The old main-process services, bound to a given db the way their own tests do. */
function createMainService(db: Database.Database): MainStatementService {
  const chartService = Object.create(MainChartService.prototype);
  (chartService as any).db = db;
  (chartService as any).initPreparedStatements();

  const accountService = Object.create(MainAccountService.prototype);
  (accountService as any).db = db;
  (accountService as any).initPreparedStatements();

  const ledgerService = Object.create(MainLedgerService.prototype);
  (ledgerService as any).db = db;
  (ledgerService as any).initPreparedStatements();

  const statementService = Object.create(MainStatementService.prototype);
  (statementService as any).db = db;
  (statementService as any).chartService = chartService;
  (statementService as any).accountService = accountService;
  (statementService as any).ledgerService = ledgerService;
  return statementService as MainStatementService;
}

const aBalanceSheet = (overrides: Partial<BalanceSheet> = {}): BalanceSheet =>
  ({
    date: new Date('2025-06-01T00:00:00.000Z'),
    assets: {
      current: { 'Cash and Bank': [{ name: 'Cash', amount: 1000 }] },
      totalCurrent: 1000,
      fixed: {},
      totalFixed: 0,
      total: 1000,
    },
    liabilities: {
      current: {},
      totalCurrent: 0,
      fixed: {},
      totalFixed: 0,
      total: 0,
    },
    equity: {
      current: {},
      total: 0,
    },
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe('core StatementService', () => {
  it('re-charts an existing account into a custom head and posts a debit opening balance for a positive asset', async () => {
    const db = new Database(':memory:');
    const userId = seedBasicSchema(db);
    seedExistingAccount(db, userId, 'Cash', 'Current Asset');
    const { statements, charts, accounts, ledger } = createCore(db);

    expect(await statements.saveBalanceSheet(aBalanceSheet())).toBe(true);

    const allCharts = await charts.getCharts();
    const customHead = allCharts.find((c) => c.name === 'Cash and Bank');
    expect(customHead).toBeDefined();
    expect(customHead!.type).toBe('Asset');
    // custom head hangs off the existing "Current Asset" parent
    const parent = allCharts.find((c) => c.name === 'Current Asset');
    expect(customHead!.parentId).toBe(parent!.id);

    const account = await accounts.getAccountByName('Cash');
    expect(account).toBeDefined();
    expect(account!.headName).toBe('Cash and Bank');

    const rows = await ledger.getLedger(account!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      debit: 1000,
      credit: 0,
      balance: 1000,
      balanceType: BalanceType.Dr,
      particulars: 'Opening Balance from B/S',
    });
    db.close();
  });

  it('treats a negative asset amount as a credit (contra) balance', async () => {
    const db = new Database(':memory:');
    const userId = seedBasicSchema(db);
    seedExistingAccount(db, userId, 'Overdraft', 'Current Asset');
    const { statements, accounts, ledger } = createCore(db);

    await statements.saveBalanceSheet(
      aBalanceSheet({
        assets: {
          current: { 'Cash and Bank': [{ name: 'Overdraft', amount: -500 }] },
          totalCurrent: -500,
          fixed: {},
          totalFixed: 0,
          total: -500,
        },
      }),
    );

    const account = await accounts.getAccountByName('Overdraft');
    const rows = await ledger.getLedger(account!.id);
    expect(rows[0]).toMatchObject({
      debit: 0,
      credit: 500,
      balance: 500,
      balanceType: BalanceType.Cr,
    });
    db.close();
  });

  it('uses the default head name and credits a positive liability, into the seeded "Current Liability" chart', async () => {
    const db = new Database(':memory:');
    const userId = seedBasicSchema(db);
    seedExistingAccount(db, userId, 'Accounts Payable', 'Current Liability');
    const { statements, charts, accounts, ledger } = createCore(db);

    await statements.saveBalanceSheet(
      aBalanceSheet({
        assets: {
          current: {},
          totalCurrent: 0,
          fixed: {},
          totalFixed: 0,
          total: 0,
        },
        liabilities: {
          current: { '': [{ name: 'Accounts Payable', amount: 2000 }] },
          totalCurrent: 2000,
          fixed: {},
          totalFixed: 0,
          total: 2000,
        },
      }),
    );

    const allCharts = await charts.getCharts();
    // no new chart created — reuses the seeded "Current Liability" head
    expect(
      allCharts.filter((c) => c.name === 'Current Liability'),
    ).toHaveLength(1);

    const account = await accounts.getAccountByName('Accounts Payable');
    expect(account!.headName).toBe('Current Liability');
    const rows = await ledger.getLedger(account!.id);
    expect(rows[0]).toMatchObject({
      debit: 0,
      credit: 2000,
      balance: 2000,
      balanceType: BalanceType.Cr,
    });
    db.close();
  });

  it('debits a negative liability and credits a positive equity balance, creating the Equity chart on demand', async () => {
    const db = new Database(':memory:');
    const userId = seedBasicSchema(db);
    seedExistingAccount(db, userId, 'Loan Prepaid', 'Current Liability');
    seedExistingAccount(db, userId, 'Retained Earnings', 'Current Liability');
    const { statements, charts, accounts, ledger } = createCore(db);

    await statements.saveBalanceSheet(
      aBalanceSheet({
        assets: {
          current: {},
          totalCurrent: 0,
          fixed: {},
          totalFixed: 0,
          total: 0,
        },
        liabilities: {
          current: { '': [{ name: 'Loan Prepaid', amount: -300 }] },
          totalCurrent: -300,
          fixed: {},
          totalFixed: 0,
          total: -300,
        },
        equity: {
          current: { '': [{ name: 'Retained Earnings', amount: 750 }] },
          total: 750,
        },
      }),
    );

    const loan = await accounts.getAccountByName('Loan Prepaid');
    const loanRows = await ledger.getLedger(loan!.id);
    expect(loanRows[0]).toMatchObject({
      debit: 300,
      credit: 0,
      balanceType: BalanceType.Dr,
    });

    const retained = await accounts.getAccountByName('Retained Earnings');
    expect(retained!.headName).toBe('Equity');
    const equityChart = (await charts.getCharts()).find(
      (c) => c.name === 'Equity',
    );
    expect(equityChart).toBeDefined();
    expect(equityChart!.type).toBe('Equity');
    const retainedRows = await ledger.getLedger(retained!.id);
    expect(retainedRows[0]).toMatchObject({
      debit: 0,
      credit: 750,
      balanceType: BalanceType.Cr,
    });
    db.close();
  });

  it('surfaces the pre-existing insertAccountIfNotExists bug: saving a brand-new account fails and rolls back cleanly', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { statements, charts, accounts } = createCore(db);

    // 'Cash' does not pre-exist, so insertAccountIfNotExists must INSERT it —
    // and the calling code (ported verbatim from main) omits discountProfileId,
    // which better-sqlite3 rejects. saveBalanceSheet catches the throw and
    // returns false, exactly like the original main-process service.
    const result = await statements.saveBalanceSheet(aBalanceSheet());
    expect(result).toBe(false);

    // the whole transaction rolled back — no partial writes survive, even
    // though earlier chart lookups/creates ran before the failing insert.
    expect(await charts.getCharts()).toHaveLength(2);
    expect(await accounts.getAccounts()).toHaveLength(0);
    db.close();
  });

  it('rolls back every write and returns false when a later write mid-save fails', async () => {
    const db = new Database(':memory:');
    const userId = seedBasicSchema(db);
    seedExistingAccount(db, userId, 'Cash', 'Current Asset');
    const { statements, charts, accounts, ledger } = createCore(db);

    jest.spyOn(ledger, 'insertLedger').mockRejectedValueOnce(new Error('boom'));

    const result = await statements.saveBalanceSheet(aBalanceSheet());
    expect(result).toBe(false);

    // even the chart created before the failing ledger insert is rolled back
    expect(await charts.getCharts()).toHaveLength(2);
    expect((await accounts.getAccountByName('Cash'))!.headName).toBe(
      'Current Asset',
    );
    db.close();
  });

  it('matches the main-process StatementService: both fail identically for a brand-new account', async () => {
    const dbOld = new Database(':memory:');
    const dbCore = new Database(':memory:');
    seedBasicSchema(dbOld);
    seedBasicSchema(dbCore);

    const oldService = createMainService(dbOld);
    const { statements: coreService } = createCore(dbCore);

    const balanceSheet = aBalanceSheet();
    expect(oldService.saveBalanceSheet(balanceSheet)).toBe(false);
    expect(await coreService.saveBalanceSheet(balanceSheet)).toBe(false);

    expect(dbOld.prepare(`SELECT COUNT(*) as c FROM account`).get()).toEqual(
      dbCore.prepare(`SELECT COUNT(*) as c FROM account`).get(),
    );
    dbOld.close();
    dbCore.close();
  });

  it('matches the main-process StatementService row for row when accounts pre-exist', async () => {
    const dbOld = new Database(':memory:');
    const dbCore = new Database(':memory:');
    const userIdOld = seedBasicSchema(dbOld);
    const userIdCore = seedBasicSchema(dbCore);
    seedExistingAccount(
      dbOld,
      userIdOld,
      'Accounts Payable',
      'Current Liability',
    );
    seedExistingAccount(
      dbOld,
      userIdOld,
      'Retained Earnings',
      'Current Liability',
    );
    seedExistingAccount(
      dbCore,
      userIdCore,
      'Accounts Payable',
      'Current Liability',
    );
    seedExistingAccount(
      dbCore,
      userIdCore,
      'Retained Earnings',
      'Current Liability',
    );

    const oldService = createMainService(dbOld);
    const { statements: coreService, accounts: coreAccounts } =
      createCore(dbCore);

    const balanceSheet = aBalanceSheet({
      assets: {
        current: {},
        totalCurrent: 0,
        fixed: {},
        totalFixed: 0,
        total: 0,
      },
      liabilities: {
        current: { '': [{ name: 'Accounts Payable', amount: 2000 }] },
        totalCurrent: 2000,
        fixed: {},
        totalFixed: 0,
        total: 2000,
      },
      equity: {
        current: { '': [{ name: 'Retained Earnings', amount: 750 }] },
        total: 750,
      },
    });

    expect(oldService.saveBalanceSheet(balanceSheet)).toBe(true);
    expect(await coreService.saveBalanceSheet(balanceSheet)).toBe(true);

    const oldAccounts = Object.create(MainAccountService.prototype);
    (oldAccounts as any).db = dbOld;
    (oldAccounts as any).initPreparedStatements();

    const oldRows = (oldAccounts as MainAccountService).getAccounts();
    // coreAccounts.getAccounts() (the list query) now also excludes the
    // system "Opening Balance Equity" account — see AccountService's
    // getAccounts SQL comment — so it matches old row for old row directly,
    // with no need to filter it out by hand any more.
    const coreRows = await coreAccounts.getAccounts();
    expect(coreRows).toEqual(oldRows);

    // The account still exists underneath (see the comment block on
    // StatementService.setupLedgers) — just hidden from the list — so its
    // presence is confirmed via a direct query, the same way this file
    // confirms other structural-record side effects (e.g. journalCount
    // below) that the list-facing service methods now hide by design.
    const equityAccountRow = dbCore
      .prepare(
        `SELECT a.name, c.name as headName FROM account a
         JOIN chart c ON c.id = a.chartId
         WHERE a.name = 'Opening Balance Equity'`,
      )
      .get() as { name: string; headName: string } | undefined;
    expect(equityAccountRow).toBeDefined();
    expect(equityAccountRow!.headName).toBe('Equity');

    dbOld.close();
    dbCore.close();
  });

  describe('dual write: journal facts alongside the unchanged ledger row', () => {
    it('writes a balanced journal + two journal_entry rows for a positive asset, with no ledger row on the equity side', async () => {
      const db = new Database(':memory:');
      const userId = seedBasicSchema(db);
      seedExistingAccount(db, userId, 'Cash', 'Current Asset');
      const { statements, accounts, ledger } = createCore(db);

      expect(await statements.saveBalanceSheet(aBalanceSheet())).toBe(true);

      const cash = await accounts.getAccountByName('Cash');
      const equity = await accounts.getAccountByName('Opening Balance Equity');
      expect(equity).toBeDefined();
      expect(equity!.id).not.toBe(cash!.id);

      // ledger: exactly the one row on the account's own side, unchanged
      // from what this method wrote before the dual-write fix.
      const cashLedgerRows = await ledger.getLedger(cash!.id);
      expect(cashLedgerRows).toHaveLength(1);
      expect(cashLedgerRows[0]).toMatchObject({
        debit: 1000,
        credit: 0,
        balance: 1000,
        balanceType: BalanceType.Dr,
        particulars: 'Opening Balance from B/S',
      });
      // Pre-cutover: no STORED ledger row exists for the equity (contra)
      // side — StatementService.setupLedgers only ever calls
      // ledgerService.insertLedger for the primary account (unchanged,
      // dual-write rule). But ledger.getLedger now reads ledger_view
      // (migration 028), which is derived from journal_entry — and this
      // journal's contra-side journal_entry row (backfilled by migration
      // 025 / written by StatementService going forward) is a real fact on
      // the equity account, so the view correctly reconstructs a row there
      // for the first time (exactly the "users will see the correct linked
      // account for these rows for the first time" case
      // derivedStateEquivalence.test.ts documents).
      const equityLedgerRows = await ledger.getLedger(equity!.id);
      expect(equityLedgerRows).toHaveLength(1);
      expect(equityLedgerRows[0]).toMatchObject({
        debit: 0,
        credit: 1000,
        balance: 1000,
        balanceType: BalanceType.Cr,
        particulars: 'Opening Balance from B/S',
        linkedAccountId: cash!.id,
      });
      // the STORED table, still legacy-write-only, keeps the pre-cutover
      // shape: no row on the equity side.
      const storedEquityRows = db
        .prepare(`SELECT COUNT(*) AS c FROM ledger WHERE accountId = ?`)
        .get(equity!.id) as { c: number };
      expect(storedEquityRows.c).toBe(0);

      const journals = db
        .prepare(`SELECT * FROM journal WHERE narration = ?`)
        .all('Opening Balance from B/S') as {
        id: number;
        date: string;
        isPosted: number;
      }[];
      expect(journals).toHaveLength(1);
      expect(journals[0].isPosted).toBe(1);

      const entries = db
        .prepare(`SELECT * FROM journal_entry WHERE journalId = ?`)
        .all(journals[0].id) as {
        accountId: number;
        debitAmount: number;
        creditAmount: number;
      }[];
      expect(entries).toHaveLength(2);

      const cashEntry = entries.find((e) => e.accountId === cash!.id);
      const equityEntry = entries.find((e) => e.accountId === equity!.id);
      expect(cashEntry).toMatchObject({ debitAmount: 1000, creditAmount: 0 });
      expect(equityEntry).toMatchObject({ debitAmount: 0, creditAmount: 1000 });

      // balanced
      const totalDebit = entries.reduce((s, e) => s + e.debitAmount, 0);
      const totalCredit = entries.reduce((s, e) => s + e.creditAmount, 0);
      expect(totalDebit).toBe(totalCredit);

      db.close();
    });

    it('reuses the same "Opening Balance Equity" account across every section in one save', async () => {
      const db = new Database(':memory:');
      const userId = seedBasicSchema(db);
      seedExistingAccount(db, userId, 'Cash', 'Current Asset');
      seedExistingAccount(db, userId, 'Accounts Payable', 'Current Liability');
      const { statements, charts } = createCore(db);

      await statements.saveBalanceSheet(
        aBalanceSheet({
          liabilities: {
            current: {
              '': [{ name: 'Accounts Payable', amount: 500 }],
            },
            totalCurrent: 500,
            fixed: {},
            totalFixed: 0,
            total: 500,
          },
        }),
      );

      // getAccounts() (the list query) now hides the system "Opening
      // Balance Equity" account by design (see AccountService's getAccounts
      // SQL comment) — confirm exactly one still exists underneath via a
      // direct query, same as this file's other structural-record checks.
      const equityAccountCount = (
        db
          .prepare(
            `SELECT COUNT(*) c FROM account WHERE name = 'Opening Balance Equity'`,
          )
          .get() as { c: number }
      ).c;
      expect(equityAccountCount).toBe(1);

      const equityCharts = (await charts.getCharts()).filter(
        (c) => c.name === 'Equity' && c.type === 'Equity',
      );
      expect(equityCharts).toHaveLength(1);

      const journalCount = (
        db
          .prepare(
            `SELECT count(*) c FROM journal WHERE narration = 'Opening Balance from B/S'`,
          )
          .get() as { c: number }
      ).c;
      expect(journalCount).toBe(2); // one per ledger row (Cash, Accounts Payable)

      db.close();
    });

    it('rolls the journal facts back in step with the ledger side on a mid-save failure', async () => {
      // same scenario as "rolls back every write and returns false..." above,
      // asserting the journal side rolls back in step with the ledger side.
      const db = new Database(':memory:');
      const userId = seedBasicSchema(db);
      seedExistingAccount(db, userId, 'Cash', 'Current Asset');
      const { statements, ledger } = createCore(db);

      jest
        .spyOn(ledger, 'insertLedger')
        .mockRejectedValueOnce(new Error('boom'));

      expect(await statements.saveBalanceSheet(aBalanceSheet())).toBe(false);

      const journalCount = (
        db.prepare(`SELECT count(*) c FROM journal`).get() as { c: number }
      ).c;
      expect(journalCount).toBe(0);

      db.close();
    });
  });
});
