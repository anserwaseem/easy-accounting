import Database from 'better-sqlite3';
import { omit } from 'lodash';
import { BalanceType } from 'types';
import type { Journal, JournalEntry } from 'types';
import { AccountService } from '../AccountService';
import { LedgerService } from '../LedgerService';
import { JournalService } from '../JournalService';
import type { SessionContext } from '../../ports';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { AccountService as MainAccountService } from '../../../main/services/Account.service';
import { LedgerService as MainLedgerService } from '../../../main/services/Ledger.service';
import { JournalService as MainJournalService } from '../../../main/services/Journal.service';
import { OPENING_BALANCE_PARTICULARS } from '../../db/openingBalanceBackfill';
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

const defaultAccountFields = {
  code: null,
  address: null,
  phone1: null,
  phone2: null,
  goodsName: null,
  discountProfileId: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

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
  db.prepare(
    `INSERT INTO chart (date, name, type, userId) VALUES (?, ?, ?, ?)`,
  ).run('2025-01-01', 'Revenue', 'Revenue', userId);
  return userId;
}

function createCore(db: Database.Database) {
  const driver = new BetterSqliteDriver(db);
  const accounts = new AccountService({ db: driver, session });
  const ledger = new LedgerService({ db: driver, session });
  const journal = new JournalService({
    db: driver,
    session,
    ledgerService: ledger,
  });
  return { driver, accounts, ledger, journal };
}

/** The old main-process services, bound to a given db the way their tests do. */
function createMainServices(db: Database.Database): {
  accounts: MainAccountService;
  ledger: MainLedgerService;
  journal: MainJournalService;
} {
  const accounts = Object.create(MainAccountService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (accounts as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (accounts as any).initPreparedStatements();

  const ledger = Object.create(MainLedgerService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ledger as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ledger as any).initPreparedStatements();

  const journal = Object.create(MainJournalService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (journal as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (journal as any).ledgerService = ledger;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (journal as any).initPreparedStatements();

  return {
    accounts: accounts as MainAccountService,
    ledger: ledger as MainLedgerService,
    journal: journal as MainJournalService,
  };
}

/** insert an account directly (via the given AccountService), returns its id. */
async function insertAccount(
  db: Database.Database,
  accounts: AccountService,
  name: string,
  headName: string,
): Promise<number> {
  await accounts.insertAccount({
    name,
    headName,
    ...defaultAccountFields,
  });
  const row = db.prepare(`SELECT id FROM account WHERE name = ?`).get(name) as {
    id: number;
  };
  return row.id;
}

const aJournal = (overrides: Partial<Journal> = {}): Journal =>
  ({
    id: 0,
    date: '2025-02-01',
    narration: 'test journal',
    isPosted: true,
    journalEntries: [] as JournalEntry[],
    ...overrides,
  }) as Journal;

describe('core JournalService', () => {
  it('insertJournal posts a simple debit/credit and updates ledger balances', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger, journal } = createCore(db);
    const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
    const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

    const posted = await journal.insertJournal(
      aJournal({
        journalEntries: [
          { accountId: cash, debitAmount: 1000, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 1000 },
        ] as JournalEntry[],
      }),
    );
    expect(posted).toBe(true);

    const cashLedger = await ledger.getLedger(cash);
    const saleLedger = await ledger.getLedger(sale);
    expect(cashLedger.at(-1)!.balance).toBe(1000);
    expect(cashLedger.at(-1)!.balanceType).toBe(BalanceType.Dr);
    expect(saleLedger.at(-1)!.balance).toBe(1000);
    expect(saleLedger.at(-1)!.balanceType).toBe(BalanceType.Cr);
    db.close();
  });

  it('rejects journals with multiple debits and multiple credits', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, journal } = createCore(db);
    const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
    const bank = await insertAccount(db, accounts, 'Bank', 'Current Asset');
    const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');
    const service = await insertAccount(db, accounts, 'Service', 'Revenue');

    await expect(
      journal.insertJournal(
        aJournal({
          journalEntries: [
            { accountId: cash, debitAmount: 100, creditAmount: 0 },
            { accountId: bank, debitAmount: 100, creditAmount: 0 },
            { accountId: sale, debitAmount: 0, creditAmount: 100 },
            { accountId: service, debitAmount: 0, creditAmount: 100 },
          ] as JournalEntry[],
        }),
      ),
    ).rejects.toThrow();
    db.close();
  });

  it('splits proportionally across multiple debits against a single credit', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger, journal } = createCore(db);
    const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
    const bank = await insertAccount(db, accounts, 'Bank', 'Current Asset');
    const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

    await journal.insertJournal(
      aJournal({
        journalEntries: [
          { accountId: cash, debitAmount: 600, creditAmount: 0 },
          { accountId: bank, debitAmount: 400, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 1000 },
        ] as JournalEntry[],
      }),
    );

    const cashLedger = await ledger.getLedger(cash);
    const bankLedger = await ledger.getLedger(bank);
    expect(cashLedger.at(-1)!.debit).toBe(600);
    expect(cashLedger.at(-1)!.balance).toBe(600);
    expect(bankLedger.at(-1)!.debit).toBe(400);
    expect(bankLedger.at(-1)!.balance).toBe(400);
    db.close();
  });

  it('splits proportionally across multiple credits against a single debit', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger, journal } = createCore(db);
    const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
    const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');
    const svc = await insertAccount(db, accounts, 'Service', 'Revenue');

    await journal.insertJournal(
      aJournal({
        journalEntries: [
          { accountId: cash, debitAmount: 1000, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 600 },
          { accountId: svc, debitAmount: 0, creditAmount: 400 },
        ] as JournalEntry[],
      }),
    );

    const saleLedger = await ledger.getLedger(sale);
    const svcLedger = await ledger.getLedger(svc);
    expect(saleLedger.at(-1)!.credit).toBe(600);
    expect(saleLedger.at(-1)!.balance).toBe(600);
    expect(svcLedger.at(-1)!.credit).toBe(400);
    expect(svcLedger.at(-1)!.balance).toBe(400);
    db.close();
  });

  it('rebuilds ledger balances chronologically when a past-dated journal is posted', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger, journal } = createCore(db);
    const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
    const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

    await journal.insertJournal(
      aJournal({
        date: '2025-02-10',
        journalEntries: [
          { accountId: cash, debitAmount: 1000, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 1000 },
        ] as JournalEntry[],
      }),
    );
    await journal.insertJournal(
      aJournal({
        date: '2025-02-05',
        journalEntries: [
          { accountId: cash, debitAmount: 500, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 500 },
        ] as JournalEntry[],
      }),
    );

    const cashLedger = await ledger.getLedger(cash);
    expect(cashLedger).toHaveLength(2);
    expect(cashLedger.at(-2)!.date).toBe('2025-02-05');
    expect(cashLedger.at(-2)!.balance).toBe(500);
    expect(cashLedger.at(-1)!.date).toBe('2025-02-10');
    expect(cashLedger.at(-1)!.balance).toBe(1500);
    db.close();
  });

  it('getJournal, getJournals and getJournalsByInvoiceId read back what was posted', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, journal } = createCore(db);
    const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
    const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

    await journal.insertJournal(
      aJournal({
        narration: 'Sale on credit',
        invoiceId: 42,
        journalEntries: [
          { accountId: cash, debitAmount: 250, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 250 },
        ] as JournalEntry[],
      }),
    );

    const nextId = await journal.getNextJournalId();
    const journalId = nextId - 1;

    const single = await journal.getJournal(journalId);
    expect(single.narration).toBe('Sale on credit');
    expect(single.journalEntries).toHaveLength(2);

    const all = await journal.getJournals();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(journalId);

    const byInvoice = await journal.getJournalsByInvoiceId(42);
    expect(byInvoice).toHaveLength(1);
    expect(await journal.getJournalsByInvoiceId(999)).toHaveLength(0);

    const ids = await journal.getJournalIdsByInvoiceId(42);
    expect(ids).toEqual([journalId]);
    db.close();
  });

  it('getJournals excludes opening-balance narration journals but keeps a normal journal, while ledger effects are unaffected', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger, journal } = createCore(db);
    const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
    const equity = await insertAccount(db, accounts, 'Owner Equity', 'Revenue');

    await journal.insertJournal(
      aJournal({
        narration: OPENING_BALANCE_PARTICULARS,
        journalEntries: [
          { accountId: cash, debitAmount: 5000, creditAmount: 0 },
          { accountId: equity, debitAmount: 0, creditAmount: 5000 },
        ] as JournalEntry[],
      }),
    );
    await journal.insertJournal(
      aJournal({
        narration: 'Sale on credit',
        journalEntries: [
          { accountId: cash, debitAmount: 250, creditAmount: 0 },
          { accountId: equity, debitAmount: 0, creditAmount: 250 },
        ] as JournalEntry[],
      }),
    );

    const list = await journal.getJournals();
    expect(list).toHaveLength(1);
    expect(list[0].narration).toBe('Sale on credit');
    expect(list.some((j) => j.narration === OPENING_BALANCE_PARTICULARS)).toBe(
      false,
    );

    // Ledger effects of the OB journal still show — math/statements never
    // read the list query, and its ledger_view row is untouched.
    const cashLedger = await ledger.getLedger(cash);
    expect(cashLedger).toHaveLength(2);
    // ledger_view (migration 027) special-cases this narration's particulars
    // to the narration itself rather than 'Journal #<id>' — confirms the
    // OB journal's ledger_view row is present and untouched.
    expect(
      cashLedger.some((row) => row.particulars === OPENING_BALANCE_PARTICULARS),
    ).toBe(true);
    expect(cashLedger.at(-1)!.balance).toBe(5250);
    db.close();
  });

  it('updateJournalNarration and updateJournalInfo persist changes', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, journal } = createCore(db);
    const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
    const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

    await journal.insertJournal(
      aJournal({
        journalEntries: [
          { accountId: cash, debitAmount: 100, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 100 },
        ] as JournalEntry[],
      }),
    );
    const journalId = (await journal.getNextJournalId()) - 1;

    await journal.updateJournalNarration(journalId, 'Renamed narration');
    expect((await journal.getJournal(journalId)).narration).toBe(
      'Renamed narration',
    );

    await journal.updateJournalInfo(journalId, {
      narration: 'Updated via info',
      billNumber: 7,
      discountPercentage: 5,
    });
    const updated = await journal.getJournal(journalId);
    expect(updated.narration).toBe('Updated via info');
    expect(updated.billNumber).toBe(7);
    expect(updated.discountPercentage).toBe(5);

    // matches original behavior: getJournal() never returns null/undefined
    // (it reduces to {} for an unknown id), so the `?? raise(...)` guard never
    // fires and the update is a silent no-op — preserved as-is from main.
    await expect(
      journal.updateJournalNarration(99999, 'nope'),
    ).resolves.toBeUndefined();
    db.close();
  });

  it('getJournalNarrationSummariesByIds batches narration headers', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, journal } = createCore(db);
    const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
    const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

    await journal.insertJournal(
      aJournal({
        narration: 'First',
        billNumber: 1,
        journalEntries: [
          { accountId: cash, debitAmount: 100, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 100 },
        ] as JournalEntry[],
      }),
    );
    const journalId = (await journal.getNextJournalId()) - 1;

    expect(await journal.getJournalNarrationSummariesByIds([])).toEqual({});
    const summaries = await journal.getJournalNarrationSummariesByIds([
      journalId,
      -1,
    ]);
    expect(summaries[journalId]).toEqual({
      narration: 'First',
      billNumber: 1,
    });
    db.close();
  });

  it('removeLedgerEffectOfJournals strips ledger lines and rebuilds balances, deleteJournalsByIds removes rows', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { accounts, ledger, journal } = createCore(db);
    const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
    const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

    await journal.insertJournal(
      aJournal({
        date: '2025-02-01',
        journalEntries: [
          { accountId: cash, debitAmount: 1000, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 1000 },
        ] as JournalEntry[],
      }),
    );
    const firstJournalId = (await journal.getNextJournalId()) - 1;

    await journal.insertJournal(
      aJournal({
        date: '2025-02-02',
        journalEntries: [
          { accountId: cash, debitAmount: 200, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 200 },
        ] as JournalEntry[],
      }),
    );

    expect((await ledger.getLedger(cash)).at(-1)!.balance).toBe(1200);

    await journal.removeLedgerEffectOfJournals([firstJournalId]);
    // removeLedgerEffectOfJournals only rewrites the STORED (legacy) ledger
    // table — it does not touch journal_entry. Since migration 028 moved
    // getLedger to ledger_view (sourced live from journal_entry),
    // firstJournalId's effect is still visible there until
    // deleteJournalsByIds also removes the fact rows below — exactly what
    // happens in production (InvoiceService always calls the two together,
    // in the same transaction, so this intermediate state is never actually
    // read by the app). Check the stored table directly for this
    // intermediate assertion instead.
    const storedCashAfterRemoval = db
      .prepare(
        `SELECT balance FROM ledger WHERE accountId = ? ORDER BY datetime(date, 'localtime') ASC, id ASC`,
      )
      .all(cash) as Array<{ balance: number }>;
    expect(storedCashAfterRemoval).toHaveLength(1);
    expect(storedCashAfterRemoval.at(-1)!.balance).toBe(200);

    await journal.deleteJournalsByIds([firstJournalId]);
    const cashLedgerAfterDelete = await ledger.getLedger(cash);
    expect(cashLedgerAfterDelete).toHaveLength(1);
    expect(cashLedgerAfterDelete.at(-1)!.balance).toBe(200);
    expect(await journal.getJournal(firstJournalId)).toEqual({});
    db.close();
  });

  // eslint-disable-next-line jest/no-disabled-tests -- schema fork: desktop 024-026 vs web 024-027
  it.skip('matches the main-process JournalService row for row', async () => {
    // Same operations against two identical databases — one through the old
    // sync service, one through core — must produce identical reads. This is
    // the no-behavior-change contract of the migration.
    const dbOld = new Database(':memory:');
    const dbCore = new Database(':memory:');
    seedBasicSchema(dbOld);
    seedBasicSchema(dbCore);

    const oldServices = createMainServices(dbOld);
    const {
      accounts: coreAccounts,
      ledger: coreLedger,
      journal: coreJournal,
    } = createCore(dbCore);

    const oldCash = await insertAccount(
      dbOld,
      new AccountService({ db: new BetterSqliteDriver(dbOld), session }),
      'Cash',
      'Current Asset',
    );
    const oldSale = await insertAccount(
      dbOld,
      new AccountService({ db: new BetterSqliteDriver(dbOld), session }),
      'Sale',
      'Revenue',
    );
    const coreCash = await insertAccount(
      dbCore,
      coreAccounts,
      'Cash',
      'Current Asset',
    );
    const coreSale = await insertAccount(
      dbCore,
      coreAccounts,
      'Sale',
      'Revenue',
    );
    expect(coreCash).toBe(oldCash);
    expect(coreSale).toBe(oldSale);

    const journals = [
      aJournal({
        date: '2025-02-10',
        narration: 'Sale one',
        journalEntries: [
          { accountId: oldCash, debitAmount: 1000, creditAmount: 0 },
          { accountId: oldSale, debitAmount: 0, creditAmount: 1000 },
        ] as JournalEntry[],
      }),
      aJournal({
        date: '2025-02-05',
        narration: 'Past dated sale',
        journalEntries: [
          { accountId: oldCash, debitAmount: 400, creditAmount: 0 },
          { accountId: oldSale, debitAmount: 0, creditAmount: 400 },
        ] as JournalEntry[],
      }),
    ];

    journals.forEach((j) => oldServices.journal.insertJournal(j));
    await journals.reduce(
      (chain, j) =>
        chain.then(async () => {
          await coreJournal.insertJournal(j);
        }),
      Promise.resolve(),
    );

    // docs/derived-state-design.md §6 migration 028: coreLedger.getLedger
    // now reads ledger_view (canon), oldServices.ledger.getLedger still
    // reads the stored `ledger` table directly. Facts (date, particulars,
    // debit, credit, linkedAccountId/Name/Code, and the derived
    // balance/balanceType) must still agree row-for-row for ordinary
    // journal-sourced data with no D1/D2 divergence trigger (no exact-zero
    // balance, no StatementService opening-balance import) — this DB has
    // neither. `id`/`createdAt`/`updatedAt` no longer compare: ledger_view
    // has no physical row, so core surfaces the originating
    // journal_entry.id as `id` (a different numeric domain from the stored
    // ledger.id) and has no createdAt/updatedAt equivalent (both optional
    // on the Ledger type, unused by every current reader).
    const stripRowIdentity = <
      T extends { id: unknown; createdAt?: unknown; updatedAt?: unknown },
    >(
      rows: T[],
    ) => rows.map((row) => omit(row, ['id', 'createdAt', 'updatedAt']));
    expect(stripRowIdentity(await coreLedger.getLedger(coreCash))).toEqual(
      stripRowIdentity(oldServices.ledger.getLedger(oldCash)),
    );
    expect(stripRowIdentity(await coreLedger.getLedger(coreSale))).toEqual(
      stripRowIdentity(oldServices.ledger.getLedger(oldSale)),
    );
    expect(await coreJournal.getJournals()).toEqual(
      oldServices.journal.getJournals(),
    );

    dbOld.close();
    dbCore.close();
  });
});
