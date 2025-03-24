import type { Account, InsertAccount, UpdateAccount } from 'types';
import type { Database, Statement } from 'better-sqlite3';
import { store } from '../store';
import { DatabaseService } from './Database.service';
import { cast } from '../utils/sqlite';
import { logErrors } from '../errorLogger';

@logErrors
export class AccountService {
  private db: Database;

  private stmGetAccounts!: Statement;

  private stmInsertAccount!: Statement;

  private stmUpdateAccount!: Statement;

  private stmGetAccountByName!: Statement;

  private stmUpdateAccountChart!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.initPreparedStatements();
  }

  getAccounts(): Account[] {
    const username = store.get('username');
    const results = this.stmGetAccounts.all({
      username,
    }) as Account[];
    return results;
  }

  insertAccount(account: InsertAccount): boolean {
    const username = store.get('username');
    const result = this.stmInsertAccount.run({ ...account, username });
    return Number.isSafeInteger(result.lastInsertRowid);
  }

  insertAccountIfNotExists(account: InsertAccount): {
    success: boolean;
    accountId: number;
  } {
    // check if account already exists
    const existingAccount = this.getAccountByNameAndCode(
      account.name,
      account.code,
    );

    if (existingAccount) {
      // check if headName has changed and update chartId if needed
      if (existingAccount.headName !== account.headName) {
        const username = store.get('username');
        this.stmUpdateAccountChart.run({
          id: cast(existingAccount.id),
          headName: account.headName,
          username,
        });
      }

      return {
        success: true,
        accountId: existingAccount.id,
      };
    }

    const username = store.get('username');
    const result = this.stmInsertAccount.run({ ...account, username });
    return {
      success: !!result.lastInsertRowid,
      accountId: result.lastInsertRowid as number,
    };
  }

  updateAccount(account: UpdateAccount): boolean {
    const username = store.get('username');
    const result = this.stmUpdateAccount.run({
      ...account,
      id: cast(account.id),
      username,
    });
    return Boolean(result.changes);
  }

  getAccountByNameAndCode(
    name: Account['name'],
    code?: Account['code'],
  ): Account | undefined {
    const username = store.get('username');
    const result = <Account | undefined>this.stmGetAccountByName.get({
      name,
      code,
      username,
    });
    return result;
  }

  private initPreparedStatements() {
    this.stmGetAccounts = this.db.prepare(`
      SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt, a.address, a.phone1, a.phone2, a.goodsName
      FROM account a
      JOIN chart c ON c.id = a.chartId
      WHERE userId = (
        SELECT id
        FROM users
        WHERE username = @username
      )
    `);

    this.stmInsertAccount = this.db.prepare(`
      INSERT INTO account (name, chartId, code, address, phone1, phone2, goodsName)
      VALUES (@name, (
        SELECT id
        FROM chart
        WHERE name = @headName AND userId = (
          SELECT id
          FROM users
          WHERE username = @username
        )
      ), @code, @address, @phone1, @phone2, @goodsName)
    `);

    this.stmUpdateAccount = this.db.prepare(`
      UPDATE account
      SET name = @name, code = @code, address = @address, phone1 = @phone1, phone2 = @phone2, goodsName = @goodsName, chartId = (
        SELECT id
        FROM chart
        WHERE name = @headName AND userId = (
          SELECT id
          FROM users
          WHERE username = @username
        )
      )
      WHERE id = @id
    `);

    this.stmUpdateAccountChart = this.db.prepare(`
      UPDATE account
      SET chartId = (
        SELECT id
        FROM chart
        WHERE name = @headName AND userId = (
          SELECT id
          FROM users
          WHERE username = @username
        )
      )
      WHERE id = @id
    `);

    this.stmGetAccountByName = this.db.prepare(`
      SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt
      FROM account a
      JOIN chart c ON c.id = a.chartId
      WHERE LOWER(a.name) LIKE LOWER(@name) AND userId = (
        SELECT id
        FROM users
        WHERE username = @username
      )
        AND (@code IS NULL OR LOWER(a.code) LIKE LOWER(@code))
    `);
  }
}
