/* eslint-disable no-lonely-if */
import type { Journal, JournalEntry, Ledger, UpdateJournalFields } from 'types';
import type { Database, Statement } from 'better-sqlite3';
import { compact, get, has, omit } from 'lodash';
import { cast } from '../utils/sqlite';
import { store } from '../store';
import { AccountType, BalanceType } from '../../types';
import { DatabaseService } from './Database.service';
import { logErrors } from '../errorLogger';
import { LedgerService } from './Ledger.service';
import { raise } from '../utils/general';

@logErrors
export class JournalService {
  private db: Database;

  private ledgerService: LedgerService;

  private stmJournal!: Statement;

  private stmJournalEntry!: Statement;

  private stmAccountType!: Statement;

  private stmNextJournalId!: Statement;

  private stmGetJournals!: Statement;

  private stmGetJournal!: Statement;

  private stmGetJournalsByInvoiceId!: Statement;

  private stmLedger!: Statement;

  private stmUpdateJournalNarration!: Statement;

  private stmGetJournalIdsByInvoiceId!: Statement;

  private stmGetAccountIdsByJournalIdsJson!: Statement;

  private stmDeleteJournalEntriesByJournalIdsJson!: Statement;

  private stmDeleteJournalsByIdsJson!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.ledgerService = new LedgerService();
    this.initPreparedStatements();
  }

  getNextJournalId() {
    const res = this.stmNextJournalId.get();
    return get(res, 'id', 0) + 1;
  }

  getJournals(): Journal[] {
    const username = store.get('username');
    const res = this.stmGetJournals.all({
      username,
    }) as (Journal & { debitAmount: number })[];

    const journals = compact(
      res.reduce((acc, journal) => {
        if (!acc[journal.id]) {
          acc[journal.id] = {
            ...omit(journal, 'debitAmount'),
            journalEntries: [],
          };
        }

        acc[journal.id].journalEntries.push({
          debitAmount: journal.debitAmount,
        } as JournalEntry);

        return acc;
      }, [] as Journal[]),
    );

    return journals;
  }

  getJournalsByInvoiceId(invoiceId: number): Journal[] {
    const username = store.get('username');
    const res = this.stmGetJournalsByInvoiceId.all({
      invoiceId: cast(invoiceId),
      username,
    }) as (Journal & { debitAmount: number })[];

    const journals = compact(
      res.reduce((acc, journal) => {
        if (!acc[journal.id]) {
          acc[journal.id] = {
            ...omit(journal, 'debitAmount'),
            journalEntries: [],
          };
        }

        acc[journal.id].journalEntries.push({
          debitAmount: journal.debitAmount,
        } as JournalEntry);

        return acc;
      }, [] as Journal[]),
    );

    return journals;
  }

  getJournal(journalId: number): Journal {
    const username = store.get('username');
    const res = this.stmGetJournal.all({
      journalId,
      username,
    }) as (Journal & {
      debitAmount: number;
      creditAmount: number;
      accountName: string;
      accountId: number;
    })[];

    const journal = res.reduce((accParam, entry) => {
      let acc = accParam;
      if (!acc.id) {
        acc = omit(
          entry,
          'debitAmount',
          'creditAmount',
          'accountName',
          'accountId',
        );
        acc.journalEntries = [];
      }

      acc.journalEntries.push({
        debitAmount: entry.debitAmount,
        creditAmount: entry.creditAmount,
        accountName: entry.accountName,
        accountId: entry.accountId,
      } as JournalEntry & { accountName: string });

      return acc;
    }, {} as Journal);

    return journal;
  }

  insertJournal(journalToBeInserted: Journal) {
    try {
      return this.db.transaction((journal: Journal) => {
        const { journalEntries } = journal;
        const debitEntries = journalEntries.filter((e) => e.debitAmount > 0);
        const creditEntries = journalEntries.filter((e) => e.creditAmount > 0);
        if (debitEntries.length > 1 && creditEntries.length > 1) {
          raise('Journal has multiple debits and multiple credits');
        }

        const {
          date,
          narration,
          isPosted,
          billNumber,
          discountPercentage,
          invoiceId,
        } = journal;

        // first check if this is a past dated entry that needs rebuilding
        const affectedAccounts = new Set(
          journalEntries.map((e) => e.accountId),
        );
        const needsRebuild = new Set<number>();

        for (const accountId of affectedAccounts) {
          if (this.ledgerService.hasNewerEntries(accountId, date)) {
            needsRebuild.add(accountId);
          }
        }

        // insert the journal
        const result = this.stmJournal.run({
          date,
          narration,
          isPosted: cast(isPosted),
          billNumber,
          discountPercentage,
          invoiceId: invoiceId ?? null,
        });
        const journalId = Number(result.lastInsertRowid);

        // insert all journal entries
        for (const entry of journalEntries) {
          const { debitAmount, accountId, creditAmount } = entry;
          this.stmJournalEntry.run({
            journalId,
            debitAmount,
            accountId,
            creditAmount,
          });
        }

        // insert ledger entries
        this.insertLedgerEntries(journalId, date, journalEntries);
        if (needsRebuild.size > 0) {
          // chronologically rebuild ledger only for accounts that need it
          for (const accountId of needsRebuild) {
            this.rebuildLedger(accountId);
          }
        }

        return true;
      })(journalToBeInserted);
    } catch (error) {
      console.error(
        `Error in insertJournal ${JSON.stringify(journalToBeInserted)}:`,
        error,
      );
      throw error;
    }
  }

  private rebuildLedger(accountId: number) {
    const entries = this.ledgerService.getLedger(accountId);
    this.rebuildLedgerFromEntries(accountId, entries);
  }

  /** replays ledger rows in order with fresh running balances (used after stripping journal lines) */
  private rebuildLedgerFromEntries(accountId: number, entries: Ledger[]) {
    const { type: accountType } = this.stmAccountType.get(accountId) as {
      type: string;
    };

    this.ledgerService.deleteLedger(accountId);

    let balance = 0;
    let balanceType = JournalService.getDefaultBalanceType(accountType);

    entries.forEach((entry) => {
      const { date, debit, credit, linkedAccountId, particulars } = entry;

      switch (accountType) {
        case AccountType.Asset:
        case AccountType.Expense:
          balance += debit - credit;
          balanceType = balance >= 0 ? BalanceType.Dr : BalanceType.Cr;
          break;
        case AccountType.Liability:
        case AccountType.Equity:
        case AccountType.Revenue:
          balance += credit - debit;
          balanceType = balance >= 0 ? BalanceType.Cr : BalanceType.Dr;
          break;
        default:
          raise(`Unknown account type: ${accountType}`);
      }

      this.stmLedger.run({
        date,
        accountId,
        debit,
        credit,
        balance: Math.abs(balance),
        balanceType,
        particulars,
        linkedAccountId,
      });
    });
  }

  getJournalIdsByInvoiceId(invoiceId: number): number[] {
    const rows = this.stmGetJournalIdsByInvoiceId.all(invoiceId) as {
      id: number;
    }[];
    return rows.map((r) => r.id);
  }

  /** removes ledger lines whose particulars are `Journal #<id>` for the given ids, then rebuilds each affected account */
  removeLedgerEffectOfJournals(journalIds: number[]): void {
    if (journalIds.length === 0) return;
    const rows = this.stmGetAccountIdsByJournalIdsJson.all({
      journalIdsJson: JSON.stringify(journalIds),
    }) as { accountId: number }[];
    const accountIds = [...new Set(rows.map((r) => r.accountId))];
    const idSet = new Set(journalIds);

    accountIds.forEach((accountId) => {
      const entries = this.ledgerService.getLedger(accountId);
      const filtered = entries.filter((e) => {
        const m = e.particulars.match(/^Journal #(\d+)$/);
        if (!m) return true;
        return !idSet.has(parseInt(m[1], 10));
      });
      this.rebuildLedgerFromEntries(accountId, filtered);
    });
  }

  deleteJournalsByIds(journalIds: number[]): void {
    if (journalIds.length === 0) return;
    const journalIdsJson = JSON.stringify(journalIds);
    this.stmDeleteJournalEntriesByJournalIdsJson.run({ journalIdsJson });
    this.stmDeleteJournalsByIdsJson.run({ journalIdsJson });
  }

  private static getDefaultBalanceType(accountType: string): BalanceType {
    switch (accountType) {
      case AccountType.Asset:
      case AccountType.Expense:
        return BalanceType.Dr;
      case AccountType.Liability:
      case AccountType.Equity:
      case AccountType.Revenue:
        return BalanceType.Cr;
      default:
        return raise(`Unknown account type: ${accountType}`);
    }
  }

  private insertLedgerEntries(
    journalId: number,
    date: string,
    entries: JournalEntry[],
  ) {
    // calculate totals for proportional splitting
    const totalDebits = entries.reduce(
      (sum, entry) => sum + entry.debitAmount,
      0,
    );
    const totalCredits = entries.reduce(
      (sum, entry) => sum + entry.creditAmount,
      0,
    );

    for (const entry of entries) {
      const { accountId } = entry;

      // get current balance
      const currentBalance = this.ledgerService.getBalance(accountId);

      let balance = currentBalance?.balance || 0;
      let balanceType = currentBalance?.balanceType || BalanceType.Dr;

      if (entry.debitAmount > 0) {
        // process each corresponding credit entry
        const creditEntries = entries.filter((e) => e.creditAmount > 0);
        for (const creditEntry of creditEntries) {
          const proportionalDebit =
            (entry.debitAmount * creditEntry.creditAmount) / totalCredits;

          // if current balance type is Dr
          if (balanceType === BalanceType.Dr) {
            balance += proportionalDebit; // add debit to debit balance
          } else {
            // current balance type is Cr
            if (proportionalDebit > balance) {
              // if new debit is bigger, result will be Dr
              balance = proportionalDebit - balance;
              balanceType = BalanceType.Dr;
            } else {
              // if existing credit is bigger, result will be Cr
              balance -= proportionalDebit;
            }
          }

          this.stmLedger.run({
            date,
            accountId,
            debit: proportionalDebit,
            credit: 0,
            balance: Math.abs(balance),
            balanceType,
            particulars: `Journal #${journalId}`,
            linkedAccountId: creditEntry.accountId,
          });
        }
      } else if (entry.creditAmount > 0) {
        // process each corresponding debit entry
        const debitEntries = entries.filter((e) => e.debitAmount > 0);
        for (const debitEntry of debitEntries) {
          const proportionalCredit =
            (entry.creditAmount * debitEntry.debitAmount) / totalDebits;

          // if current balance type is Cr
          if (balanceType === BalanceType.Cr) {
            balance += proportionalCredit; // add credit to credit balance
          } else {
            // current balance type is Dr
            if (proportionalCredit > balance) {
              // if new credit is bigger, result will be Cr
              balance = proportionalCredit - balance;
              balanceType = BalanceType.Cr;
            } else {
              // if existing debit is bigger, result will be Dr
              balance -= proportionalCredit;
            }
          }

          this.stmLedger.run({
            date,
            accountId,
            debit: 0,
            credit: proportionalCredit,
            balance: Math.abs(balance),
            balanceType,
            particulars: `Journal #${journalId}`,
            linkedAccountId: debitEntry.accountId,
          });
        }
      }
    }
  }

  updateJournalNarration(journalId: number, narration: string): void {
    try {
      const { id } =
        this.getJournal(journalId) ??
        raise(`Journal with Id ${journalId} not found`);

      this.stmUpdateJournalNarration.run({
        journalId: id,
        narration,
      });
    } catch (error) {
      console.error(`Error in updateJournalNarration ${journalId}:`, error);
      throw error;
    }
  }

  updateJournalInfo(journalId: number, fields: UpdateJournalFields): void {
    try {
      const journal = this.getJournal(journalId);
      if (!journal || !journal.id) {
        raise(`Journal with Id ${journalId} not found`);
      }

      const setClauses: string[] = [];
      const params: Record<string, unknown> = { journalId };

      if (has(fields, 'narration')) {
        setClauses.push('narration = @narration');
        params.narration = fields.narration ?? null;
      }
      if (has(fields, 'billNumber')) {
        setClauses.push('billNumber = @billNumber');
        params.billNumber = fields.billNumber ?? null;
      }
      if (has(fields, 'discountPercentage')) {
        setClauses.push('discountPercentage = @discountPercentage');
        params.discountPercentage = fields.discountPercentage ?? null;
      }

      if (setClauses.length === 0) return;

      const sql = `UPDATE journal SET ${setClauses.join(
        ', ',
      )} WHERE id = @journalId`;
      this.db.prepare(sql).run(params);
    } catch (error) {
      console.error(`Error in updateJournalInfo ${journalId}:`, error);
      throw error;
    }
  }

  private initPreparedStatements() {
    this.stmJournal = this.db.prepare(
      `INSERT INTO journal (date, narration, isPosted, billNumber, discountPercentage, invoiceId)
       VALUES (@date, @narration, @isPosted, @billNumber, @discountPercentage, @invoiceId)`,
    );
    this.stmJournalEntry = this.db.prepare(
      `INSERT INTO journal_entry (journalId, debitAmount, accountId, creditAmount)
       VALUES (@journalId, @debitAmount, @accountId, @creditAmount)`,
    );
    this.stmAccountType = this.db.prepare(
      'SELECT c.type FROM account a JOIN chart c ON a.chartId = c.id WHERE a.id = ?',
    );
    this.stmNextJournalId = this.db.prepare(
      "SELECT seq as id FROM sqlite_sequence WHERE name='journal'",
    );
    this.stmGetJournals = this.db.prepare(
      `SELECT j.id, j.date, j.narration, j.isPosted, j.billNumber, j.discountPercentage, j.createdAt, j.updatedAt, je.debitAmount
       FROM journal j
       JOIN journal_entry je ON j.id = je.journalId
       JOIN account a ON a.id = je.accountId
       JOIN chart c ON c.id = a.chartId
       WHERE userId = (SELECT id FROM users WHERE username = @username)
       ORDER BY j.date DESC, j.id DESC`,
    );
    this.stmGetJournalsByInvoiceId = this.db.prepare(
      `SELECT j.id, j.date, j.narration, j.isPosted, j.billNumber, j.discountPercentage, j.invoiceId, j.createdAt, j.updatedAt, je.debitAmount
       FROM journal j
       JOIN journal_entry je ON j.id = je.journalId
       JOIN account a ON a.id = je.accountId
       JOIN chart c ON c.id = a.chartId
       WHERE j.invoiceId = @invoiceId
       AND userId = (SELECT id FROM users WHERE username = @username)
       ORDER BY j.date DESC, j.id DESC`,
    );
    this.stmGetJournal = this.db.prepare(
      `SELECT j.id, j.date, j.narration, j.isPosted, j.billNumber, j.discountPercentage, j.invoiceId, j.createdAt, j.updatedAt,
              je.debitAmount, je.creditAmount, je.accountId, a.name as accountName
       FROM journal j
       JOIN journal_entry je ON j.id = je.journalId
       JOIN account a ON a.id = je.accountId
       JOIN chart c ON c.id = a.chartId
       WHERE j.id = @journalId
       AND userId = (SELECT id FROM users WHERE username = @username)`,
    );
    this.stmLedger = this.db.prepare(
      `INSERT INTO ledger (date, accountId, debit, credit, balance, balanceType, particulars, linkedAccountId)
       VALUES (@date, @accountId, @debit, @credit, @balance, @balanceType, @particulars, @linkedAccountId)`,
    );
    this.stmUpdateJournalNarration = this.db.prepare(
      `UPDATE journal SET narration = @narration WHERE id = @journalId`,
    );
    this.stmGetJournalIdsByInvoiceId = this.db.prepare(
      'SELECT id FROM journal WHERE invoiceId = ?',
    );

    this.stmGetAccountIdsByJournalIdsJson = this.db.prepare(`
      SELECT DISTINCT accountId
      FROM journal_entry
      WHERE journalId IN (SELECT value FROM json_each(@journalIdsJson))
    `);
    this.stmDeleteJournalEntriesByJournalIdsJson = this.db.prepare(`
      DELETE FROM journal_entry
      WHERE journalId IN (SELECT value FROM json_each(@journalIdsJson))
    `);
    this.stmDeleteJournalsByIdsJson = this.db.prepare(`
      DELETE FROM journal
      WHERE id IN (SELECT value FROM json_each(@journalIdsJson))
    `);
  }
}
