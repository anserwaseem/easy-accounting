import type { Database, RunResult, Statement } from 'better-sqlite3';
import { BalanceType, type Ledger } from '../../types';
import { DatabaseService } from './Database.service';
import { logErrors } from '../errorLogger';

type GetBalance = { balance: number; balanceType: BalanceType };

@logErrors
export class LedgerService {
  private db: Database;

  private stmGetLedger!: Statement;

  private stmDeleteLedgerEntries!: Statement;

  private stmCheckNewerEntries!: Statement;

  private stmLedger!: Statement;

  private stmGetBalance!: Statement;

  private stmGetBalanceAtDate!: Statement;

  private stmGetLedgerRange!: Statement;

  private stmGetBalancesForAccountIdsAsOfDate!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.initPreparedStatements();
  }

  getLedger(accountId: number): Ledger[] {
    const result = this.stmGetLedger.all({ accountId }) as Ledger[];
    return result;
  }

  deleteLedger(accountId: number): RunResult {
    return this.stmDeleteLedgerEntries.run({ accountId });
  }

  hasNewerEntries(accountId: number, date: string): boolean {
    const hasNewerEntries = this.stmCheckNewerEntries.get({
      accountId,
      date,
    }) as { count: number };
    return hasNewerEntries.count > 0;
  }

  getBalance(accountId: number): GetBalance | undefined {
    return <GetBalance | undefined>this.stmGetBalance.get({ accountId });
  }

  /** latest balance per account in one round-trip (invoice details related ledgers). */
  getBalancesForAccountIds(accountIds: number[]): Record<number, GetBalance> {
    const unique = [
      ...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0)),
    ];
    if (unique.length === 0) return {};
    const placeholders = unique.map(() => '?').join(',');
    const sql = `
      SELECT t.accountId, t.balance, t.balanceType
      FROM (
        SELECT
          l.accountId,
          l.balance,
          l.balanceType,
          ROW_NUMBER() OVER (
            PARTITION BY l.accountId
            ORDER BY l.date DESC, l.id DESC
          ) AS rn
        FROM ledger l
        WHERE l.accountId IN (${placeholders})
      ) t
      WHERE t.rn = 1
    `;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...unique) as Array<{
      accountId: number;
      balance: number;
      balanceType: BalanceType;
    }>;
    const out: Record<number, GetBalance> = {};
    for (const row of rows) {
      out[row.accountId] = {
        balance: row.balance,
        balanceType: row.balanceType,
      };
    }
    return out;
  }

  /**
   * running balance as of inclusive calendar day (yyyy-MM-dd), one query.
   * matches last ledger row that falls on or before that day (same ordering as getLedger).
   */
  getBalancesForAccountIdsAsOfDate(
    accountIds: number[],
    asOfDate: string,
  ): Record<number, GetBalance> {
    const unique = [
      ...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0)),
    ];
    if (unique.length === 0) return {};
    const rows = this.stmGetBalancesForAccountIdsAsOfDate.all({
      accountIdsJson: JSON.stringify(unique),
      asOfDate,
    }) as Array<{
      accountId: number;
      balance: number;
      balanceType: BalanceType;
    }>;
    const out: Record<number, GetBalance> = {};
    for (const row of rows) {
      out[row.accountId] = {
        balance: row.balance,
        balanceType: row.balanceType,
      };
    }
    return out;
  }

  /** get the running balance as of a given date (last ledger entry on or before that date). */
  getBalanceAtDate(
    accountId: number,
    date: string,
  ): { balance: number; balanceType: string; date: string } | null {
    const row = this.stmGetBalanceAtDate.get({ accountId, date }) as
      | { balance: number; balanceType: string; date: string }
      | undefined;
    return row ?? null;
  }

  /** get ledger entries within a date range (inclusive). */
  getLedgerRange(
    accountId: number,
    startDate: string,
    endDate: string,
  ): Ledger[] {
    return this.stmGetLedgerRange.all({
      accountId,
      startDate,
      endDate,
    }) as Ledger[];
  }

  insertLedger(ledger: Omit<Ledger, 'id'>): RunResult {
    return this.stmLedger.run({
      date: ledger.date,
      accountId: ledger.accountId,
      debit: ledger.debit,
      credit: ledger.credit,
      balance: ledger.balance,
      balanceType: ledger.balanceType,
      particulars: ledger.particulars,
      linkedAccountId: ledger.linkedAccountId,
    });
  }

  private initPreparedStatements() {
    // This query retrieves ledger entries for a specific account, joining with the account table to get the linked account name.
    // The results are ordered by date in ascending order to ensure past dates are on top.
    // If multiple entries have the same date, they are further ordered by id in descending order to show the latest entries first.
    this.stmGetLedger = this.db.prepare(`
      SELECT l.id, l.date, l.accountId, l.particulars, l.debit, l.credit, l.balance, l.balanceType, l.linkedAccountId, a.name AS linkedAccountName, a.code AS linkedAccountCode, l.createdAt, l.updatedAt
      FROM ledger l
      LEFT JOIN account a ON l.linkedAccountId = a.id
      WHERE l.accountId = @accountId
      ORDER BY datetime(l.date, 'localtime') ASC, l.id ASC
    `);
    this.stmDeleteLedgerEntries = this.db.prepare(
      'DELETE FROM ledger WHERE accountId = @accountId',
    );
    this.stmCheckNewerEntries = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM ledger
      WHERE accountId = @accountId
      AND date > @date
    `);
    this.stmLedger = this.db.prepare(
      `INSERT INTO ledger (date, accountId, debit, credit, balance, balanceType, particulars, linkedAccountId)
       VALUES (@date, @accountId, @debit, @credit, @balance, @balanceType, @particulars, @linkedAccountId)`,
    );
    this.stmGetBalance = this.db.prepare(
      `SELECT balance, balanceType
       FROM ledger
       WHERE accountId = @accountId
       ORDER BY date DESC, id DESC
       LIMIT 1`,
    );

    this.stmGetBalanceAtDate = this.db.prepare(
      `SELECT balance, balanceType, date
       FROM ledger
       WHERE accountId = @accountId
         AND (
           CASE
             WHEN length(date) = 10 THEN date
             ELSE date(datetime(date, 'localtime'))
           END
         ) < @date
       ORDER BY
         (
           CASE
             WHEN length(date) = 10 THEN date
             ELSE date(datetime(date, 'localtime'))
           END
         ) DESC,
         datetime(date, 'localtime') DESC,
         id DESC
       LIMIT 1`,
    );

    this.stmGetLedgerRange = this.db.prepare(
      `SELECT l.id, l.date, l.accountId, l.particulars, l.debit, l.credit, l.balance, l.balanceType, l.linkedAccountId, a.name AS linkedAccountName, a.code AS linkedAccountCode, l.createdAt, l.updatedAt
       FROM ledger l
       LEFT JOIN account a ON l.linkedAccountId = a.id
       WHERE l.accountId = @accountId
         AND (
           CASE
             WHEN length(l.date) = 10 THEN l.date
             ELSE date(datetime(l.date, 'localtime'))
           END
         ) >= @startDate
         AND (
           CASE
             WHEN length(l.date) = 10 THEN l.date
             ELSE date(datetime(l.date, 'localtime'))
           END
         ) <= @endDate
       ORDER BY datetime(l.date, 'localtime') ASC, l.id ASC`,
    );

    this.stmGetBalancesForAccountIdsAsOfDate = this.db.prepare(`
      SELECT t.accountId, t.balance, t.balanceType
      FROM (
        SELECT
          l.accountId,
          l.balance,
          l.balanceType,
          ROW_NUMBER() OVER (
            PARTITION BY l.accountId
            ORDER BY datetime(l.date, 'localtime') DESC, l.id DESC
          ) AS rn
        FROM ledger l
        WHERE l.accountId IN (
          SELECT CAST(j.value AS INTEGER)
          FROM json_each(@accountIdsJson) AS j
        )
          AND (
            CASE
              WHEN length(l.date) = 10 THEN l.date
              ELSE date(datetime(l.date, 'localtime'))
            END
          ) <= @asOfDate
      ) t
      WHERE t.rn = 1
    `);
  }
}
