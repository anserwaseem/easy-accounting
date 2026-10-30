import type { DatabaseDriver } from '../driver';

/**
 * Migration 054 — Make `journal_entry_pairs` (and therefore `ledger_view`)
 * cheaper to scan.
 *
 * The previous definition computed each journal's `totalDebits` /
 * `totalCredits` with four correlated scalar subqueries per pair:
 *   (SELECT SUM(je.debitAmount) FROM journal_entry je WHERE je.journalId = j.id)
 * Because a Sale journal can have hundreds of credit legs against a single
 * debit, that took O(entries x pairs) per journal. We had the same number
 * twice (`totalDebits`, `totalCredits`) and four times as many subqueries
 * as needed. At the shop scale the view took ~800 ms per head, as reported.
 *
 * Rewrite carries the per-journal totals via a grouped join so SQLite computes
 * them exactly once per journal. The output of `journal_entry_pairs` is
 * unchanged (verified by derivedStateEquivalence.test.ts), but each view scan
 * now touches each journal's entries once instead of once per pair.
 */
export const migration054 = {
  name: '054_optimize_journal_entry_pairs',
  async up(driver: DatabaseDriver): Promise<void> {
    // Recreate in dependency order: ledger_view -> ledger_lines -> journal_entry_pairs.
    await driver.exec(`DROP VIEW IF EXISTS ledger_view`);
    await driver.exec(`DROP VIEW IF EXISTS ledger_lines`);
    await driver.exec(`DROP VIEW IF EXISTS journal_entry_pairs`);

    await driver.exec(`
      CREATE VIEW journal_entry_pairs AS
      SELECT
        j.id AS journalId,
        j.date AS date,
        j.narration AS narration,
        d.id AS debitEntryId,
        d.accountId AS debitAccountId,
        d.debitAmount AS debitAmount,
        c.id AS creditEntryId,
        c.accountId AS creditAccountId,
        c.creditAmount AS creditAmount,
        totals.totalDebits AS totalDebits,
        totals.totalCredits AS totalCredits
      FROM journal j
      JOIN journal_entry d ON d.journalId = j.id AND d.debitAmount > 0
      JOIN journal_entry c ON c.journalId = j.id AND c.creditAmount > 0
      JOIN (
        SELECT journalId AS journalId,
               SUM(debitAmount) AS totalDebits,
               SUM(creditAmount) AS totalCredits
        FROM journal_entry
        GROUP BY journalId
      ) AS totals ON totals.journalId = j.id
    `);

    await driver.exec(`
      CREATE VIEW ledger_lines AS
      SELECT
        debitAccountId AS accountId,
        date,
        creditAccountId AS linkedAccountId,
        (debitAmount * creditAmount) / totalCredits AS debit,
        0 AS credit,
        CASE WHEN narration = 'Opening Balance from B/S' THEN narration
             ELSE 'Journal #' || journalId END AS particulars,
        journalId,
        debitEntryId AS ownEntryId,
        creditEntryId AS counterEntryId
      FROM journal_entry_pairs
      UNION ALL
      SELECT
        creditAccountId AS accountId,
        date,
        debitAccountId AS linkedAccountId,
        0 AS debit,
        (creditAmount * debitAmount) / totalDebits AS credit,
        CASE WHEN narration = 'Opening Balance from B/S' THEN narration
             ELSE 'Journal #' || journalId END AS particulars,
        journalId,
        creditEntryId AS ownEntryId,
        debitEntryId AS counterEntryId
      FROM journal_entry_pairs
    `);

    await driver.exec(`
      CREATE VIEW ledger_view AS
      SELECT
        ll.accountId,
        ll.date,
        ll.particulars,
        ll.debit,
        ll.credit,
        ll.linkedAccountId,
        ll.journalId,
        ll.ownEntryId,
        ll.counterEntryId,
        ABS(SUM(
          CASE WHEN ct.type IN ('Asset', 'Expense') THEN ll.debit - ll.credit
               ELSE ll.credit - ll.debit END
        ) OVER (
          PARTITION BY ll.accountId
          ORDER BY datetime(ll.date, 'localtime'), ll.ownEntryId, ll.counterEntryId
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )) AS balance,
        CASE WHEN (
          SUM(
            CASE WHEN ct.type IN ('Asset', 'Expense') THEN ll.debit - ll.credit
                 ELSE ll.credit - ll.debit END
          ) OVER (
            PARTITION BY ll.accountId
            ORDER BY datetime(ll.date, 'localtime'), ll.ownEntryId, ll.counterEntryId
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          )
        ) >= 0
          THEN CASE WHEN ct.type IN ('Asset', 'Expense') THEN 'Dr' ELSE 'Cr' END
          ELSE CASE WHEN ct.type IN ('Asset', 'Expense') THEN 'Cr' ELSE 'Dr' END
        END AS balanceType
      FROM ledger_lines ll
      JOIN account a ON a.id = ll.accountId
      JOIN chart ct ON ct.id = a.chartId
    `);
  },
};
