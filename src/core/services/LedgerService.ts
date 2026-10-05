import { BalanceType, type Ledger } from '../../types';
import type { DatabaseDriver, RunResult } from '../db/driver';
import type { SessionContext } from '../ports';
import { logErrors } from '../errorLogger';
import { localDaySql, RECEIPT_ACCOUNTS_CTE } from '../utils/receiptAccounts';

type GetBalance = { balance: number; balanceType: BalanceType };

/**
 * docs/derived-state-design.md §6 service cutover.
 *
 * `ledger_view` (CORE 032) is now canon for every READ this service
 * serves to the rest of the app (IPC/AppApi, reports, invoice details, etc.).
 * The stored `ledger` table is demoted to a write-only legacy replica, kept
 * in sync by JournalService's existing insert/rebuild machinery so a later
 * DROP COLUMN / DROP TABLE (not shipped) has something trivial to remove.
 *
 * Two SQL sets below reflect that split:
 *  - The public, app-facing methods (`getLedger`, `getBalance`,
 *    `getBalancesForAccountIds`, `getBalancesForAccountIdsAsOfDate`,
 *    `getBalanceAtDate`, `getLedgerRange`, `getLedgerRangeForAccountIds`,
 *    `getLedgerUpToDateForAccountIds`) now query `ledger_view`.
 *  - `getStoredBalance`/`getStoredLedger` are NEW, narrower methods that
 *    keep the exact pre-cutover SQL (`FROM ledger`). They exist solely for
 *    JournalService's internal write-path machinery
 *    (`insertLedgerEntries`'s running-balance seed, `rebuildLedger`'s replay
 *    source, `removeLedgerEffectOfJournals`'s particulars-filtered replay
 *    source) — that machinery computes what gets WRITTEN into the stored
 *    `ledger` table, so it must keep reading the stored table, unchanged,
 *    or the legacy write's own output would silently start depending on
 *    ledger_view's path-independent numbers (see D1/D2 in
 *    derivedStateEquivalence.test.ts) — which is explicitly out of scope
 *    for this cutover (writes stay exactly as today; only reads move).
 *  - `deleteLedger`, `hasNewerEntries`/`checkNewerEntries` and `insertLedger`
 *    are write-path primitives (the dual-write side) and are unchanged —
 *    they still operate directly on the stored `ledger` table.
 *
 * `ledger_view` has no `ledger.id` (there is no physical row) — `ownEntryId`
 * (the originating `journal_entry.id` for this row's own side of the pair)
 * is used as a unique surrogate id instead: exactly one ledger_view row is
 * ever emitted per (journal_entry, counterparty) pairing on its "own" side,
 * so it is unique the same way `journal_entry.id` is. `createdAt`/
 * `updatedAt` have no view equivalent (they are optional on the `Ledger`
 * type and unused by any current reader — see LedgerReport's row builder).
 */
const SQL = {
  getLedger: `
      SELECT lv.ownEntryId AS id, lv.date, lv.accountId, lv.particulars, lv.debit, lv.credit, lv.balance, lv.balanceType, lv.linkedAccountId, a.name AS linkedAccountName, a.code AS linkedAccountCode
      FROM ledger_view lv
      LEFT JOIN account a ON lv.linkedAccountId = a.id
      WHERE lv.accountId = @accountId
      ORDER BY datetime(lv.date, 'localtime') ASC, lv.ownEntryId ASC, lv.counterEntryId ASC
    `,
  // Internal, write-path-only: exact pre-cutover SQL against the stored
  // table — see the class doc comment. Used only by JournalService.
  getStoredLedger: `
      SELECT l.id, l.date, l.accountId, l.particulars, l.debit, l.credit, l.balance, l.balanceType, l.linkedAccountId, a.name AS linkedAccountName, a.code AS linkedAccountCode, l.createdAt, l.updatedAt
      FROM ledger l
      LEFT JOIN account a ON l.linkedAccountId = a.id
      WHERE l.accountId = @accountId
      ORDER BY datetime(l.date, 'localtime') ASC, l.id ASC
    `,
  deleteLedgerEntries: 'DELETE FROM ledger WHERE accountId = @accountId',
  checkNewerEntries: `
      SELECT COUNT(*) as count
      FROM ledger
      WHERE accountId = @accountId
      AND date > @date
    `,
  insertLedger: `INSERT INTO ledger (date, accountId, debit, credit, balance, balanceType, particulars, linkedAccountId)
       VALUES (@date, @accountId, @debit, @credit, @balance, @balanceType, @particulars, @linkedAccountId)`,
  getBalance: `
      SELECT balance, balanceType
      FROM ledger_view
      WHERE accountId = @accountId
      ORDER BY datetime(date, 'localtime') DESC, ownEntryId DESC, counterEntryId DESC
      LIMIT 1
    `,
  // Internal, write-path-only: exact pre-cutover SQL against the stored
  // table — see the class doc comment. Used only by JournalService's
  // insertLedgerEntries to seed the running total it writes.
  getStoredBalance: `SELECT balance, balanceType
       FROM ledger
       WHERE accountId = @accountId
       ORDER BY date DESC, id DESC
       LIMIT 1`,
  getBalanceAtDate: `
      SELECT balance, balanceType, date
      FROM ledger_view
      WHERE accountId = @accountId
        AND (
          CASE
            WHEN length(date) = 10 THEN date
            ELSE date(datetime(date, 'localtime'))
          END
        ) < @date
      ORDER BY
        (
          CASE
            WHEN length(date) = 10 THEN date
            ELSE date(datetime(date, 'localtime'))
          END
        ) DESC,
        datetime(date, 'localtime') DESC,
        ownEntryId DESC,
        counterEntryId DESC
      LIMIT 1
    `,
  getLedgerRange: `
      SELECT lv.ownEntryId AS id, lv.date, lv.accountId, lv.particulars, lv.debit, lv.credit, lv.balance, lv.balanceType, lv.linkedAccountId, a.name AS linkedAccountName, a.code AS linkedAccountCode
      FROM ledger_view lv
      LEFT JOIN account a ON lv.linkedAccountId = a.id
      WHERE lv.accountId = @accountId
        AND (
          CASE
            WHEN length(lv.date) = 10 THEN lv.date
            ELSE date(datetime(lv.date, 'localtime'))
          END
        ) >= @startDate
        AND (
          CASE
            WHEN length(lv.date) = 10 THEN lv.date
            ELSE date(datetime(lv.date, 'localtime'))
          END
        ) <= @endDate
      ORDER BY datetime(lv.date, 'localtime') ASC, lv.ownEntryId ASC, lv.counterEntryId ASC
    `,
  getBalancesForAccountIds: `
      SELECT t.accountId, t.balance, t.balanceType
      FROM (
        SELECT
          lv.accountId,
          lv.balance,
          lv.balanceType,
          ROW_NUMBER() OVER (
            PARTITION BY lv.accountId
            ORDER BY lv.date DESC, lv.ownEntryId DESC, lv.counterEntryId DESC
          ) AS rn
        FROM ledger_view lv
        WHERE lv.accountId IN (
          SELECT CAST(j.value AS INTEGER)
          FROM json_each(@accountIdsJson) AS j
        )
      ) t
      WHERE t.rn = 1
    `,
  getBalancesForAccountIdsAsOfDate: `
      SELECT t.accountId, t.balance, t.balanceType
      FROM (
        SELECT
          lv.accountId,
          lv.balance,
          lv.balanceType,
          ROW_NUMBER() OVER (
            PARTITION BY lv.accountId
            ORDER BY datetime(lv.date, 'localtime') DESC, lv.ownEntryId DESC, lv.counterEntryId DESC
          ) AS rn
        FROM ledger_view lv
        WHERE lv.accountId IN (
          SELECT CAST(j.value AS INTEGER)
          FROM json_each(@accountIdsJson) AS j
        )
          AND (
            CASE
              WHEN length(lv.date) = 10 THEN lv.date
              ELSE date(datetime(lv.date, 'localtime'))
            END
          ) <= @asOfDate
      ) t
      WHERE t.rn = 1
    `,
  getCreditSumsForAccountIdsInRange: `
      SELECT
        lv.accountId AS accountId,
        COALESCE(SUM(lv.credit), 0) AS collected
      FROM ledger_view lv
      WHERE lv.accountId IN (
        SELECT CAST(j.value AS INTEGER)
        FROM json_each(@accountIdsJson) AS j
      )
        AND (
          CASE
            WHEN length(lv.date) = 10 THEN lv.date
            ELSE date(datetime(lv.date, 'localtime'))
          END
        ) >= @startDate
        AND (
          CASE
            WHEN length(lv.date) = 10 THEN lv.date
            ELSE date(datetime(lv.date, 'localtime'))
          END
        ) <= @endDate
      GROUP BY lv.accountId
    `,
  // same proration as ledger_lines (credit * debit / total debits, summed over
  // the receipt debits), computed straight from journal_entry: the views
  // re-total every journal per pair and cost seconds across a whole head.
  getTourCollectionsForAccountIds: `
      WITH tours AS (
        SELECT t.id, t.startDate, COALESCE(t.endDate, date('now', 'localtime')) AS endDate
        FROM agent_tours t
        WHERE t.id IN (SELECT CAST(j.value AS INTEGER) FROM json_each(@tourIdsJson) AS j)
      ),
      ${RECEIPT_ACCOUNTS_CTE},
      credits AS (
        SELECT c.journalId, c.accountId, c.creditAmount, ${localDaySql(
          'j.date',
        )} AS day
        FROM journal_entry c
        JOIN journal j ON j.id = c.journalId
        WHERE c.creditAmount > 0
          AND c.accountId IN (
            SELECT CAST(ids.value AS INTEGER) FROM json_each(@accountIdsJson) AS ids
          )
      ),
      debits AS (
        SELECT
          d.journalId,
          SUM(d.debitAmount) AS total,
          SUM(CASE WHEN d.accountId IN (SELECT id FROM receipt_accounts) THEN d.debitAmount ELSE 0 END) AS receipt
        FROM journal_entry d
        WHERE d.debitAmount > 0
          AND d.journalId IN (SELECT journalId FROM credits)
        GROUP BY d.journalId
      )
      SELECT
        credits.accountId AS accountId,
        tours.id AS tourId,
        SUM(credits.creditAmount * 1.0 * debits.receipt / debits.total) AS paid
      FROM credits
      JOIN debits ON debits.journalId = credits.journalId AND debits.receipt > 0
      JOIN tours ON credits.day BETWEEN tours.startDate AND tours.endDate
      GROUP BY credits.accountId, tours.id
    `,
  getLedgerRangeForAccountIds: `
      SELECT lv.ownEntryId AS id, lv.date, lv.accountId, lv.particulars, lv.debit, lv.credit, lv.balance, lv.balanceType, lv.linkedAccountId, a.name AS linkedAccountName, a.code AS linkedAccountCode
      FROM ledger_view lv
      LEFT JOIN account a ON lv.linkedAccountId = a.id
      WHERE lv.accountId IN (
        SELECT CAST(j.value AS INTEGER)
        FROM json_each(@accountIdsJson) AS j
      )
        AND (
          CASE
            WHEN length(lv.date) = 10 THEN lv.date
            ELSE date(datetime(lv.date, 'localtime'))
          END
        ) >= @startDate
        AND (
          CASE
            WHEN length(lv.date) = 10 THEN lv.date
            ELSE date(datetime(lv.date, 'localtime'))
          END
        ) <= @endDate
      ORDER BY lv.accountId ASC, datetime(lv.date, 'localtime') ASC, lv.ownEntryId ASC, lv.counterEntryId ASC
    `,
  getLedgerUpToDateForAccountIds: `
      SELECT lv.ownEntryId AS id, lv.date, lv.accountId, lv.particulars, lv.debit, lv.credit, lv.balance, lv.balanceType, lv.linkedAccountId, a.name AS linkedAccountName, a.code AS linkedAccountCode
      FROM ledger_view lv
      LEFT JOIN account a ON lv.linkedAccountId = a.id
      WHERE lv.accountId IN (
        SELECT CAST(j.value AS INTEGER)
        FROM json_each(@accountIdsJson) AS j
      )
        AND (
          CASE
            WHEN length(lv.date) = 10 THEN lv.date
            ELSE date(datetime(lv.date, 'localtime'))
          END
        ) <= @endDate
      ORDER BY lv.accountId ASC, datetime(lv.date, 'localtime') ASC, lv.ownEntryId ASC, lv.counterEntryId ASC
    `,
};

/**
 * Ledger reads/writes. Async against DatabaseDriver, session injected.
 *
 * See the module-level comment above `SQL` for the migration-028 read/write
 * split (view-canon reads vs. legacy-stored write-path helpers).
 */
@logErrors
export class LedgerService {
  private db: DatabaseDriver;

  private session: SessionContext;

  constructor(deps: { db: DatabaseDriver; session: SessionContext }) {
    this.db = deps.db;
    this.session = deps.session;
  }

  async getLedger(accountId: number): Promise<Ledger[]> {
    return this.db.all<Ledger>(SQL.getLedger, { accountId });
  }

  /**
   * Write-path-only: entries from the STORED `ledger` table, in the same
   * order/shape `getLedger` used to return before this cutover. Used by
   * JournalService.rebuildLedger/removeLedgerEffectOfJournals to replay the
   * legacy table, which must keep being computed exactly as it is today.
   */
  async getStoredLedger(accountId: number): Promise<Ledger[]> {
    return this.db.all<Ledger>(SQL.getStoredLedger, { accountId });
  }

  async deleteLedger(accountId: number): Promise<RunResult> {
    return this.db.run(SQL.deleteLedgerEntries, { accountId });
  }

  async hasNewerEntries(accountId: number, date: string): Promise<boolean> {
    const hasNewerEntries = await this.db.get<{ count: number }>(
      SQL.checkNewerEntries,
      { accountId, date },
    );
    return (hasNewerEntries?.count ?? 0) > 0;
  }

  async getBalance(accountId: number): Promise<GetBalance | undefined> {
    return this.db.get<GetBalance>(SQL.getBalance, { accountId });
  }

  /**
   * Write-path-only: latest balance from the STORED `ledger` table. Used by
   * JournalService.insertLedgerEntries to seed the running total it writes —
   * must stay reading the stored table so the legacy write's own output is
   * unaffected by this cutover (see the class doc comment).
   */
  async getStoredBalance(accountId: number): Promise<GetBalance | undefined> {
    return this.db.get<GetBalance>(SQL.getStoredBalance, { accountId });
  }

  /** latest balance per account in one round-trip (invoice details related ledgers). */
  async getBalancesForAccountIds(
    accountIds: number[],
  ): Promise<Record<number, GetBalance>> {
    const unique = [
      ...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0)),
    ];
    if (unique.length === 0) return {};
    const rows = await this.db.all<{
      accountId: number;
      balance: number;
      balanceType: BalanceType;
    }>(SQL.getBalancesForAccountIds, {
      accountIdsJson: JSON.stringify(unique),
    });
    return LedgerService.balanceRowsToMap(rows);
  }

  /**
   * running balance as of inclusive calendar day (yyyy-MM-dd), one query.
   * matches last ledger row that falls on or before that day (same ordering as getLedger).
   */
  async getBalancesForAccountIdsAsOfDate(
    accountIds: number[],
    asOfDate: string,
  ): Promise<Record<number, GetBalance>> {
    const unique = [
      ...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0)),
    ];
    if (unique.length === 0) return {};
    const rows = await this.db.all<{
      accountId: number;
      balance: number;
      balanceType: BalanceType;
    }>(SQL.getBalancesForAccountIdsAsOfDate, {
      accountIdsJson: JSON.stringify(unique),
      asOfDate,
    });
    return LedgerService.balanceRowsToMap(rows);
  }

  /**
   * sum of credits per account for an inclusive local-date range (yyyy-MM-dd).
   * credits on a party ledger are collections. debits (sales) are ignored.
   * accounts with no credits in the window are omitted.
   */
  async getCreditSumsForAccountIdsInRange(
    accountIds: number[],
    startDate: string,
    endDate: string,
  ): Promise<Record<number, number>> {
    const unique = LedgerService.uniqueSortedAccountIds(accountIds);
    if (unique.length === 0) return {};
    const rows = await this.db.all<{ accountId: number; collected: number }>(
      SQL.getCreditSumsForAccountIdsInRange,
      {
        accountIdsJson: JSON.stringify(unique),
        startDate,
        endDate,
      },
    );
    const out: Record<number, number> = {};
    for (const row of rows) {
      out[row.accountId] = row.collected ?? 0;
    }
    return out;
  }

  /**
   * per account, per tour: credits paired with a receipt account whose local
   * day falls in the tour (a running tour ends today). other credits —
   * discounts, sale reversals, balance transfers — are not collections.
   * pairs with nothing collected are omitted.
   */
  async getTourCollectionsForAccountIds(
    accountIds: number[],
    tourIds: number[],
  ): Promise<Record<number, Record<number, number>>> {
    const unique = LedgerService.uniqueSortedAccountIds(accountIds);
    const tours = LedgerService.uniqueSortedAccountIds(tourIds);
    if (unique.length === 0 || tours.length === 0) return {};
    const rows = await this.db.all<{
      accountId: number;
      tourId: number;
      paid: number;
    }>(SQL.getTourCollectionsForAccountIds, {
      accountIdsJson: JSON.stringify(unique),
      tourIdsJson: JSON.stringify(tours),
    });
    const out: Record<number, Record<number, number>> = {};
    for (const row of rows) {
      out[row.accountId] = {
        ...out[row.accountId],
        [row.tourId]: row.paid ?? 0,
      };
    }
    return out;
  }

  /** get the running balance as of a given date (last ledger entry on or before that date). */
  async getBalanceAtDate(
    accountId: number,
    date: string,
  ): Promise<{ balance: number; balanceType: string; date: string } | null> {
    const row = await this.db.get<{
      balance: number;
      balanceType: string;
      date: string;
    }>(SQL.getBalanceAtDate, { accountId, date });
    return row ?? null;
  }

  /** get ledger entries within a date range (inclusive). */
  async getLedgerRange(
    accountId: number,
    startDate: string,
    endDate: string,
  ): Promise<Ledger[]> {
    return this.db.all<Ledger>(SQL.getLedgerRange, {
      accountId,
      startDate,
      endDate,
    });
  }

  /** inclusive calendar range, multiple accounts, rows ordered per account like getLedgerRange. */
  async getLedgerRangeForAccountIds(
    accountIds: number[],
    startDate: string,
    endDate: string,
  ): Promise<Record<number, Ledger[]>> {
    const unique = LedgerService.uniqueSortedAccountIds(accountIds);
    if (unique.length === 0) return {};
    const rows = await this.db.all<Ledger>(SQL.getLedgerRangeForAccountIds, {
      accountIdsJson: JSON.stringify(unique),
      startDate,
      endDate,
    });
    return LedgerService.ledgerRowsToAccountMap(rows, unique);
  }

  /** all ledger rows on or before endDate (yyyy-MM-dd), ascending per account. */
  async getLedgersUpToDateForAccountIds(
    accountIds: number[],
    endDate: string,
  ): Promise<Record<number, Ledger[]>> {
    const unique = LedgerService.uniqueSortedAccountIds(accountIds);
    if (unique.length === 0) return {};
    const rows = await this.db.all<Ledger>(SQL.getLedgerUpToDateForAccountIds, {
      accountIdsJson: JSON.stringify(unique),
      endDate,
    });
    return LedgerService.ledgerRowsToAccountMap(rows, unique);
  }

  async insertLedger(ledger: Omit<Ledger, 'id'>): Promise<RunResult> {
    return this.db.run(SQL.insertLedger, {
      date: ledger.date,
      accountId: ledger.accountId,
      debit: ledger.debit,
      credit: ledger.credit,
      balance: ledger.balance,
      balanceType: ledger.balanceType,
      particulars: ledger.particulars,
      linkedAccountId: ledger.linkedAccountId,
    });
  }

  private static balanceRowsToMap(
    rows: Array<{
      accountId: number;
      balance: number;
      balanceType: BalanceType;
    }>,
  ): Record<number, GetBalance> {
    const out: Record<number, GetBalance> = {};
    for (const row of rows) {
      out[row.accountId] = {
        balance: row.balance,
        balanceType: row.balanceType,
      };
    }
    return out;
  }

  private static uniqueSortedAccountIds(accountIds: number[]): number[] {
    return [
      ...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0)),
    ].sort((a, b) => a - b);
  }

  private static ledgerRowsToAccountMap(
    rows: Ledger[],
    orderedIds: number[],
  ): Record<number, Ledger[]> {
    const out: Record<number, Ledger[]> = {};
    for (const id of orderedIds) {
      out[id] = [];
    }
    for (const row of rows) {
      const bucket = out[row.accountId];
      if (bucket) {
        bucket.push(row);
      }
    }
    return out;
  }
}
