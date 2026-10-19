import Database from 'better-sqlite3';
import { BalanceType } from 'types';
import type { Journal, JournalEntry } from 'types';
import { AccountService } from '../AccountService';
import { LedgerService } from '../LedgerService';
import { JournalService } from '../JournalService';
import type { SessionContext } from '../../ports';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { OPENING_BALANCE_PARTICULARS } from '../../db/openingBalanceBackfill';
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

async function seedBasicSchema(db: Database.Database) {
  await bootstrapDatabase(new BetterSqliteDriver(db));
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
    await seedBasicSchema(db);
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
    await seedBasicSchema(db);
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
    await seedBasicSchema(db);
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
    await seedBasicSchema(db);
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
    await seedBasicSchema(db);
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
    await seedBasicSchema(db);
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
    await seedBasicSchema(db);
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
    // ledger_view (migration 032) special-cases this narration's particulars
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
    await seedBasicSchema(db);
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
    await seedBasicSchema(db);
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
    await seedBasicSchema(db);
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
    // table — it does not touch journal_entry. Since the service cutover moved
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

  describe('reverseJournal', () => {
    it('reverses a simple debit/credit journal and returns balances to zero', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { accounts, ledger, journal } = createCore(db);
      const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
      const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

      await journal.insertJournal(
        aJournal({
          date: '2025-02-01',
          narration: 'Initial Sale',
          journalEntries: [
            { accountId: cash, debitAmount: 500, creditAmount: 0 },
            { accountId: sale, debitAmount: 0, creditAmount: 500 },
          ] as JournalEntry[],
        }),
      );
      const originalId = (await journal.getNextJournalId()) - 1;

      expect((await ledger.getLedger(cash)).at(-1)!.balance).toBe(500);
      expect((await ledger.getLedger(sale)).at(-1)!.balance).toBe(500);

      const reversed = await journal.reverseJournal(originalId);
      expect(reversed.id).toBeGreaterThan(originalId);
      expect(reversed.narration).toBe(
        `Reversal of Journal #${originalId}: Initial Sale`,
      );
      expect(reversed.journalEntries).toHaveLength(2);

      const cashEntry = reversed.journalEntries.find(
        (e) => e.accountId === cash,
      );
      const saleEntry = reversed.journalEntries.find(
        (e) => e.accountId === sale,
      );
      expect(cashEntry?.debitAmount).toBe(0);
      expect(cashEntry?.creditAmount).toBe(500);
      expect(saleEntry?.debitAmount).toBe(500);
      expect(saleEntry?.creditAmount).toBe(0);

      expect((await ledger.getLedger(cash)).at(-1)!.balance).toBe(0);
      expect((await ledger.getLedger(sale)).at(-1)!.balance).toBe(0);
      db.close();
    });

    it('reverses a 1-debit to multi-credit collection journal correctly', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { accounts, ledger, journal } = createCore(db);
      const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
      const shopA = await insertAccount(
        db,
        accounts,
        'Shop A',
        'Current Asset',
      );
      const shopB = await insertAccount(
        db,
        accounts,
        'Shop B',
        'Current Asset',
      );

      // First give shops opening debit balances
      await journal.insertJournal(
        aJournal({
          date: '2025-01-15',
          narration: 'Opening balance',
          journalEntries: [
            { accountId: shopA, debitAmount: 1000, creditAmount: 0 },
            { accountId: cash, debitAmount: 0, creditAmount: 1000 },
          ] as JournalEntry[],
        }),
      );
      await journal.insertJournal(
        aJournal({
          date: '2025-01-15',
          narration: 'Opening balance',
          journalEntries: [
            { accountId: shopB, debitAmount: 2000, creditAmount: 0 },
            { accountId: cash, debitAmount: 0, creditAmount: 2000 },
          ] as JournalEntry[],
        }),
      );

      expect((await ledger.getLedger(shopA)).at(-1)!.balance).toBe(1000);
      expect((await ledger.getLedger(shopB)).at(-1)!.balance).toBe(2000);

      // Now collection journal: cash debited 3000, shopA credited 1000, shopB credited 2000
      await journal.insertJournal(
        aJournal({
          date: '2025-02-01',
          narration: 'Agent Collection',
          journalEntries: [
            { accountId: cash, debitAmount: 3000, creditAmount: 0 },
            { accountId: shopA, debitAmount: 0, creditAmount: 1000 },
            { accountId: shopB, debitAmount: 0, creditAmount: 2000 },
          ] as JournalEntry[],
        }),
      );
      const collectionJournalId = (await journal.getNextJournalId()) - 1;

      expect((await ledger.getLedger(shopA)).at(-1)!.balance).toBe(0);
      expect((await ledger.getLedger(shopB)).at(-1)!.balance).toBe(0);

      // Reverse collection journal
      await journal.reverseJournal(collectionJournalId);

      // Balances should be back to 1000 and 2000 Dr
      expect((await ledger.getLedger(shopA)).at(-1)!.balance).toBe(1000);
      expect((await ledger.getLedger(shopB)).at(-1)!.balance).toBe(2000);
      db.close();
    });

    it('reverses a multi-debit to 1-credit journal correctly', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { accounts, ledger, journal } = createCore(db);
      const expA = await insertAccount(db, accounts, 'Exp A', 'Current Asset');
      const expB = await insertAccount(db, accounts, 'Exp B', 'Current Asset');
      const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');

      await journal.insertJournal(
        aJournal({
          date: '2025-02-01',
          narration: 'Expenses',
          journalEntries: [
            { accountId: expA, debitAmount: 300, creditAmount: 0 },
            { accountId: expB, debitAmount: 700, creditAmount: 0 },
            { accountId: cash, debitAmount: 0, creditAmount: 1000 },
          ] as JournalEntry[],
        }),
      );
      const originalId = (await journal.getNextJournalId()) - 1;

      const reversed = await journal.reverseJournal(originalId);
      expect(reversed.journalEntries).toHaveLength(3);
      const cashEntry = reversed.journalEntries.find(
        (e) => e.accountId === cash,
      );
      expect(cashEntry?.debitAmount).toBe(1000);
      expect(cashEntry?.creditAmount).toBe(0);

      expect((await ledger.getLedger(expA)).at(-1)!.balance).toBe(0);
      expect((await ledger.getLedger(expB)).at(-1)!.balance).toBe(0);
      expect((await ledger.getLedger(cash)).at(-1)!.balance).toBe(0);
      db.close();
    });

    it('accepts custom date and narration overrides', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { accounts, journal } = createCore(db);
      const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
      const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

      await journal.insertJournal(
        aJournal({
          date: '2025-02-01',
          narration: 'Mistaken entry',
          journalEntries: [
            { accountId: cash, debitAmount: 100, creditAmount: 0 },
            { accountId: sale, debitAmount: 0, creditAmount: 100 },
          ] as JournalEntry[],
        }),
      );
      const originalId = (await journal.getNextJournalId()) - 1;

      const customDate = '2025-02-15T00:00:00.000Z';
      const customNarration = 'Correction by admin';
      const reversed = await journal.reverseJournal(originalId, {
        date: customDate,
        narration: customNarration,
      });

      expect(reversed.date).toBe(customDate);
      expect(reversed.narration).toBe(customNarration);
      db.close();
    });

    it('throws when journal does not exist', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { journal } = createCore(db);

      await expect(journal.reverseJournal(99999)).rejects.toThrow(
        'Journal with Id 99999 not found',
      );
      db.close();
    });

    it('throws when attempting to reverse an invoice-linked journal', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { accounts, journal } = createCore(db);
      const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
      const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

      await journal.insertJournal(
        aJournal({
          date: '2025-02-01',
          narration: 'Sale invoice #101',
          invoiceId: 42,
          journalEntries: [
            { accountId: cash, debitAmount: 100, creditAmount: 0 },
            { accountId: sale, debitAmount: 0, creditAmount: 100 },
          ] as JournalEntry[],
        }),
      );
      const invoiceJournalId = (await journal.getNextJournalId()) - 1;

      await expect(journal.reverseJournal(invoiceJournalId)).rejects.toThrow(
        'Cannot reverse an invoice-linked journal directly',
      );
      db.close();
    });

    it('throws when attempting to reverse a commission-settlement-linked journal', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { accounts, journal } = createCore(db);
      const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
      const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

      await journal.insertJournal(
        aJournal({
          date: '2025-02-01',
          narration: 'Commission settlement',
          journalEntries: [
            { accountId: cash, debitAmount: 100, creditAmount: 0 },
            { accountId: sale, debitAmount: 0, creditAmount: 100 },
          ] as JournalEntry[],
        }),
      );
      const settlementJournalId = (await journal.getNextJournalId()) - 1;

      // Link it in agent_commission_settlements
      const chartRow = db.prepare('SELECT id FROM chart LIMIT 1').get() as {
        id: number;
      };
      db.prepare(
        `
        INSERT INTO agent_commission_settlements (chartId, startDate, endDate, journalId, grossCommission, netCommission)
        VALUES (?, '2025-01-01', '2025-01-31', ?, 100, 100)
      `,
      ).run(chartRow.id, settlementJournalId);

      await expect(journal.reverseJournal(settlementJournalId)).rejects.toThrow(
        'Cannot reverse a settlement-linked journal directly',
      );
      db.close();
    });

    it('throws when attempting to reverse an already reversed journal (duplicate guard)', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { accounts, journal } = createCore(db);
      const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
      const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

      await journal.insertJournal(
        aJournal({
          date: '2025-02-01',
          narration: 'Sale',
          journalEntries: [
            { accountId: cash, debitAmount: 100, creditAmount: 0 },
            { accountId: sale, debitAmount: 0, creditAmount: 100 },
          ] as JournalEntry[],
        }),
      );
      const originalId = (await journal.getNextJournalId()) - 1;

      const rev = await journal.reverseJournal(originalId);
      expect(rev.id).toBeDefined();

      // Second reversal attempt should be blocked
      await expect(journal.reverseJournal(originalId)).rejects.toThrow(
        `Journal with Id ${originalId} has already been reversed by Journal #${rev.id}`,
      );
      db.close();
    });
  });

  describe('deleteManualJournal', () => {
    it('deletes a simple manual journal and resets ledger balances', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { accounts, ledger, journal } = createCore(db);
      const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
      const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

      await journal.insertJournal(
        aJournal({
          date: '2025-02-01',
          narration: 'Mistaken Cash Sale',
          journalEntries: [
            { accountId: cash, debitAmount: 800, creditAmount: 0 },
            { accountId: sale, debitAmount: 0, creditAmount: 800 },
          ] as JournalEntry[],
        }),
      );
      const journalId = (await journal.getNextJournalId()) - 1;

      expect((await ledger.getLedger(cash)).at(-1)!.balance).toBe(800);
      expect((await ledger.getLedger(sale)).at(-1)!.balance).toBe(800);

      await journal.deleteManualJournal(journalId);

      // Journal and entries should be completely deleted
      expect(await journal.getJournal(journalId)).toEqual({});
      const journalCount = db
        .prepare('SELECT count(*) as count FROM journal WHERE id = ?')
        .get(journalId) as { count: number };
      expect(journalCount.count).toBe(0);

      const entryCount = db
        .prepare(
          'SELECT count(*) as count FROM journal_entry WHERE journalId = ?',
        )
        .get(journalId) as { count: number };
      expect(entryCount.count).toBe(0);

      // Ledger balances should be zero
      expect(await ledger.getLedger(cash)).toHaveLength(0);
      expect(await ledger.getLedger(sale)).toHaveLength(0);
      db.close();
    });

    it('deletes a collection journal and restores customer account balances', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { accounts, ledger, journal } = createCore(db);
      const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
      const shop1 = await insertAccount(
        db,
        accounts,
        'Shop 1',
        'Current Asset',
      );
      const shop2 = await insertAccount(
        db,
        accounts,
        'Shop 2',
        'Current Asset',
      );

      // Seed opening balances
      await journal.insertJournal(
        aJournal({
          date: '2025-01-10',
          narration: 'Opening 1',
          journalEntries: [
            { accountId: shop1, debitAmount: 500, creditAmount: 0 },
            { accountId: cash, debitAmount: 0, creditAmount: 500 },
          ] as JournalEntry[],
        }),
      );
      await journal.insertJournal(
        aJournal({
          date: '2025-01-10',
          narration: 'Opening 2',
          journalEntries: [
            { accountId: shop2, debitAmount: 700, creditAmount: 0 },
            { accountId: cash, debitAmount: 0, creditAmount: 700 },
          ] as JournalEntry[],
        }),
      );

      expect((await ledger.getLedger(shop1)).at(-1)!.balance).toBe(500);
      expect((await ledger.getLedger(shop2)).at(-1)!.balance).toBe(700);

      // Erroneous collection journal crediting both shops
      await journal.insertJournal(
        aJournal({
          date: '2025-02-01',
          narration: 'Erroneous Collection',
          journalEntries: [
            { accountId: cash, debitAmount: 1200, creditAmount: 0 },
            { accountId: shop1, debitAmount: 0, creditAmount: 500 },
            { accountId: shop2, debitAmount: 0, creditAmount: 700 },
          ] as JournalEntry[],
        }),
      );
      const errorJournalId = (await journal.getNextJournalId()) - 1;

      expect((await ledger.getLedger(shop1)).at(-1)!.balance).toBe(0);
      expect((await ledger.getLedger(shop2)).at(-1)!.balance).toBe(0);

      // Delete the erroneous manual collection journal
      await journal.deleteManualJournal(errorJournalId);

      // Balances should be restored to their prior state
      expect((await ledger.getLedger(shop1)).at(-1)!.balance).toBe(500);
      expect((await ledger.getLedger(shop2)).at(-1)!.balance).toBe(700);
      db.close();
    });

    it('throws when journal does not exist', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { journal } = createCore(db);

      await expect(journal.deleteManualJournal(88888)).rejects.toThrow(
        'Journal with Id 88888 not found',
      );
      db.close();
    });

    it('throws when attempting to delete an invoice-linked journal', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { accounts, journal } = createCore(db);
      const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
      const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

      await journal.insertJournal(
        aJournal({
          date: '2025-02-01',
          narration: 'Sale invoice #202',
          invoiceId: 99,
          journalEntries: [
            { accountId: cash, debitAmount: 200, creditAmount: 0 },
            { accountId: sale, debitAmount: 0, creditAmount: 200 },
          ] as JournalEntry[],
        }),
      );
      const invoiceJournalId = (await journal.getNextJournalId()) - 1;

      await expect(
        journal.deleteManualJournal(invoiceJournalId),
      ).rejects.toThrow('Cannot delete an invoice-linked journal');
      db.close();
    });

    it('throws when attempting to delete a commission-settlement-linked journal', async () => {
      const db = new Database(':memory:');
      await seedBasicSchema(db);
      const { accounts, journal } = createCore(db);
      const cash = await insertAccount(db, accounts, 'Cash', 'Current Asset');
      const sale = await insertAccount(db, accounts, 'Sale', 'Revenue');

      await journal.insertJournal(
        aJournal({
          date: '2025-02-01',
          narration: 'Settlement journal',
          journalEntries: [
            { accountId: cash, debitAmount: 150, creditAmount: 0 },
            { accountId: sale, debitAmount: 0, creditAmount: 150 },
          ] as JournalEntry[],
        }),
      );
      const settlementJournalId = (await journal.getNextJournalId()) - 1;

      const chartRow = db.prepare('SELECT id FROM chart LIMIT 1').get() as {
        id: number;
      };
      db.prepare(
        `
        INSERT INTO agent_commission_settlements (chartId, startDate, endDate, journalId, grossCommission, netCommission)
        VALUES (?, '2025-01-01', '2025-01-31', ?, 150, 150)
      `,
      ).run(chartRow.id, settlementJournalId);

      await expect(
        journal.deleteManualJournal(settlementJournalId),
      ).rejects.toThrow('Cannot delete a settlement-linked journal');
      db.close();
    });
  });
});
