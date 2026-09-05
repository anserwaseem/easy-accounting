import type {
  Account,
  AccountUrduBulkUpdateResult,
  AccountUrduFieldPatch,
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

const ACCOUNT_BOOLEAN_FIELDS = [
  'isActive',
  'discountProfileIsActive',
  'tracksVendorStock',
] as const;

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

  private stmGetAccountById!: Statement;

  private stmUpdateAccountUrdu!: Statement;

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
        a.nameUrdu,
        a.addressUrdu,
        a.goodsNameUrdu,
        a.isActive,
        COALESCE(a.tracksVendorStock, 0) AS tracksVendorStock,
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
    const stmt = this.db.prepare(sql);
    const results = stmt.all(username, ...unique) as Account[];
    return normalizeSqliteBooleanRows(results, ACCOUNT_BOOLEAN_FIELDS);
  }

  insertAccount(account: InsertAccount): boolean {
    const username = store.get('username');
    const result = this.stmInsertAccount.run({
      ...account,
      nameUrdu: account.nameUrdu ?? null,
      addressUrdu: account.addressUrdu ?? null,
      goodsNameUrdu: account.goodsNameUrdu ?? null,
      tracksVendorStock: cast(!!account.tracksVendorStock),
      username,
    });
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
    const result = this.stmInsertAccount.run({
      ...account,
      nameUrdu: account.nameUrdu ?? null,
      addressUrdu: account.addressUrdu ?? null,
      goodsNameUrdu: account.goodsNameUrdu ?? null,
      tracksVendorStock: cast(!!account.tracksVendorStock),
      username,
    });
    return {
      success: !!result.lastInsertRowid,
      accountId: result.lastInsertRowid as number,
    };
  }

  updateAccount(account: UpdateAccount): boolean {
    const username = store.get('username');
    const result = this.stmUpdateAccount.run({
      ...account,
      nameUrdu: account.nameUrdu ?? null,
      addressUrdu: account.addressUrdu ?? null,
      goodsNameUrdu: account.goodsNameUrdu ?? null,
      id: cast(account.id),
      tracksVendorStock: cast(!!account.tracksVendorStock),
      username,
    });
    return Boolean(result.changes);
  }

  /**
   * apply Urdu print fields from spreadsheet import.
   * match by id when present, else by name (+ optional code).
   * only keys present on the patch are written (undefined = leave unchanged).
   */
  bulkUpdateUrduFields(
    patches: AccountUrduFieldPatch[],
  ): AccountUrduBulkUpdateResult {
    const username = store.get('username');
    let updated = 0;
    let notFound = 0;
    let ambiguous = 0;

    const run = this.db.transaction(() => {
      patches.forEach((patch) => {
        const resolved = this.resolveAccountForUrduPatch(patch, username);
        if (resolved === 'notFound') {
          notFound += 1;
          return;
        }
        if (resolved === 'ambiguous') {
          ambiguous += 1;
          return;
        }

        const nextNameUrdu =
          patch.nameUrdu !== undefined
            ? patch.nameUrdu
            : resolved.nameUrdu ?? null;
        const nextAddressUrdu =
          patch.addressUrdu !== undefined
            ? patch.addressUrdu
            : resolved.addressUrdu ?? null;
        const nextGoodsNameUrdu =
          patch.goodsNameUrdu !== undefined
            ? patch.goodsNameUrdu
            : resolved.goodsNameUrdu ?? null;

        const result = this.stmUpdateAccountUrdu.run({
          id: cast(resolved.id),
          nameUrdu: nextNameUrdu,
          addressUrdu: nextAddressUrdu,
          goodsNameUrdu: nextGoodsNameUrdu,
        });
        if (result.changes > 0) updated += 1;
        else notFound += 1;
      });
    });

    run();
    return { updated, notFound, ambiguous };
  }

  private resolveAccountForUrduPatch(
    patch: AccountUrduFieldPatch,
    username: unknown,
  ): Account | 'notFound' | 'ambiguous' {
    if (patch.id != null && Number.isFinite(patch.id) && patch.id > 0) {
      const byId = this.stmGetAccountById.get({
        id: cast(patch.id),
        username,
      }) as Account | undefined;
      return byId
        ? (normalizeSqliteBooleanFields(
            byId,
            ACCOUNT_BOOLEAN_FIELDS,
          ) as Account)
        : 'notFound';
    }

    const name = patch.name?.trim();
    if (!name) return 'notFound';

    const code =
      patch.code == null || String(patch.code).trim() === ''
        ? null
        : String(patch.code).trim();

    const matches = (
      this.stmGetAccountByName.all({
        name,
        code,
        username,
      }) as Account[]
    ).map(
      (row) =>
        normalizeSqliteBooleanFields(row, ACCOUNT_BOOLEAN_FIELDS) as Account,
    );

    // stmGetAccountByName uses LIKE; prefer exact trimmed name matches
    const exact = matches.filter(
      (row) => row.name.trim().toLowerCase() === name.toLowerCase(),
    );
    const pool = exact.length > 0 ? exact : matches;
    if (pool.length === 0) return 'notFound';
    if (pool.length > 1) {
      if (code != null) {
        const coded = pool.filter(
          (row) => String(row.code ?? '').trim() === code,
        );
        if (coded.length === 1) {
          return this.resolveAccountForUrduPatch({ id: coded[0].id }, username);
        }
      }
      return 'ambiguous';
    }
    // re-fetch by id so Urdu columns are present (name lookup SELECT omits them)
    return this.resolveAccountForUrduPatch({ id: pool[0].id }, username);
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
        a.nameUrdu,
        a.addressUrdu,
        a.goodsNameUrdu,
        a.isActive,
        COALESCE(a.tracksVendorStock, 0) AS tracksVendorStock,
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
    `);

    this.stmInsertAccount = this.db.prepare(`
      INSERT INTO account (name, chartId, code, address, phone1, phone2, goodsName, nameUrdu, addressUrdu, goodsNameUrdu, isActive, discountProfileId, tracksVendorStock)
      VALUES (@name, (
        SELECT id
        FROM chart
        WHERE name = @headName AND userId = (
          SELECT id
          FROM users
          WHERE username = @username
        )
      ), @code, @address, @phone1, @phone2, @goodsName, @nameUrdu, @addressUrdu, @goodsNameUrdu, 1, @discountProfileId, COALESCE(@tracksVendorStock, 0))
    `);

    this.stmUpdateAccount = this.db.prepare(`
      UPDATE account
      SET name = @name, code = @code, address = @address, phone1 = @phone1, phone2 = @phone2, goodsName = @goodsName, nameUrdu = @nameUrdu, addressUrdu = @addressUrdu, goodsNameUrdu = @goodsNameUrdu, discountProfileId = @discountProfileId, tracksVendorStock = COALESCE(@tracksVendorStock, 0), chartId = (
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
      SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt, a.isActive, COALESCE(a.tracksVendorStock, 0) AS tracksVendorStock, a.discountProfileId
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
      SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt, a.isActive, COALESCE(a.tracksVendorStock, 0) AS tracksVendorStock, a.discountProfileId
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
      SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt, a.isActive, COALESCE(a.tracksVendorStock, 0) AS tracksVendorStock, a.discountProfileId
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

    this.stmGetAccountById = this.db.prepare(`
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
        a.nameUrdu,
        a.addressUrdu,
        a.goodsNameUrdu,
        a.isActive,
        a.discountProfileId
      FROM account a
      JOIN chart c ON c.id = a.chartId
      WHERE a.id = @id AND c.userId = (
        SELECT id
        FROM users
        WHERE username = @username
      )
      LIMIT 1
    `);

    this.stmUpdateAccountUrdu = this.db.prepare(`
      UPDATE account
      SET nameUrdu = @nameUrdu,
          addressUrdu = @addressUrdu,
          goodsNameUrdu = @goodsNameUrdu
      WHERE id = @id
    `);
  }
}
