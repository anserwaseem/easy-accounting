// docs/derived-state-design.md §6 migration 027 — creates the SQL views that
// let the equivalence harness (§7,
// src/core/services/__tests__/derivedStateEquivalence.test.ts) prove
// `ledger_view`/`inventory_quantity_view` reproduce the stored `ledger` table
// and `inventory.quantity` column before any service code is cut over to
// reading them (§6 migration 028, not part of this change). Purely additive:
// four `CREATE VIEW IF NOT EXISTS` statements, no table/column writes, no
// service behavior change. `ledger` and `inventory.quantity` remain the
// source of truth for every service at this point.
//
// The doc's §4.1/§5 SQL is an explicitly-flagged sketch ("must be checked
// line-by-line... not a copy-paste"). This is the rewritten version, checked
// against the real code (JournalService.insertLedgerEntries/
// rebuildLedgerFromEntries, InventoryService's stockAsOf*DeltaAfter) and
// against the equivalence harness's findings. See the comment blocks below
// each view for the specific deviations from the sketch and why.
module.exports = {
  name: '027_create_ledger_and_inventory_quantity_views',
  up: (db) => {
    try {
      db.transaction(() => {
        // ---------------------------------------------------------------
        // journal_entry_pairs — one row per (debit-side entry, credit-side
        // entry) pair within a journal, reconstructed from journal_entry
        // alone. `insertJournal` (JournalService.ts:244-246) rejects any
        // journal with more than one entry on *both* sides simultaneously,
        // so this cross join is 1:1, 1:N or N:1 — never N×M.
        //
        // Both `totalDebits` and `totalCredits` are carried through (not
        // just one, as the doc's sketch did) because
        // `insertLedgerEntries` (JournalService.ts:436-515) does NOT reuse
        // one proportional amount for both sides of a pair: the debit-side
        // ledger row's amount divides by `totalCredits`
        // (JournalService.ts:450-451) and the credit-side row's amount
        // divides by `totalDebits` (JournalService.ts:484-485). These are
        // only guaranteed equal when the journal is balanced (debits ==
        // credits) — usually true (enforced client-side, not at the DB
        // layer) but not something this view should assume away, since an
        // unbalanced legacy journal would silently produce the wrong
        // number on one side if we reused a single "amount" column as the
        // doc's sketch did.
        db.prepare(
          `
            CREATE VIEW IF NOT EXISTS journal_entry_pairs AS
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
              (SELECT SUM(je.debitAmount) FROM journal_entry je WHERE je.journalId = j.id) AS totalDebits,
              (SELECT SUM(je.creditAmount) FROM journal_entry je WHERE je.journalId = j.id) AS totalCredits
            FROM journal j
            JOIN journal_entry d ON d.journalId = j.id AND d.debitAmount > 0
            JOIN journal_entry c ON c.journalId = j.id AND c.creditAmount > 0
          `,
        ).run();

        // ---------------------------------------------------------------
        // ledger_lines — one row per (account, counterparty) side of each
        // pair, matching the two ledger rows `insertLedgerEntries` writes
        // per pair (one on the debit account, one on the credit account).
        //
        // `ownEntryId`/`counterEntryId` are the ordering tiebreak columns
        // (see ledger_view below) — NOT surfaced as part of the "public"
        // row shape, but needed by any ORDER BY that must reproduce the
        // stored ledger's row-for-row sequence. The doc's sketch used a
        // single `orderTiebreak = <own entry id>` column; that is
        // insufficient on its own; see ledger_view's comment for why.
        //
        // particulars: 'Journal #<id>' for ordinary journal-sourced rows
        // (JournalService.ts:476, 510) — EXCEPT rows backing a
        // StatementService opening-balance import
        // (StatementService.ts, narration = 'Opening Balance from B/S'),
        // which migration 025 backfilled from `ledger.particulars` verbatim
        // and which StatementService.setupLedgers still writes directly to
        // `ledger` (not through JournalService) going forward. Generalizing
        // no further than this one narration value is a deliberate,
        // narrow decision — see
        // derivedStateEquivalence.test.ts's comment on the Opening Balance
        // Equity exclusion for the rest of that story (linkedAccountId and,
        // in one documented adversarial case, balance/balanceType do NOT
        // match for that write path — this CASE only fixes particulars).
        db.prepare(
          `
            CREATE VIEW IF NOT EXISTS ledger_lines AS
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
          `,
        ).run();

        // ---------------------------------------------------------------
        // ledger_view — running balance per account, matching
        // JournalService.rebuildLedgerFromEntries's switch
        // (JournalService.ts:337-351) exactly: Asset/Expense accumulate
        // debit-credit and label >=0 as Dr; Liability/Equity/Revenue
        // accumulate credit-debit and label >=0 as Cr; both store
        // Math.abs(...) as `balance`.
        //
        // Ordering: `datetime(date,'localtime')` matches
        // LedgerService.getLedger's ORDER BY (LedgerService.ts:17) exactly.
        // The intra-date tiebreak is (ownEntryId, counterEntryId), not just
        // `ownEntryId` alone as the design doc's §4.1 sketch had it. Why
        // both are needed: `insertLedgerEntries`'s outer loop iterates
        // `entries` in journal_entry.id order and, for whichever side has
        // exactly one entry, emits multiple ledger rows against MANY
        // counterparties from that ONE entry (a 1:N or N:1 split) — those
        // rows all share the same "own" journal_entry id and differ only by
        // counterparty, so `ownEntryId` alone ties. Sorting by
        // `(ownEntryId, counterEntryId)` reproduces the exact row sequence
        // `insertLedgerEntries` produces, given the invariant (true of every
        // real caller and every fixture in this codebase — InvoiceService
        // and every hand-built journal in *.test.ts put debit entries
        // before credit entries in the `journalEntries` array) that debit
        // entries are inserted, and so get lower `journal_entry.id`s, before
        // credit entries within the same journal. See
        // derivedStateEquivalence.test.ts for the row-by-row proof this
        // reproduces `insertLedgerEntries`'s actual emission order for 1:1,
        // 1:N and N:1 splits.
        //
        // KNOWN GAP (documented, not papered over — see
        // derivedStateEquivalence.test.ts's dedicated `it.failing`):
        // `insertLedgerEntries`'s incremental state machine has HYSTERESIS
        // at an exact zero balance — the stored balanceType at balance=0
        // depends on which side (Dr or Cr) the account was coming FROM, not
        // just the final signed total. This view, like
        // rebuildLedgerFromEntries itself, is a pure function of the
        // ordered sequence and has no such memory: at balance=0 it always
        // labels Asset/Expense as Dr and Liability/Equity/Revenue as Cr,
        // regardless of path. The two real code paths already disagree with
        // EACH OTHER at this exact boundary (rebuildLedgerFromEntries wipes
        // and reinserts an account's whole ledger with the path-independent
        // rule the moment any back-dated journal touches that account), so
        // this view's choice (matching rebuildLedgerFromEntries, per this
        // task's spec) matches the stored ledger for every account that has
        // ever been rebuilt, and for every account that has never had an
        // entry land on an exact zero balance — which in practice, for real
        // currency amounts, is effectively everything except a
        // deliberately-constructed adversarial case.
        db.prepare(
          `
            CREATE VIEW IF NOT EXISTS ledger_view AS
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
          `,
        ).run();

        // ---------------------------------------------------------------
        // inventory_quantity_view — forward SUM from
        // inventory_opening_stock, lifted from the already-trusted
        // stockAsOfInvoiceDeltaAfter/stockAsOfAdjustmentDeltaAfter
        // (InventoryService.ts:342-383), with the "after date X" filters
        // dropped (unconditional = every movement, not just ones after a
        // cutoff) and the returned-invoice two-term expressions collapsed
        // to their algebraic result: a returned sale's original decrement
        // and its return reversal always net to 0 over all time (same for
        // a returned purchase), since invoice_items rows are never deleted
        // on return (only edit deletes+reinserts them) — see
        // InvoiceService.ts's voidInvoiceReturnWithoutTransaction, which
        // reverses `inventory.quantity` via a relative update but leaves
        // `invoice_items` untouched.
        //
        // A converted quotation (isQuotation flips 0 at
        // convertQuotationInvoiceWithoutTransaction, InvoiceService.ts:
        // 1217-1232) is read here at its CURRENT isQuotation value, which
        // is correct: quantity was only actually touched at conversion
        // time (applyPersistedSaleInventoryDecrements/
        // applyPersistedPurchaseInventoryIncrements), matching this view
        // picking it up as a normal Sale/Purchase line the moment
        // isQuotation reads 0.
        //
        // KNOWN GAP (documented, not papered over — see
        // derivedStateEquivalence.test.ts's dedicated `it.failing`):
        // `setOpeningStock` (InventoryService.ts:691-767) writes
        // `inventory.quantity` via `setInventoryQuantity` — an ABSOLUTE
        // overwrite (`UPDATE inventory SET quantity = ?`), not a value
        // relative to `asOfDate` or to any prior movement. When opening
        // stock is set for an item that ALREADY has invoice/adjustment
        // history, that overwrite silently discards the prior movements'
        // contribution to the live counter; this view has no way to
        // recover "which movements predate the overwrite" from the schema
        // (no column orders invoice_items/stock_adjustments rows relative
        // to when a given setOpeningStock call happened), so it always
        // treats `inventory_opening_stock.quantity` as a baseline that ALL
        // recorded movements stack on top of. This matches the stored
        // counter exactly when opening stock is set before any movement
        // exists for that item (the common "Getting Started" case), and
        // provably diverges when opening stock is (re)set after movements
        // already exist — see the failing test for the exact numbers.
        db.prepare(
          `
            CREATE VIEW IF NOT EXISTS inventory_quantity_view AS
            SELECT
              i.id AS inventoryId,
              COALESCE(os.quantity, 0)
              + COALESCE((
                  SELECT SUM(
                    CASE
                      WHEN COALESCE(inv.isQuotation, 0) != 0 THEN 0
                      WHEN inv.invoiceType = 'Sale' THEN
                        CASE WHEN COALESCE(inv.isReturned, 0) = 0 THEN -ii.quantity ELSE 0 END
                      WHEN inv.invoiceType = 'Purchase' THEN
                        CASE WHEN COALESCE(inv.isReturned, 0) = 0 THEN ii.quantity ELSE 0 END
                      ELSE 0
                    END
                  )
                  FROM invoice_items ii
                  JOIN invoices inv ON inv.id = ii.invoiceId
                  WHERE ii.inventoryId = i.id
                ), 0)
              + COALESCE((
                  SELECT SUM(sa.quantityDelta)
                  FROM stock_adjustments sa
                  WHERE sa.inventoryId = i.id
                ), 0) AS quantity
            FROM inventory i
            LEFT JOIN inventory_opening_stock os ON os.inventoryId = i.id
          `,
        ).run();
      })();

      return true;
    } catch (error) {
      console.log('027 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('027 migration completed!');
    }
  },
};
