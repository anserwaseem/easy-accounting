import type {
  Account,
  CustomerGroup,
  CustomerGroupWithAccounts,
  InsertAccount,
  UpdateAccount,
} from 'types';
import type { Database, Statement } from 'better-sqlite3';
import { store } from '../store';
import { DatabaseService } from './Database.service';
import {
  cast,
  normalizeSqliteBooleanFields,
  normalizeSqliteBooleanRows,
} from '../utils/sqlite';
import { logErrors } from '../errorLogger';

const ACCOUNT_BOOLEAN_FIELDS = ['isActive', 'discountProfileIsActive'] as const;

@logErrors
export class AccountService {
  private db: Database;

  private stmGetAccounts!: Statement;

  private stmInsertAccount!: Statement;

  private stmUpdateAccount!: Statement;

  private stmGetAccountByName!: Statement;

  private stmUpdateAccountChart!: Statement;

  private stmHasJournals!: Statement;

  private stmDeleteAccount!: Statement;

  private stmToggleAccountActive!: Statement;

  private stmUpdateAccountDiscountProfile!: Statement;

  private stmGetAccountByNameAndChart!: Statement;

  private stmGetAccountByNameAnyChart!: Statement;

  private stmGetCustomerGroups!: Statement;

  private stmGetCustomerGroupMembers!: Statement;

  private stmGetAccountsInGroup!: Statement;

  private stmSetAccountCustomerGroup!: Statement;

  private stmInsertCustomerGroup!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.initPreparedStatements();
  }

  getAccounts(): Account[] {
    const username = store.get('username');
    const results = this.stmGetAccounts.all({ username }) as Account[];
    return normalizeSqliteBooleanRows(results, ACCOUNT_BOOLEAN_FIELDS);
  }

  /** same row shape as getAccounts, but restricted to ids (invoice details related ledgers). */
  getAccountsByIds(ids: number[]): Account[] {
    const unique = [
      ...new Set(ids.filter((id) => Number.isInteger(id) && id > 0)),
    ];
    if (unique.length === 0) return [];
    const username = store.get('username');
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
        a.customerGroupId,
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
    const stmt = this.db.prepare(sql);
    const results = stmt.all(username, ...unique) as Account[];
    return normalizeSqliteBooleanRows(results, ACCOUNT_BOOLEAN_FIELDS);
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

  hasJournalEntries(accountId: number): boolean {
    const result = this.stmHasJournals.get({ accountId }) as { count: number };
    return result && result.count > 0;
  }

  deleteAccount(accountId: number): boolean {
    if (this.hasJournalEntries(accountId)) {
      return false;
    }

    const result = this.stmDeleteAccount.run({ accountId });
    return Boolean(result.changes);
  }

  toggleAccountActive(accountId: number, isActive: boolean): boolean {
    const result = this.stmToggleAccountActive.run({
      accountId,
      isActive: cast(isActive),
    });
    return Boolean(result.changes);
  }

  updateAccountDiscountProfile(
    accountId: number,
    discountProfileId: number | null,
  ): boolean {
    const result = this.stmUpdateAccountDiscountProfile.run({
      accountId: cast(accountId),
      discountProfileId:
        discountProfileId == null ? null : cast(discountProfileId),
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
    return result
      ? normalizeSqliteBooleanFields(result, ACCOUNT_BOOLEAN_FIELDS)
      : result;
  }

  getAccountByNameAndChart(chartId: number, name: string): Account | undefined {
    const username = store.get('username');
    const trimmedName = name.trim();
    const result = <Account | undefined>this.stmGetAccountByNameAndChart.get({
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
    const anyChart = this.stmGetAccountByNameAnyChart.all({
      name: trimmedName,
      username,
    }) as Account[];
    const first = anyChart[0];
    return first
      ? (normalizeSqliteBooleanFields(first, ACCOUNT_BOOLEAN_FIELDS) as Account)
      : undefined;
  }

  /** Finds first account with exact name (trimmed) in any chart for current user. */
  getAccountByName(name: string): Account | undefined {
    const username = store.get('username');
    const result = this.stmGetAccountByNameAnyChart.all({
      name: name.trim(),
      username,
    }) as Account[];
    const first = result[0];
    return first
      ? (normalizeSqliteBooleanFields(first, ACCOUNT_BOOLEAN_FIELDS) as Account)
      : undefined;
  }

  /** all customer groups with their member accounts (ids/names/codes) */
  getCustomerGroups(): CustomerGroupWithAccounts[] {
    const username = store.get('username');
    const groups = this.stmGetCustomerGroups.all() as CustomerGroup[];
    const members = this.stmGetCustomerGroupMembers.all({
      username,
    }) as Array<
      Pick<Account, 'id' | 'name' | 'code'> & {
        customerGroupId: number;
      }
    >;

    const accountsByGroupId = new Map<
      number,
      CustomerGroupWithAccounts['accounts']
    >();
    members.forEach(({ customerGroupId, ...account }) => {
      const list = accountsByGroupId.get(customerGroupId) ?? [];
      list.push(account);
      accountsByGroupId.set(customerGroupId, list);
    });

    return groups.map((group) => ({
      ...group,
      accounts: accountsByGroupId.get(group.id) ?? [],
    }));
  }

  /** member accounts of one group, same row shape as getAccounts */
  getAccountsInGroup(groupId: number): Account[] {
    if (!Number.isInteger(groupId) || groupId <= 0) return [];
    const username = store.get('username');
    const results = this.stmGetAccountsInGroup.all({
      groupId: cast(groupId),
      username,
    }) as Account[];
    return normalizeSqliteBooleanRows(results, ACCOUNT_BOOLEAN_FIELDS);
  }

  /** assigns an account to a customer group, or clears it with null */
  setAccountCustomerGroup(
    accountId: number,
    customerGroupId: number | null,
  ): boolean {
    if (!Number.isInteger(accountId) || accountId <= 0) return false;
    if (
      customerGroupId !== null &&
      (!Number.isInteger(customerGroupId) || customerGroupId <= 0)
    ) {
      return false;
    }
    const result = this.stmSetAccountCustomerGroup.run({
      accountId: cast(accountId),
      customerGroupId: customerGroupId === null ? null : cast(customerGroupId),
    });
    return Boolean(result.changes);
  }

  /** creates an empty customer group; returns it, or undefined for a blank name */
  createCustomerGroup(name: string): CustomerGroup | undefined {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (trimmedName.length === 0) return undefined;
    const result = this.stmInsertCustomerGroup.run({ name: trimmedName });
    if (!Number.isSafeInteger(result.lastInsertRowid)) return undefined;
    return { id: Number(result.lastInsertRowid), name: trimmedName };
  }

  private initPreparedStatements() {
    this.stmGetAccounts = this.db.prepare(`
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
        a.customerGroupId,
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
    `);

    this.stmInsertAccount = this.db.prepare(`
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
    `);

    this.stmUpdateAccount = this.db.prepare(`
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
      SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt, a.isActive, a.discountProfileId
      FROM account a
      JOIN chart c ON c.id = a.chartId
      WHERE LOWER(a.name) LIKE LOWER(@name) AND userId = (
        SELECT id
        FROM users
        WHERE username = @username
      )
        AND (@code IS NULL OR LOWER(a.code) LIKE LOWER(@code))
    `);

    this.stmGetAccountByNameAndChart = this.db.prepare(`
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
    `);

    this.stmGetAccountByNameAnyChart = this.db.prepare(`
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
    `);

    this.stmHasJournals = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM journal_entry
      WHERE accountId = @accountId
    `);

    this.stmDeleteAccount = this.db.prepare(`
      DELETE FROM account
      WHERE id = @accountId
    `);

    this.stmToggleAccountActive = this.db.prepare(`
      UPDATE account
      SET isActive = @isActive
      WHERE id = @accountId
    `);

    this.stmUpdateAccountDiscountProfile = this.db.prepare(`
      UPDATE account
      SET discountProfileId = @discountProfileId
      WHERE id = @accountId
    `);

    this.stmGetCustomerGroups = this.db.prepare(`
      SELECT id, name, createdAt, updatedAt
      FROM customer_groups
      ORDER BY name COLLATE NOCASE, id
    `);

    this.stmGetCustomerGroupMembers = this.db.prepare(`
      SELECT a.id, a.name, a.code, a.customerGroupId
      FROM account a
      JOIN chart c ON c.id = a.chartId
      WHERE a.customerGroupId IS NOT NULL
        AND c.userId = (
          SELECT id
          FROM users
          WHERE username = @username
        )
      ORDER BY a.name COLLATE NOCASE, a.id
    `);

    this.stmGetAccountsInGroup = this.db.prepare(`
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
        a.customerGroupId,
        dp.name AS discountProfileName,
        dp.isActive AS discountProfileIsActive
      FROM account a
      JOIN chart c ON c.id = a.chartId
      LEFT JOIN discount_profiles dp ON dp.id = a.discountProfileId
      WHERE a.customerGroupId = @groupId
        AND c.userId = (
          SELECT id
          FROM users
          WHERE username = @username
        )
      ORDER BY a.name COLLATE NOCASE, a.id
    `);

    this.stmSetAccountCustomerGroup = this.db.prepare(`
      UPDATE account
      SET customerGroupId = @customerGroupId
      WHERE id = @accountId
    `);

    this.stmInsertCustomerGroup = this.db.prepare(`
      INSERT INTO customer_groups (name) VALUES (@name)
    `);
  }
}
