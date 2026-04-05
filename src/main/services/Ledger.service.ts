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
      SELECT l.id, l.date, l.accountId, l.particulars, l.debit, l.credit, l.balance, l.balanceType, l.linkedAccountId, a.name AS linkedAccountName, l.createdAt, l.updatedAt
      FROM ledger l
      LEFT JOIN account a ON l.linkedAccountId = a.id
      WHERE l.accountId = @accountId
      ORDER BY datetime(l.date) ASC, l.id ASC
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
  }
}
