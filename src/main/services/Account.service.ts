import type { Account, InsertAccount, UpdateAccount } from 'types';
import type { Database } from 'better-sqlite3';
import { store } from '../store';
import { DatabaseService } from './Database.service';
import { cast } from '../utils/sqlite';

export class AccountService {
  private db: Database;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
  }

  public getAccounts(): Account[] {
    const stm = this.db.prepare(
      ` SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt
        FROM account a
        JOIN chart c
        ON c.id = a.chartId
        WHERE userId = (
          SELECT id
          FROM users
          WHERE username = @username
        )`,
    );

    return stm.all({
      username: store.get('username'),
    }) as Account[];
  }

  public insertAccount(account: InsertAccount): boolean {
    const username = store.get('username');

    const stm = this.db.prepare(
      ` INSERT INTO account (name, chartId, code)
        VALUES (@name, (
          SELECT id
          FROM chart
          WHERE name = @headName AND userId = (
            SELECT id
            FROM users
            WHERE username = '${username}'
          )
        ), @code)`,
    );

    return Number.isSafeInteger(stm.run(account).lastInsertRowid);
  }

  public updateAccount(account: UpdateAccount): boolean {
    const username = store.get('username');

    const stm = this.db.prepare(
      ` UPDATE account
        SET name = @name, code = @code, chartId = (
          SELECT id
          FROM chart
          WHERE name = @headName AND userId = (
            SELECT id
            FROM users
            WHERE username = '${username}'
          )
        )
        WHERE id = @id`,
    );

    return Boolean(stm.run({ ...account, id: cast(account.id) }).changes);
  }
}
