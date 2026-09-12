import type {
  Account,
  AccountUrduBulkUpdateResult,
  AccountUrduFieldPatch,
  InsertAccount,
  UpdateAccount,
} from '../../types';
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

const ACCOUNT_BOOLEAN_FIELDS = [
  'isActive',
  'discountProfileIsActive',
  'tracksVendorStock',
] as const;

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
      AND NOT (a.name = '${OPENING_BALANCE_EQUITY_ACCOUNT_NAME}' AND c.type = '${OPENING_BALANCE_EQUITY_CHART_NAME}')
    `,
  insertAccount: `
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
    `,
  updateAccount: `
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
      SELECT a.id, a.name, c.name as headName, a.chartId, c.type, a.code, a.createdAt, a.updatedAt, a.isActive, COALESCE(a.tracksVendorStock, 0) AS tracksVendorStock, a.discountProfileId
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
    `,
  getAccountByNameAnyChart: `
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
  getAccountById: `
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
    `,
  updateAccountUrdu: `
      UPDATE account
      SET nameUrdu = @nameUrdu,
          addressUrdu = @addressUrdu,
          goodsNameUrdu = @goodsNameUrdu
      WHERE id = @id
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
    const results = await this.db.all<Account>(sql, [username, ...unique]);
    return normalizeSqliteBooleanRows(results, ACCOUNT_BOOLEAN_FIELDS);
  }

  async insertAccount(account: InsertAccount): Promise<boolean> {
    const username = this.session.getUsername();
    const result = await this.db.run(SQL.insertAccount, {
      ...account,
      nameUrdu: account.nameUrdu ?? null,
      addressUrdu: account.addressUrdu ?? null,
      goodsNameUrdu: account.goodsNameUrdu ?? null,
      tracksVendorStock: cast(!!account.tracksVendorStock),
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

  async updateAccount(account: UpdateAccount): Promise<boolean> {
    const username = this.session.getUsername();
    const result = await this.db.run(SQL.updateAccount, {
      ...account,
      nameUrdu: account.nameUrdu ?? null,
      addressUrdu: account.addressUrdu ?? null,
      goodsNameUrdu: account.goodsNameUrdu ?? null,
      tracksVendorStock: cast(!!account.tracksVendorStock),
      id: cast(account.id),
      username,
    });
    return Boolean(result.changes);
  }

  /**
   * apply Urdu print fields from spreadsheet import.
   * match by id when present, else by name (+ optional code).
   * only keys present on the patch are written (undefined = leave unchanged).
   */
  async bulkUpdateUrduFields(
    patches: AccountUrduFieldPatch[],
  ): Promise<AccountUrduBulkUpdateResult> {
    const username = this.session.getUsername();
    let updated = 0;
    let notFound = 0;
    let ambiguous = 0;

    await this.db.transaction(async () => {
      // sequential: each patch may re-read the row the previous one wrote
      for (const patch of patches) {
        // eslint-disable-next-line no-await-in-loop
        const resolved = await this.resolveAccountForUrduPatch(patch, username);
        if (resolved === 'notFound') {
          notFound += 1;
          continue;
        }
        if (resolved === 'ambiguous') {
          ambiguous += 1;
          continue;
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

        // eslint-disable-next-line no-await-in-loop
        const result = await this.db.run(SQL.updateAccountUrdu, {
          id: cast(resolved.id),
          nameUrdu: nextNameUrdu,
          addressUrdu: nextAddressUrdu,
          goodsNameUrdu: nextGoodsNameUrdu,
        });
        if (result.changes > 0) updated += 1;
        else notFound += 1;
      }
    });

    return { updated, notFound, ambiguous };
  }

  private async resolveAccountForUrduPatch(
    patch: AccountUrduFieldPatch,
    username: unknown,
  ): Promise<Account | 'notFound' | 'ambiguous'> {
    if (patch.id != null && Number.isFinite(patch.id) && patch.id > 0) {
      const byId = await this.db.get<Account>(SQL.getAccountById, {
        id: cast(patch.id),
        username,
      });
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
      await this.db.all<Account>(SQL.getAccountByName, {
        name,
        code,
        username,
      })
    ).map(
      (row) =>
        normalizeSqliteBooleanFields(row, ACCOUNT_BOOLEAN_FIELDS) as Account,
    );

    // getAccountByName uses LIKE; prefer exact trimmed name matches
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
