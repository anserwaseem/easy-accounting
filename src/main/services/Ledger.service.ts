import type { Ledger } from 'types';
import type { Database } from 'better-sqlite3';
import { DatabaseService } from './Database.service';

export class LedgerService {
  private db: Database;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
  }

  public getLedger(accountId: number) {
    const stm = this.db.prepare(
      ` SELECT l.id, l.date, l.accountId, l.particulars, l.debit, l.credit, l.balance, l.balanceType, l.linkedAccountId, a.name AS linkedAccountName, l.createdAt, l.updatedAt
      FROM ledger l
      LEFT JOIN account a
      ON l.linkedAccountId = a.id
      WHERE l.accountId = @accountId
      ORDER BY l.createdAt DESC`,
    );

    return stm.all({ accountId }) as Ledger[];
  }
}
