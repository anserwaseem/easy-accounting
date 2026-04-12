import type { Account, InsertAccount, UpdateAccount } from 'types';
import type { Database, Statement } from 'better-sqlite3';
import { get, isEmpty, sumBy } from 'lodash';
import { store } from '../store';
import { DatabaseService } from './Database.service';
import {
  cast,
  normalizeSqliteBooleanFields,
  normalizeSqliteBooleanRows,
} from '../utils/sqlite';
import { logErrors } from '../errorLogger';

const ACCOUNT_BOOLEAN_FIELDS = ['isActive', 'discountProfileIsActive'] as const;

/** Compute last receipt date from unallocated credits or bill receipts. */
function getLastReceiptDate(
  unallocated: Array<Record<string, unknown>>,
  bills: Array<{
    receipts: Array<{ date: string; amount: number; balance: number }>;
  }>,
): string | null {
  if (unallocated.length > 0) return unallocated.at(-1)!.date as string;
  return bills.reduce(
    (latest, b) => {
      if (b.receipts.length === 0) return latest;
      const lastReceiptDateValue = b.receipts[b.receipts.length - 1].date;
      if (latest == null) return lastReceiptDateValue;
      return lastReceiptDateValue > (latest as string)
        ? lastReceiptDateValue
        : latest;
    },
    null as string | null,
  );
}

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

  // Receivables report: FIFO allocation per account under a head
  getReceivables(
    headName: string,
    startDate: string,
    endDate: string,
  ): Record<string, unknown> {
    // get all accounts under the head
    const headAccounts = this.db
      .prepare(
        `
          SELECT a.id, a.name, a.code
          FROM account a
          LEFT JOIN chart c ON c.id = a.chartId
          WHERE LOWER(c.name) = LOWER(?)
          ORDER BY a.id
        `,
      )
      .all(headName) as Array<{
      id: number;
      name: string;
      code: string | null;
    }>;

    if (isEmpty(headAccounts)) {
      return { kpis: {}, series: [], rows: [], anomalies: [], exportRows: [] };
    }

    const rows: Array<Record<string, unknown>> = [];
    let totalOutstanding = 0;
    let totalOverdue = 0;
    let overdueAccounts = 0;
    let totalUnallocatedReceipts = 0;
    let fullPaidBillCount = 0;
    const clearedDays: number[] = [];

    const selectedDateStart = new Date(startDate);
    selectedDateStart.setHours(0, 0, 0, 0);
    const selectedDateEnd = new Date(endDate);
    selectedDateEnd.setHours(23, 59, 59, 999);

    for (const account of Array.from(headAccounts)) {
      // get all ledger entries for account
      const fullLedger = this.db
        .prepare(
          `SELECT * FROM ledger WHERE accountId = ? ORDER BY datetime(date) ASC, id ASC`,
        )
        .all(account.id) as Array<Record<string, unknown>>;

      if (isEmpty(fullLedger)) continue;

      // opening balance: last entry before startDate
      let openingBalance = 0;
      let openingBalanceType = 'Dr';
      const entriesBeforeStart = fullLedger.filter(
        (l) => new Date(l.date as string) < selectedDateStart,
      );
      if (entriesBeforeStart.length > 0) {
        const last = entriesBeforeStart.at(-1)!;
        openingBalance = last.balance as number;
        openingBalanceType = last.balanceType as string;
      }

      // entries within range
      const entriesInRange = fullLedger.filter((l) => {
        const d = new Date(l.date as string);
        return d >= selectedDateStart && d <= selectedDateEnd;
      });

      if (isEmpty(entriesInRange) && openingBalance === 0) continue;

      // separate debit/credit entries in range
      const debitEntries = entriesInRange.filter(
        (e) => (e.debit as number) > 0,
      );
      const creditEntries = entriesInRange.filter(
        (e) => (e.credit as number) > 0,
      );

      // build bills from debit entries; opening balance as first bill
      const bills: Array<{
        billNumber: string;
        billDate: string;
        billAmount: number;
        receipts: Array<{ date: string; amount: number; balance: number }>;
        remainingBalance: number;
      }> = [];

      if (openingBalance > 0 && openingBalanceType === 'Dr') {
        bills.push({
          billNumber: 'Opening Balance',
          billDate: startDate,
          billAmount: openingBalance,
          receipts: [],
          remainingBalance: openingBalance,
        });
      }

      for (const d of debitEntries) {
        const journalMatch = String(d.particulars).match(/Journal #(\d+)/);
        let billNumber = '-';

        if (journalMatch) {
          try {
            const journal = this.db
              .prepare(`SELECT billNumber FROM journal WHERE id = ?`)
              .get(journalMatch[1]) as
              | { billNumber: string | null }
              | undefined;
            if (journal?.billNumber) {
              billNumber = String(journal.billNumber);
            }
          } catch {
            // ignore
          }
        }

        bills.push({
          billNumber,
          billDate: d.date as string,
          billAmount: d.debit as number,
          receipts: [],
          remainingBalance: d.debit as number,
        });
      }

      // allocate credits FIFO
      let creditIdx = 0;
      for (const bill of bills) {
        while (bill.remainingBalance > 0 && creditIdx < creditEntries.length) {
          const credit = creditEntries[creditIdx];
          const creditAmount = credit.credit as number;

          if (creditAmount <= bill.remainingBalance) {
            bill.remainingBalance = get(bill, 'remainingBalance', 0);
            bill.remainingBalance -= creditAmount;
            bill.receipts.push({
              date: credit.date as string,
              amount: creditAmount,
              balance: bill.remainingBalance,
            });
            creditIdx++;
          } else {
            const applied = bill.remainingBalance;
            bill.remainingBalance = 0;
            bill.receipts.push({
              date: credit.date as string,
              amount: applied,
              balance: 0,
            });
            creditEntries[creditIdx] = {
              ...credit,
              credit: creditAmount - applied,
            };
          }
        }
      }

      // account totals
      const totalBilled = sumBy(bills, 'billAmount');
      const totalCollected = sumBy(bills, (b) => sumBy(b.receipts, 'amount'));
      const totalOutstandingForAccount = totalBilled - totalCollected;
      const isOverdue = totalOutstandingForAccount > 0;

      // avg days to clear
      const clearedBills = bills.filter((b) => b.remainingBalance === 0);
      const clearedDaysSum = clearedBills.reduce((sum, bill) => {
        const billDate = new Date(bill.billDate).getTime();
        const lastPaymentDate = new Date(
          bill.receipts[bill.receipts.length - 1]?.date ?? bill.billDate,
        ).getTime();
        return sum + Math.ceil((lastPaymentDate - billDate) / 86400000);
      }, 0);
      const avgDaysToClear =
        clearedBills.length > 0
          ? Math.round((clearedDaysSum / clearedBills.length) * 10) / 10
          : null;

      // unallocated receipts
      const unallocated = creditEntries
        .slice(creditIdx)
        .filter((c) => (c.credit as number) > 0);
      const unallocatedAmount = sumBy(unallocated, 'credit');

      totalOutstanding += totalOutstandingForAccount;
      if (isOverdue) {
        totalOverdue += totalOutstandingForAccount;
        overdueAccounts++;
      }
      totalUnallocatedReceipts += unallocatedAmount;

      // build per-bill detail rows for expanded view
      const today = Math.floor(Date.now() / 86400000);
      const billDetails = bills.map((bill) => {
        // compute discount %
        let discountPercent: number | null = null;
        if (bill.billNumber !== 'Opening Balance' && bill.billNumber !== '-') {
          try {
            const inv = this.db
              .prepare(
                `SELECT id FROM invoices WHERE accountId = ? AND CAST(invoiceNumber AS TEXT) = ? AND date(date) = date(?) LIMIT 1`,
              )
              .get(account.id, bill.billNumber, bill.billDate) as
              | { id: number }
              | undefined;
            if (!inv) {
              // fallback: match by account + date only
              const invByDate = this.db
                .prepare(
                  `SELECT id FROM invoices WHERE accountId = ? AND date(date) = date(?) AND invoiceType = 'Sale' LIMIT 1`,
                )
                .get(account.id, bill.billDate) as { id: number } | undefined;
              if (invByDate) {
                const items = this.db
                  .prepare(
                    `SELECT price, discount, quantity FROM invoice_items WHERE invoiceId = ?`,
                  )
                  .all(invByDate.id) as Array<{
                  price: number;
                  discount: number;
                  quantity: number;
                }>;
                if (items.length > 0) {
                  const gross = sumBy(items, (i) => i.price * i.quantity);
                  const disc = sumBy(items, (i) => i.discount * i.quantity);
                  if (gross > 0) {
                    discountPercent = Math.round((disc / gross) * 10000) / 100;
                  }
                }
              }
            } else {
              const items = this.db
                .prepare(
                  `SELECT price, discount, quantity FROM invoice_items WHERE invoiceId = ?`,
                )
                .all(inv.id) as Array<{
                price: number;
                discount: number;
                quantity: number;
              }>;
              if (items.length > 0) {
                const gross = sumBy(items, (i) => i.price * i.quantity);
                const disc = sumBy(items, (i) => i.discount * i.quantity);
                if (gross > 0) {
                  discountPercent = Math.round((disc / gross) * 10000) / 100;
                }
              }
            }
          } catch {
            // ignore — discount% stays null
          }
        }

        // compute days status
        let daysStatus: string;
        if (bill.remainingBalance <= 0) {
          daysStatus = 'Cleared';
        } else {
          const lastRcpt = bill.receipts[bill.receipts.length - 1];
          const anchorDate = lastRcpt ? lastRcpt.date : bill.billDate;
          const anchorDay = Math.floor(
            new Date(anchorDate).getTime() / 86400000,
          );
          const daysPending = Math.max(today - anchorDay, 0);
          daysStatus = `${daysPending} days pending`;
        }

        return {
          billNumber: bill.billNumber,
          billDate: bill.billDate,
          discountPercent,
          billAmount: bill.billAmount,
          receipts: bill.receipts,
          remainingBalance: bill.remainingBalance,
          daysStatus,
        };
      });

      rows.push({
        accountId: account.id,
        accountName: account.name,
        accountCode: account.code ?? '',
        billedAmount: totalBilled,
        collectedAmount: totalCollected,
        outstandingAmount: totalOutstandingForAccount,
        overdueAmount: isOverdue ? totalOutstandingForAccount : 0,
        billCount: bills.length,
        lastBillDate: bills.length > 0 ? bills.at(-1)!.billDate : null,
        lastReceiptDate: getLastReceiptDate(unallocated, bills),
        avgDaysToClear,
        unallocatedReceipts: unallocatedAmount,
        bills: billDetails,
      });

      fullPaidBillCount += clearedBills.length;
      if (clearedBills.length > 0)
        clearedDays.push(clearedDaysSum / clearedBills.length);
    }

    const anomalies = [
      {
        type: 'overdue',
        message: 'Accounts with overdue balances',
        count: overdueAccounts,
        rows: rows.filter((r) => (r.overdueAmount as number) > 0),
      },
    ];

    return {
      kpis: {
        totalOutstanding,
        overdueOutstanding: totalOverdue,
        overdueAccounts,
        fullyUnpaidBillCount: fullPaidBillCount,
        unallocatedReceipts: totalUnallocatedReceipts,
        avgDaysToClear:
          clearedDays.length > 0
            ? Math.round(
                (sumBy(clearedDays, (d: number) => d) / clearedDays.length) *
                  10,
              ) / 10
            : null,
      },
      series: [],
      rows,
      anomalies,
      exportRows: rows,
    };
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
  }
}
