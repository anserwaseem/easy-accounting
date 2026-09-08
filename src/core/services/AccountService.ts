import type { Account, InsertAccount, UpdateAccount } from 'types';
import type { DatabaseDriver } from '../db/driver';
import type { SessionContext } from '../ports';
import {
  cast,
  normalizeSqliteBooleanFields,
  normalizeSqliteBooleanRows,
} from '../utils/sqlite';
import { logErrors } from '../errorLogger';
import {
  OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
  OPENING_BALANCE_EQUITY_CHART_NAME,
} from '../db/openingBalanceBackfill';

const ACCOUNT_BOOLEAN_FIELDS = ['isActive', 'discountProfileIsActive'] as const;

const SQL = {
  // List query only. The system "Opening Balance Equity" account (under the
  // Equity-type chart) is structural — created by import/balance-sheet-
  // upload backfills, never a screen the desktop app showed — so it is
  // excluded here even though it stays in every other consumer of `account`
  // (statements, trial balance, ledger lookups by id, charts). Matched on
  // BOTH name and chart type so a user's own non-Equity account that happens
  // to share the name is never hidden. Both literals are quote-free system
  // constants (see openingBalanceBackfill.ts), safe to interpolate directly.
  getAccounts: `
      SELECT
        a.id,
        a.name,
        c.name as headName,
        a.chartId,
        c.type,
        a.code,
        a.createdAt,
        a.updatedAt,
        a.address,
        a.phone1,
        a.phone2,
        a.goodsName,
        a.isActive,
        a.discountProfileId,
        dp.name AS discountProfileName,
        dp.isActive AS discountProfileIsActive
      FROM account a
      JOIN chart c ON c.id = a.chartId
      LEFT JOIN discount_profiles dp ON dp.id = a.discountProfileId
      WHERE userId = (
        SELECT id
        FROM users
        WHERE username = @username
      )
      AND NOT (a.name = '${OPENING_BALANCE_EQUITY_ACCOUNT_NAME}' AND c.type = '${OPENING_BALANCE_EQUITY_CHART_NAME}')
    `,
  insertAccount: `
      INSERT INTO account (name, chartId, code, address, phone1, phone2, goodsName, isActive, discountProfileId)
      VALUES (@name, (
        SELECT id
        FROM chart
        WHERE name = @headName AND userId = (
          SELECT id
          FROM users
          WHERE username = @username
        )
      ), @code, @address, @phone1, @phone2, @goodsName, 1, @discountProfileId)
    `,
  updateAccount: `
      UPDATE account
      SET name = @name, code = @code, address = @address, phone1 = @phone1, phone2 = @phone2, goodsName = @goodsName, discountProfileId = @discountProfileId, chartId = (
        SELECT id
        FROM chart
        WHERE name = @headName AND userId = (
          SELECT id
          FROM users
          WHERE username = @username
        )
      )
      WHERE id = @id
    `,
  updateAccountChart: `
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
    `,
  getAccountByName: `
      SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt, a.isActive, a.discountProfileId
      FROM account a
      JOIN chart c ON c.id = a.chartId
      WHERE LOWER(a.name) LIKE LOWER(@name) AND userId = (
        SELECT id
        FROM users
        WHERE username = @username
      )
        AND (@code IS NULL OR LOWER(a.code) LIKE LOWER(@code))
    `,
  getAccountByNameAndChart: `
      SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt, a.isActive, a.discountProfileId
      FROM account a
      JOIN chart c ON c.id = a.chartId
      WHERE a.chartId = @chartId
        AND TRIM(a.name) = TRIM(@name)
        AND c.userId = (
          SELECT id
          FROM users
          WHERE username = @username
        )
      LIMIT 1
    `,
  getAccountByNameAnyChart: `
      SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt, a.isActive, a.discountProfileId
      FROM account a
      JOIN chart c ON c.id = a.chartId
      WHERE TRIM(a.name) = TRIM(@name)
        AND c.userId = (
          SELECT id
          FROM users
          WHERE username = @username
        )
      LIMIT 1
    `,
  hasJournals: `
      SELECT COUNT(*) as count
      FROM journal_entry
      WHERE accountId = @accountId
    `,
  deleteAccount: `
      DELETE FROM account
      WHERE id = @accountId
    `,
  toggleAccountActive: `
      UPDATE account
      SET isActive = @isActive
      WHERE id = @accountId
    `,
  updateAccountDiscountProfile: `
      UPDATE account
      SET discountProfileId = @discountProfileId
      WHERE id = @accountId
    `,
};

/**
 * Platform-free port of src/main/services/Account.service.ts — identical SQL
 * and behavior, async against the DatabaseDriver, session injected.
 */
@logErrors
export class AccountService {
  private db: DatabaseDriver;

  private session: SessionContext;

  constructor(deps: { db: DatabaseDriver; session: SessionContext }) {
    this.db = deps.db;
    this.session = deps.session;
  }

  async getAccounts(): Promise<Account[]> {
    const username = this.session.getUsername();
    const results = await this.db.all<Account>(SQL.getAccounts, { username });
    return normalizeSqliteBooleanRows(results, ACCOUNT_BOOLEAN_FIELDS);
  }

  /** same row shape as getAccounts, but restricted to ids (invoice details related ledgers). */
  async getAccountsByIds(ids: number[]): Promise<Account[]> {
    const unique = [
      ...new Set(ids.filter((id) => Number.isInteger(id) && id > 0)),
    ];
    if (unique.length === 0) return [];
    const username = this.session.getUsername();
    const placeholders = unique.map(() => '?').join(',');
    const sql = `
      SELECT
        a.id,
        a.name,
        c.name as headName,
        a.chartId,
        c.type,
        a.code,
        a.createdAt,
        a.updatedAt,
        a.address,
        a.phone1,
        a.phone2,
        a.goodsName,
        a.isActive,
        a.discountProfileId,
        dp.name AS discountProfileName,
        dp.isActive AS discountProfileIsActive
      FROM account a
      JOIN chart c ON c.id = a.chartId
      LEFT JOIN discount_profiles dp ON dp.id = a.discountProfileId
      WHERE c.userId = (
        SELECT id FROM users WHERE username = ?
      )
      AND a.id IN (${placeholders})
    `;
    const results = await this.db.all<Account>(sql, [username, ...unique]);
    return normalizeSqliteBooleanRows(results, ACCOUNT_BOOLEAN_FIELDS);
  }

  async insertAccount(account: InsertAccount): Promise<boolean> {
    const username = this.session.getUsername();
    const result = await this.db.run(SQL.insertAccount, {
      ...account,
      username,
    });
    return Number.isSafeInteger(result.lastInsertRowid);
  }

  async insertAccountIfNotExists(account: InsertAccount): Promise<{
    success: boolean;
    accountId: number;
  }> {
    // check if account already exists
    const existingAccount = await this.getAccountByNameAndCode(
      account.name,
      account.code,
    );

    if (existingAccount) {
      // check if headName has changed and update chartId if needed
      if (existingAccount.headName !== account.headName) {
        const username = this.session.getUsername();
        await this.db.run(SQL.updateAccountChart, {
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

    const username = this.session.getUsername();
    const result = await this.db.run(SQL.insertAccount, {
      ...account,
      username,
    });
    return {
      success: !!result.lastInsertRowid,
      accountId: result.lastInsertRowid as number,
    };
  }

  async updateAccount(account: UpdateAccount): Promise<boolean> {
    const username = this.session.getUsername();
    const result = await this.db.run(SQL.updateAccount, {
      ...account,
      id: cast(account.id),
      username,
    });
    return Boolean(result.changes);
  }

  async hasJournalEntries(accountId: number): Promise<boolean> {
    const result = await this.db.get<{ count: number }>(SQL.hasJournals, {
      accountId,
    });
    return Boolean(result && result.count > 0);
  }

  async deleteAccount(accountId: number): Promise<boolean> {
    if (await this.hasJournalEntries(accountId)) {
      return false;
    }

    const result = await this.db.run(SQL.deleteAccount, { accountId });
    return Boolean(result.changes);
  }

  async toggleAccountActive(
    accountId: number,
    isActive: boolean,
  ): Promise<boolean> {
    const result = await this.db.run(SQL.toggleAccountActive, {
      accountId,
      isActive: cast(isActive),
    });
    return Boolean(result.changes);
  }

  async updateAccountDiscountProfile(
    accountId: number,
    discountProfileId: number | null,
  ): Promise<boolean> {
    const result = await this.db.run(SQL.updateAccountDiscountProfile, {
      accountId: cast(accountId),
      discountProfileId:
        discountProfileId == null ? null : cast(discountProfileId),
    });
    return Boolean(result.changes);
  }

  async getAccountByNameAndCode(
    name: Account['name'],
    code?: Account['code'],
  ): Promise<Account | undefined> {
    const username = this.session.getUsername();
    const result = await this.db.get<Account>(SQL.getAccountByName, {
      name,
      code: code ?? null,
      username,
    });
    return result
      ? normalizeSqliteBooleanFields(result, ACCOUNT_BOOLEAN_FIELDS)
      : result;
  }

  async getAccountByNameAndChart(
    chartId: number,
    name: string,
  ): Promise<Account | undefined> {
    const username = this.session.getUsername();
    const trimmedName = name.trim();
    const result = await this.db.get<Account>(SQL.getAccountByNameAndChart, {
      chartId: cast(chartId),
      name: trimmedName,
      username,
    });
    if (result) {
      return normalizeSqliteBooleanFields(
        result,
        ACCOUNT_BOOLEAN_FIELDS,
      ) as Account;
    }
    // fallback: suffixed account may live in a different chart
    const anyChart = await this.db.all<Account>(SQL.getAccountByNameAnyChart, {
      name: trimmedName,
      username,
    });
    const first = anyChart[0];
    return first
      ? (normalizeSqliteBooleanFields(first, ACCOUNT_BOOLEAN_FIELDS) as Account)
      : undefined;
  }

  /** Finds first account with exact name (trimmed) in any chart for current user. */
  async getAccountByName(name: string): Promise<Account | undefined> {
    const username = this.session.getUsername();
    const result = await this.db.all<Account>(SQL.getAccountByNameAnyChart, {
      name: name.trim(),
      username,
    });
    const first = result[0];
    return first
      ? (normalizeSqliteBooleanFields(first, ACCOUNT_BOOLEAN_FIELDS) as Account)
      : undefined;
  }
}
