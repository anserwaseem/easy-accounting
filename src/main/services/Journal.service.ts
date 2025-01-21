import type { Journal, JournalEntry } from 'types';
import type { Database, Statement } from 'better-sqlite3';
import { compact, get, omit } from 'lodash';
import { cast } from '../utils/sqlite';
import { store } from '../store';
import { AccountType, BalanceType } from '../../types';
import { DatabaseService } from './Database.service';
import { logErrors } from '../errorLogger';
import { LedgerService } from './Ledger.service';

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

  private stmLedger!: Statement;

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

  getJorunal(journalId: number): Journal {
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
        const { date, narration, isPosted, journalEntries } = journal;

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
    // get account type
    const { type: accountType } = this.stmAccountType.get(accountId) as {
      type: string;
    };

    // get existing ledger for chronological reordering
    const entries = this.ledgerService.getLedger(accountId);

    // delete all existing ledger entries for this account
    this.ledgerService.deleteLedger(accountId);

    let balance = 0;
    let balanceType = JournalService.getDefaultBalanceType(accountType);

    // rebuild ledger entries in chronological order
    entries.forEach((entry) => {
      const { date, debit, credit, linkedAccountId, particulars } = entry;

      // calculate new balance based on account type
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
          throw new Error(`Unknown account type: ${accountType}`);
      }

      // insert new ledger entry
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
        throw new Error(`Unknown account type: ${accountType}`);
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
      const { type: accountType } = this.stmAccountType.get(accountId) as {
        type: string;
      };

      // get current balance
      const currentBalance = this.ledgerService.getBalance(accountId);

      let balance = currentBalance?.balance || 0;
      let balanceType =
        currentBalance?.balanceType ||
        JournalService.getDefaultBalanceType(accountType);

      if (entry.debitAmount > 0) {
        // process each corresponding credit entry
        const creditEntries = entries.filter((e) => e.creditAmount > 0);
        for (const creditEntry of creditEntries) {
          const proportionalDebit =
            (entry.debitAmount * creditEntry.creditAmount) / totalCredits;

          switch (accountType) {
            case AccountType.Asset:
            case AccountType.Expense:
              balance += proportionalDebit;
              balanceType = balance >= 0 ? BalanceType.Dr : BalanceType.Cr;
              break;
            case AccountType.Liability:
            case AccountType.Equity:
            case AccountType.Revenue:
              balance -= proportionalDebit;
              balanceType = balance >= 0 ? BalanceType.Cr : BalanceType.Dr;
              break;
            default:
              throw new Error(`Unknown account type: ${accountType}`);
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

          switch (accountType) {
            case AccountType.Asset:
            case AccountType.Expense:
              balance -= proportionalCredit;
              balanceType = balance >= 0 ? BalanceType.Dr : BalanceType.Cr;
              break;
            case AccountType.Liability:
            case AccountType.Equity:
            case AccountType.Revenue:
              balance += proportionalCredit;
              balanceType = balance >= 0 ? BalanceType.Cr : BalanceType.Dr;
              break;
            default:
              throw new Error(`Unknown account type: ${accountType}`);
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

  private initPreparedStatements() {
    this.stmJournal = this.db.prepare(
      `INSERT INTO journal (date, narration, isPosted)
       VALUES (@date, @narration, @isPosted)`,
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
      `SELECT j.id, j.date, j.narration, j.isPosted, j.createdAt, j.updatedAt, je.debitAmount
       FROM journal j
       JOIN journal_entry je ON j.id = je.journalId
       JOIN account a ON a.id = je.accountId
       JOIN chart c ON c.id = a.chartId
       WHERE userId = (SELECT id FROM users WHERE username = @username)
       ORDER BY j.date DESC, j.id DESC`,
    );
    this.stmGetJournal = this.db.prepare(
      `SELECT j.id, j.date, j.narration, j.isPosted, j.createdAt, j.updatedAt,
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
  }
}
