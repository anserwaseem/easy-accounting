import type { Ledger } from 'types';
import type { Database, Statement } from 'better-sqlite3';
import { DatabaseService } from './Database.service';
import { logErrors } from '../errorLogger';

@logErrors
export class LedgerService {
  private db: Database;

  private stmGetLedger!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.initPreparedStatements();
  }

  getLedger(accountId: number): Ledger[] {
    const result = this.stmGetLedger.all({ accountId }) as Ledger[];
    return result;
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
      ORDER BY datetime(l.date) ASC, l.id DESC
    `);
  }
}
