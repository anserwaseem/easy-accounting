import type { DatabaseDriver } from './driver';

/**
 * Synthesize `journal` + `journal_entry` for pre-cutover
 * "Opening Balance from B/S" ledger rows.
 *
 * CORE `030_migrate_opening_balance_ledger_to_journal` calls this.
 * origin/main `025.js` is `025_vendor_stock` — different `name`, unrelated.
 *
 * Import must call this again after copying uploaded rows: destination
 * `migrations` already records the CORE 030 name from bootstrap (ran
 * against an empty DB), so the runner will not re-apply it to imported
 * data. Unbacked opening-balance ledger rows would otherwise vanish from
 * `ledger_view` (see docs/derived-state-design.md).
 */

/** Particulars literal StatementService writes and this backfill matches. */
export const OPENING_BALANCE_PARTICULARS = 'Opening Balance from B/S';
/** System chart name used by StatementService.ensureOpeningBalanceEquityAccountId. */
export const OPENING_BALANCE_EQUITY_CHART_NAME = 'Equity';
/** System account name used by StatementService.ensureOpeningBalanceEquityAccountId. */
export const OPENING_BALANCE_EQUITY_ACCOUNT_NAME = 'Opening Balance Equity';

export interface OpeningBalanceBackfillResult {
  /**
   * True when the idempotency guard (a `journal` row with narration
   * {@link OPENING_BALANCE_PARTICULARS} already exists) found the backfill
   * had already run. The whole backfill is one transaction, so "any row
   * exists" and "every row was written by this run" are the same fact.
   * `rowsBackfilled` is always 0 in this case.
   */
  alreadyBackfilled: boolean;
  /**
   * Number of `ledger` rows a `journal` + two `journal_entry` rows were just
   * synthesized for. 0 if `alreadyBackfilled`, or if no
   * `particulars = 'Opening Balance from B/S'` ledger rows were found at
   * all (nothing to backfill — a normal outcome for a database that never
   * had a balance-sheet import, not a failure).
   */
  rowsBackfilled: number;
}

interface OpeningBalanceLedgerRow {
  ledgerId: number;
  date: string;
  accountId: number;
  debit: number;
  credit: number;
  userId: number | null;
}

/**
 * Backfills a `journal` row (`narration = 'Opening Balance from B/S'`, same
 * `date`, `isPosted = 1`) plus two `journal_entry` rows (the account's own
 * side as stored on the `ledger` row, and the balancing side against a
 * find-or-created "Opening Balance Equity" account under a find-or-created
 * "Equity" chart) for every `ledger` row with
 * `particulars = 'Opening Balance from B/S'` that has no backing journal
 * yet.
 *
 * Runs inside its own `driver.transaction(...)` — nested (via a SAVEPOINT)
 * when called from inside an already-open transaction, such as
 * `importDatabase`'s copy transaction, so the caller's atomicity guarantee
 * (all-or-nothing) extends to this backfill without any special-casing on
 * either side; see `DatabaseDriver.transaction`'s doc comment and
 * `BetterSqliteDriver`/`SqliteWasmDriver`'s matching nested-savepoint
 * implementations.
 *
 * Existing `ledger` rows are left untouched — this only adds the missing
 * `journal`/`journal_entry` facts.
 *
 * Does not touch every "Opening Balance from B/S" ledger row
 * unconditionally — it joins through `account`/`chart` to resolve each
 * row's `userId` (needed to find-or-create the right per-user Equity
 * account), so a ledger row whose `accountId` is NULL or references a
 * deleted account is silently skipped by that INNER JOIN. See
 * `checkImportIntegrity` in `import.ts` for how a caller should account
 * for this in its own row-count reconciliation.
 */
export async function backfillOpeningBalanceJournals(
  driver: DatabaseDriver,
): Promise<OpeningBalanceBackfillResult> {
  return driver.transaction(async () => {
    const alreadyMigrated = await driver.get(
      `SELECT 1 FROM journal WHERE narration = ? LIMIT 1`,
      [OPENING_BALANCE_PARTICULARS],
    );
    if (alreadyMigrated) {
      return { alreadyBackfilled: true, rowsBackfilled: 0 };
    }

    const ledgerRows = await driver.all<OpeningBalanceLedgerRow>(
      `
        SELECT l.id AS ledgerId, l.date AS date, l.accountId AS accountId,
               l.debit AS debit, l.credit AS credit, c.userId AS userId
        FROM ledger l
        JOIN account a ON a.id = l.accountId
        JOIN chart c ON c.id = a.chartId
        WHERE l.particulars = ?
        ORDER BY l.id ASC
      `,
      [OPENING_BALANCE_PARTICULARS],
    );

    if (ledgerRows.length === 0) {
      return { alreadyBackfilled: false, rowsBackfilled: 0 };
    }

    // One "Opening Balance Equity" account per userId (chart.userId is
    // nullable, hence the ifnull(...,-1) matches below), found or created
    // once per user and reused for every ledger row of theirs.
    const equityAccountIdByUser = new Map<string, number>();

    const getEquityAccountId = async (
      userId: number | null,
      date: string,
    ): Promise<number> => {
      const key =
        userId === null || userId === undefined ? 'null' : String(userId);
      const cached = equityAccountIdByUser.get(key);
      if (cached !== undefined) return cached;

      const existingChart = await driver.get<{ id: number }>(
        `SELECT id FROM chart
         WHERE name = ? AND type = 'Equity' AND ifnull(userId, -1) = ifnull(?, -1)`,
        [OPENING_BALANCE_EQUITY_CHART_NAME, userId],
      );
      let chartId: number;
      if (existingChart) {
        chartId = existingChart.id;
      } else {
        const inserted = await driver.run(
          `INSERT INTO chart (date, name, type, userId) VALUES (?, ?, 'Equity', ?)`,
          [date, OPENING_BALANCE_EQUITY_CHART_NAME, userId],
        );
        chartId = Number(inserted.lastInsertRowid);
      }

      const existingAccount = await driver.get<{ id: number }>(
        `SELECT a.id FROM account a
         JOIN chart c ON c.id = a.chartId
         WHERE a.name = ? AND ifnull(c.userId, -1) = ifnull(?, -1)`,
        [OPENING_BALANCE_EQUITY_ACCOUNT_NAME, userId],
      );
      let accountId: number;
      if (existingAccount) {
        accountId = existingAccount.id;
      } else {
        const inserted = await driver.run(
          `INSERT INTO account (chartId, name, code, isActive) VALUES (?, ?, NULL, 1)`,
          [chartId, OPENING_BALANCE_EQUITY_ACCOUNT_NAME],
        );
        accountId = Number(inserted.lastInsertRowid);
      }

      equityAccountIdByUser.set(key, accountId);
      return accountId;
    };

    for (const row of ledgerRows) {
      // eslint-disable-next-line no-await-in-loop
      const equityAccountId = await getEquityAccountId(row.userId, row.date);

      // eslint-disable-next-line no-await-in-loop
      const journalResult = await driver.run(
        `INSERT INTO journal (date, narration, isPosted, invoiceId) VALUES (?, ?, 1, NULL)`,
        [row.date, OPENING_BALANCE_PARTICULARS],
      );
      const journalId = Number(journalResult.lastInsertRowid);

      // the account's own side, exactly as stored on the ledger row
      // eslint-disable-next-line no-await-in-loop
      await driver.run(
        `INSERT INTO journal_entry (journalId, debitAmount, accountId, creditAmount)
         VALUES (?, ?, ?, ?)`,
        [journalId, row.debit, row.accountId, row.credit],
      );
      // the balancing side, against the system equity account
      // eslint-disable-next-line no-await-in-loop
      await driver.run(
        `INSERT INTO journal_entry (journalId, debitAmount, accountId, creditAmount)
         VALUES (?, ?, ?, ?)`,
        [journalId, row.credit, equityAccountId, row.debit],
      );
    }

    return { alreadyBackfilled: false, rowsBackfilled: ledgerRows.length };
  });
}
