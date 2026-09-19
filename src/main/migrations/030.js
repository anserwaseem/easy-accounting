// Prerequisite for docs/derived-state-design.md §4's ledger_view: makes every
// `ledger` row a projection of `journal`/`journal_entry` (§2 of that doc). The
// one exception today is StatementService's "Opening Balance from B/S" rows,
// written straight to `ledger` with no backing journal at all — see
// StatementService.ts:setupLedgers. This migration backfills a `journal` +
// two `journal_entry` rows for every such ledger row that predates the
// write-path fix (StatementService now writes both going forward — see the
// comment block above `setupLedgers`).
//
// The balancing ("contra") side goes to a system "Opening Balance Equity"
// account under an "Equity" chart, found-or-created here with plain SQL that
// mirrors ChartService.findOrCreateChart / AccountService.insertAccountIfNotExists
// (StatementService.ts:100-137) closely enough for the same row to be found
// idempotently, without pulling those services into a migration file that
// only ever gets a bare `db` handle.
//
// NAME-LINKED, NOT DELEGATED, to src/core/db/openingBalanceBackfill.ts's
// `backfillOpeningBalanceJournals`: that file is an async, DatabaseDriver
// port of this same logic, used by src/core/db/import.ts's "bring your
// database" importer (a pre-025 desktop upload gets replayed into a
// destination whose `migrations` bookkeeping already claims 001-027 are
// applied — via the frozen schema snapshot — so nothing here ever re-runs
// against the newly-imported data; see that file's own doc comment for the
// full story). This file is left untouched rather than refactored to
// delegate there: src/core/db/migrations/index.ts documents that every file
// in this directory is "frozen forever into the schema snapshot — they will
// never run again", and this file's synchronous `db.transaction()` call
// against a raw better-sqlite3 handle has no trivially-safe way to call into
// an async, driver-based module without changing its (frozen, tested)
// shape. Keep the two in sync BY HAND: same constants (PARTICULARS /
// EQUITY_CHART_NAME / EQUITY_ACCOUNT_NAME), same idempotency guard, same
// find-or-create SQL shape.
module.exports = {
  name: '025_migrate_opening_balance_ledger_to_journal',
  up: (db) => {
    try {
      const PARTICULARS = 'Opening Balance from B/S';
      const EQUITY_CHART_NAME = 'Equity';
      const EQUITY_ACCOUNT_NAME = 'Opening Balance Equity';

      db.transaction(() => {
        // Idempotency: skip the whole migration if it has already run.
        //
        // A per-ledger-row match (narration + date + accountId + amounts)
        // was considered instead, but rejected: `StatementService.setupLedgers`
        // had no de-dup guard of its own before this fix, so a DB that had the
        // same balance sheet imported twice can legitimately contain two
        // identical ledger rows (same account/date/debit/credit). A
        // value-based match cannot tell those two rows apart and would treat
        // the second as "already backed" after the first is processed,
        // silently dropping its journal. A single before/after guard has no
        // such failure mode, and it is sufficient here because the entire
        // backfill below runs inside one `db.transaction`: the runner commits
        // it in full or not at all (src/main/migrations/index.ts's
        // `MigrationRunner` also never re-invokes a migration that already
        // recorded a `migrations` row), so "any row exists" and "every row
        // was written by this migration's one successful run" are the same
        // fact. A second `up()` call — the only realistic way to observe a
        // partial state — is therefore always either "never ran" (nothing
        // matches, proceed) or "fully ran" (everything matches, skip).
        const alreadyMigrated = db
          .prepare(`SELECT 1 FROM journal WHERE narration = ? LIMIT 1`)
          .get(PARTICULARS);
        if (alreadyMigrated) {
          return;
        }

        const ledgerRows = db
          .prepare(
            `
              SELECT l.id AS ledgerId, l.date AS date, l.accountId AS accountId,
                     l.debit AS debit, l.credit AS credit, c.userId AS userId
              FROM ledger l
              JOIN account a ON a.id = l.accountId
              JOIN chart c ON c.id = a.chartId
              WHERE l.particulars = ?
              ORDER BY l.id ASC
            `,
          )
          .all(PARTICULARS);

        if (ledgerRows.length === 0) {
          return;
        }

        const findEquityChart = db.prepare(`
          SELECT id FROM chart
          WHERE name = ? AND type = 'Equity' AND ifnull(userId, -1) = ifnull(?, -1)
        `);
        const insertChart = db.prepare(`
          INSERT INTO chart (date, name, type, userId) VALUES (?, ?, 'Equity', ?)
        `);
        const findEquityAccount = db.prepare(`
          SELECT a.id FROM account a
          JOIN chart c ON c.id = a.chartId
          WHERE a.name = ? AND ifnull(c.userId, -1) = ifnull(?, -1)
        `);
        const insertAccount = db.prepare(`
          INSERT INTO account (chartId, name, code, isActive) VALUES (?, ?, NULL, 1)
        `);
        const insertJournal = db.prepare(`
          INSERT INTO journal (date, narration, isPosted, invoiceId) VALUES (?, ?, 1, NULL)
        `);
        const insertJournalEntry = db.prepare(`
          INSERT INTO journal_entry (journalId, debitAmount, accountId, creditAmount)
          VALUES (?, ?, ?, ?)
        `);

        // One "Opening Balance Equity" account per userId (chart.userId is
        // nullable in schema.sql, hence the ifnull(...,-1) match above), found
        // or created once per user and reused for every ledger row of theirs.
        const equityAccountIdByUser = new Map();

        const getEquityAccountId = (userId, date) => {
          const key = userId === null || userId === undefined ? 'null' : userId;
          if (equityAccountIdByUser.has(key)) {
            return equityAccountIdByUser.get(key);
          }

          const existingChart = findEquityChart.get(EQUITY_CHART_NAME, userId);
          const chartId = existingChart
            ? existingChart.id
            : Number(
                insertChart.run(date, EQUITY_CHART_NAME, userId)
                  .lastInsertRowid,
              );

          const existingAccount = findEquityAccount.get(
            EQUITY_ACCOUNT_NAME,
            userId,
          );
          const accountId = existingAccount
            ? existingAccount.id
            : Number(
                insertAccount.run(chartId, EQUITY_ACCOUNT_NAME).lastInsertRowid,
              );

          equityAccountIdByUser.set(key, accountId);
          return accountId;
        };

        ledgerRows.forEach((row) => {
          const equityAccountId = getEquityAccountId(row.userId, row.date);

          const journalId = Number(
            insertJournal.run(row.date, PARTICULARS).lastInsertRowid,
          );

          // the account's own side, exactly as stored on the ledger row
          insertJournalEntry.run(
            journalId,
            row.debit,
            row.accountId,
            row.credit,
          );
          // the balancing side, against the system equity account
          insertJournalEntry.run(
            journalId,
            row.credit,
            equityAccountId,
            row.debit,
          );
        });

        // ledger rows themselves are left completely untouched — this
        // migration only adds the missing journal/journal_entry facts.
      })();

      return true;
    } catch (error) {
      console.log('025 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('025 migration completed!');
    }
  },
};
