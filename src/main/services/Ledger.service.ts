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
    this.stmGetLedger = this.db.prepare(`
      SELECT l.id, l.date, l.accountId, l.particulars, l.debit, l.credit, l.balance, l.balanceType, l.linkedAccountId, a.name AS linkedAccountName, l.createdAt, l.updatedAt
      FROM ledger l
      LEFT JOIN account a ON l.linkedAccountId = a.id
      WHERE l.accountId = @accountId
      ORDER BY l.createdAt DESC
    `);
  }
}
