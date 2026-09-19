import type { DatabaseDriver } from './driver';

/**
 * Platform-free port of `src/main/migrations/025.js`
 * (`025_migrate_opening_balance_ledger_to_journal`), against
 * {@link DatabaseDriver} instead of a raw better-sqlite3 handle.
 *
 * Why this exists as a *second* implementation instead of 025.js delegating
 * here: `src/core/db/migrations/index.ts`'s doc comment is explicit that the
 * 27 historical `src/main/migrations/*.js` files "are frozen forever into
 * the schema snapshot — they will never run again and nothing new is ever
 * added there" (they only apply to a pre-existing desktop install's own
 * `MigrationRunner`, which is synchronous, better-sqlite3-only code that
 * never sees a `DatabaseDriver`). Making 025.js call into this async,
 * driver-based module would mean bridging its synchronous `db.transaction()`
 * call across an async boundary for a file that is never touched again in
 * practice — not "trivially safe". The two are instead kept **name-linked**:
 * same constants, same SQL shape, same idempotency guard, same find-or-create
 * semantics — verify any future change to one against the other by diffing
 * this file's `up`-equivalent against 025.js's `db.transaction(() => {...})`
 * body line for line.
 *
 * ## Why the web/import path needs its own copy of this logic at all
 *
 * `src/core/db/import.ts`'s `importDatabase` writes into a destination that
 * was bootstrapped via `src/core/db/bootstrap.ts` from the frozen schema
 * snapshot (`schema.snapshot.sql`) — which pre-seeds the `migrations`
 * bookkeeping table with rows for 001-027 (see that snapshot file's own doc
 * comment: "so that if the desktop MigrationRunner ever opens a database
 * bootstrapped from this snapshot, it treats 001-027 as already applied").
 * That is correct for a *freshly bootstrapped* database, which never had
 * pre-025 "Opening Balance from B/S" ledger rows to backfill in the first
 * place. It is WRONG the moment `importDatabase` then overwrites that
 * database's business tables with the contents of an uploaded desktop file
 * that predates migration 025: the destination's `migrations` table still
 * says "025 already ran" (it did — against the empty destination, backfilling
 * nothing), so nothing ever re-triggers the backfill against the newly
 * imported data. The uploaded database's own pre-025 "Opening Balance from
 * B/S" ledger rows land with no backing `journal`/`journal_entry` rows at
 * all, and since every app-facing read (migration 028's cutover — see
 * `docs/derived-state-design.md` §6/§7) comes from `ledger_view`, which is a
 * pure projection of `journal`/`journal_entry` and never reads `ledger`
 * directly, those opening-balance entries silently vanish from displayed
 * ledgers, account balances, and the trial balance. `importDatabase` calls
 * {@link backfillOpeningBalanceJournals} explicitly, on the freshly-copied
 * data, precisely because the destination's own migration bookkeeping cannot
 * be trusted to reflect what the *uploaded* data actually needed.
 */

/** Same literal 025.js backfills against, and StatementService.ts writes going forward. */
export const OPENING_BALANCE_PARTICULARS = 'Opening Balance from B/S';
/** Same system chart name 025.js and StatementService.ts's `ensureOpeningBalanceEquityAccountId` use. */
export const OPENING_BALANCE_EQUITY_CHART_NAME = 'Equity';
/** Same system account name 025.js and StatementService.ts's `ensureOpeningBalanceEquityAccountId` use. */
export const OPENING_BALANCE_EQUITY_ACCOUNT_NAME = 'Opening Balance Equity';

export interface OpeningBalanceBackfillResult {
  /**
   * True when the idempotency guard (a `journal` row with narration
   * {@link OPENING_BALANCE_PARTICULARS} already exists) found the backfill
   * had already run — same guard, same reasoning, as 025.js's own comment
   * block: "any row exists" and "every row was written by this migration's
   * one successful run" are the same fact because the whole backfill runs
   * inside one transaction. `rowsBackfilled` is always 0 in this case.
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
 * yet. Mirrors `025.js` exactly — see that file and this module's own doc
 * comment above for the full rationale.
 *
 * Runs inside its own `driver.transaction(...)` — nested (via a SAVEPOINT)
 * when called from inside an already-open transaction, such as
 * `importDatabase`'s copy transaction, so the caller's atomicity guarantee
 * (all-or-nothing) extends to this backfill without any special-casing on
 * either side; see `DatabaseDriver.transaction`'s doc comment and
 * `BetterSqliteDriver`/`SqliteWasmDriver`'s matching nested-savepoint
 * implementations.
 *
 * Existing `ledger` rows are left completely untouched — same as 025.js,
 * this only adds the missing `journal`/`journal_entry` facts.
 *
 * Does NOT touch every "Opening Balance from B/S" ledger row unconditionally
 * — like 025.js, it joins through `account`/`chart` to resolve each row's
 * `userId` (needed to find-or-create the right per-user Equity account), so
 * a ledger row whose `accountId` is NULL or references a deleted account
 * (schema allows `ledger.accountId` to be nullable/dangling) is silently
 * skipped by that INNER JOIN, same as it would have been by 025.js had it
 * run against this data originally. See `checkImportIntegrity` in
 * `import.ts` for how a caller should account for this in its own row-count
 * reconciliation.
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
    // once per user and reused for every ledger row of theirs — same
    // caching as 025.js's `equityAccountIdByUser`.
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
