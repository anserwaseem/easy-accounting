import type { Journal, JournalEntry } from 'types';
import type { Database, Statement } from 'better-sqlite3';
import { compact, get, omit } from 'lodash';
import { cast } from '../utils/sqlite';
import { store } from '../store';
import { AccountType, BalanceType } from '../../types'; // FIXME: throws "Error: Cannot find module 'types'" when importing from 'types'
import { DatabaseService } from './Database.service';
import { logErrors } from '../errorLogger';

type GetBalance = { balance: number; balanceType: BalanceType };
const DEFAULT_GET_BALANCE = { balance: 0, balanceType: BalanceType.Dr };

@logErrors
export class JournalService {
  private db: Database;

  private stmJournal!: Statement;

  private stmJournalEntry!: Statement;

  private stmLedger!: Statement;

  private stmGetBalance!: Statement;

  private stmAccountType!: Statement;

  private stmNextJournalId!: Statement;

  private stmGetJournals!: Statement;

  private stmGetJournal!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.initPreparedStatements();
  }

  getNextJournalId() {
    const res = this.stmNextJournalId.get();
    return get(res, 'id', 0) + 1;
  }

  insertJournal(journalToBeInserted: Journal) {
    try {
      this.db.transaction((journal: Journal) => {
        const { date, narration, isPosted, journalEntries } = journal;
        const result = this.stmJournal.run({
          date,
          narration,
          isPosted: cast(isPosted),
        });
        const journalId = result.lastInsertRowid;

        const accountBalances = new Map<number, GetBalance>();

        for (const entry of journalEntries) {
          const { debitAmount, accountId, creditAmount } = entry;
          this.stmJournalEntry.run({
            journalId,
            debitAmount,
            accountId,
            creditAmount,
          });

          if (!accountBalances.has(accountId)) {
            const currentBalance = <GetBalance | undefined>(
              this.stmGetBalance.get({ accountId })
            );
            accountBalances.set(
              accountId,
              currentBalance || DEFAULT_GET_BALANCE,
            );
          }

          const { balance, balanceType } =
            accountBalances.get(accountId) || DEFAULT_GET_BALANCE;
          const updatedBalance = this.updateBalance(
            accountId,
            balance,
            balanceType,
            debitAmount,
            creditAmount,
          );
          accountBalances.set(accountId, updatedBalance);
        }

        for (const [accountId, { balance, balanceType }] of accountBalances) {
          const entry = journalEntries.find((e) => e.accountId === accountId)!;
          this.stmLedger.run({
            date,
            accountId,
            debit: entry.debitAmount,
            credit: entry.creditAmount,
            balance: Math.abs(balance),
            balanceType,
            particulars: `Journal #${journalId}`,
            linkedAccountId: journalId,
          });
        }
      })(journalToBeInserted);

      return true;
    } catch (error) {
      console.error(
        `Error in insertJournal ${JSON.stringify(journalToBeInserted)}:`,
        error,
      );
      throw error;
    }
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

  private updateBalance(
    accountId: number,
    currentBalance: number,
    currentBalanceType: BalanceType,
    debitAmount: number,
    creditAmount: number,
  ): GetBalance {
    const { type: accountType } = this.stmAccountType.get(accountId) as {
      type: string;
    };

    let newBalance: number;
    let newBalanceType: BalanceType;

    switch (accountType) {
      case AccountType.Asset:
      case AccountType.Expense:
        // Asset and Expense accounts:
        // - Increase (debit) when assets are acquired or expenses are incurred
        // - Decrease (credit) when assets are disposed of or expenses are reduced/refunded
        // - Normal balance is debit (Dr)
        newBalance = currentBalance + debitAmount - creditAmount;
        newBalanceType = newBalance >= 0 ? BalanceType.Dr : BalanceType.Cr;
        break;
      case AccountType.Liability:
      case AccountType.Equity:
      case AccountType.Revenue:
        // Liability, Equity, and Revenue accounts:
        // - Increase (credit) when obligations increase, equity is added, or revenue is earned
        // - Decrease (debit) when obligations are met, equity is reduced, or revenue is decreased
        // - Normal balance is credit (Cr)
        newBalance = currentBalance - debitAmount + creditAmount;
        newBalanceType = newBalance >= 0 ? BalanceType.Cr : BalanceType.Dr;
        break;
      default:
        throw new Error(`Unknown account type: ${accountType}`);
    }

    return { balance: Math.abs(newBalance), balanceType: newBalanceType };
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
    this.stmLedger = this.db.prepare(
      `INSERT INTO ledger (date, accountId, debit, credit, balance, balanceType, particulars, linkedAccountId)
       VALUES (@date, @accountId, @debit, @credit, @balance, @balanceType, @particulars, @linkedAccountId)`,
    );
    this.stmGetBalance = this.db.prepare(
      `SELECT balance, balanceType
       FROM ledger
       WHERE accountId = @accountId
       ORDER BY id DESC
       LIMIT 1`,
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
       WHERE userId = (SELECT id FROM users WHERE username = @username)`,
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
  }
}
