import type { DatabaseDriver } from './driver';

/**
 * Reconciles a just-imported desktop database's stored `inventory.quantity`
 * counter against `inventory_quantity_view` (migration 027 — see
 * `schema.snapshot.sql`'s `CREATE VIEW inventory_quantity_view`), the
 * fact-derived on-hand quantity every screen in this app actually reads:
 * `COALESCE(opening_stock.quantity, 0)` + net invoice movement (Purchase
 * `+`, Sale `-`, quotations and returned invoices excluded) +
 * `SUM(stock_adjustments.quantityDelta)`.
 *
 * ## Why this exists — the field bug this closes
 *
 * The legacy desktop app maintained `inventory.quantity` as a stored,
 * incrementally-updated counter (see `InventoryService.applyStockAdjustment`'s
 * `SQL.updateInventoryQuantity`) alongside — not derived from — the fact
 * tables the view above reconstructs from. Two historical write paths only
 * ever touched that stored counter and left no fact row behind for the view
 * to pick up: quantity entered directly at item creation, and direct
 * quantity edits from older app versions that predate `stock_adjustments`
 * (migration 014) or `inventory_opening_stock` even existing. On a real
 * 997-item owner database, this produced view numbers wildly divorced from
 * the number the owner actually trusts (their stored desktop counter) — e.g.
 * stored `5858` vs. view `-14369` for one item. `inventory_quantity_view`
 * itself is correct given the facts it has; the facts are simply incomplete
 * for rows written by those two legacy paths.
 *
 * ## The fix: same shape as {@link backfillOpeningBalanceJournals}
 *
 * Exactly the same class of problem `./openingBalanceBackfill.ts` solves for
 * the ledger (pre-025 "Opening Balance from B/S" rows with no backing
 * journal), applied to inventory instead: rather than trying to distinguish
 * which historical write path produced the gap (impossible to reconstruct
 * after the fact — there is no audit trail for direct `UPDATE inventory SET
 * quantity = ...` calls), this synthesizes ONE `stock_adjustments` row per
 * item whose `quantityDelta` is exactly the gap between the stored counter
 * (trusted — it is the number the owner has been looking at) and what the
 * view computes from facts alone. Once that row lands, the view's own
 * `SUM(stock_adjustments.quantityDelta)` term absorbs the gap and the view
 * recomputes to exactly the stored counter — closing the loop the same way
 * the opening-balance backfill closes it for `ledger_view`/`ledger`.
 *
 * `inventory.quantity` itself is never written here — same "existing rows
 * left completely untouched, only the missing fact is added" discipline as
 * `backfillOpeningBalanceJournals`. The stored counter is the input this
 * reads, not an output it corrects.
 *
 * ## Why a plain `target.run` INSERT, not a bulk/raw write
 *
 * `stock_adjustments` is one of the tables migration 029
 * (`029_create_sync_tables.ts`) attaches an AFTER INSERT capture trigger to
 * (it is in `BUSINESS_TABLES`, minus only `ledger` — see that migration's
 * doc comment) — every insert through the normal `INSERT INTO
 * stock_adjustments (...)` statement is captured into `sync_outbox` and
 * replicates to the owner's other devices the same way any other stock
 * adjustment would. That is the entire reason this baseline is written as a
 * real `stock_adjustments` row instead of, say, mutating `inventory.quantity`
 * directly or introducing a separate "baseline" concept: it rides the
 * existing fact-table + sync pipeline for free.
 *
 * Runs inside its own `driver.transaction(...)` — nested (via a SAVEPOINT)
 * when called from inside an already-open transaction, such as
 * `importDatabase`'s copy transaction — same as
 * {@link backfillOpeningBalanceJournals}; see `DatabaseDriver.transaction`'s
 * doc comment.
 *
 * ## What these rows actually represent — and why the reason/date changed
 *
 * Investigation against a real owner database (997 items, 11,290 invoices
 * bulk-loaded 2025-03 with business dates back to 2008 — the desktop app's
 * stock-counter feature postdates that history) confirmed the gap this
 * backfill closes is each item's OPENING STOCK from before any recorded
 * history began, not an event that happened on import day. The original
 * reason/date (`'Import baseline: carried from desktop stored quantity'`,
 * stamped `today`) read as a false event to the owner: a row dated
 * 2026-08 claiming to explain stock that was already on hand in 2008.
 * `INVENTORY_BASELINE_REASON`'s value and `INVENTORY_BASELINE_DATE` (below)
 * fix that presentation without changing anything about the mechanism above
 * — same gap, same one-row-per-item shape, same sync path. Migration 032
 * (`./migrations/032_redate_import_baselines.ts`) re-dates/renames the rows
 * this already produced under the old reason/date on the owner's live
 * devices; the export name `INVENTORY_BASELINE_REASON` is kept stable so
 * every importer of it (this file, `import.ts`, tests) picks up the new
 * value without a rename.
 *
 * WARNING: `src/core/services/InventoryService.ts` interpolates this literal
 * directly into SQL template strings (`WHERE COALESCE(reason,'') != '...'`)
 * rather than binding it as a parameter — see that file's `SQL` object. This
 * value must therefore NEVER contain a single quote (`'`) or any other SQL
 * metacharacter; changing it, change it to something that stays a plain,
 * quote-free string.
 */
export const INVENTORY_BASELINE_REASON =
  'Opening stock carried from desktop import';

/**
 * The date every baseline `stock_adjustments` row is stamped with —
 * deliberately a fixed sentinel, not "today" (see this constant's sibling
 * doc comment above for why "today" was wrong). Must sort/compare as
 * EARLIER than every real date these rows coexist with.
 *
 * Every place in this codebase that orders or filters `stock_adjustments`
 * (and `invoices`) `date` values does so with a plain string comparison —
 * `date` is a `TEXT` column, not a real SQLite `DATE`/`DATETIME`, so `<`,
 * `>`, `ORDER BY` etc. all compare the stored strings lexicographically.
 * Confirmed by reading the actual comparisons:
 *   - `InventoryService.getStockAsOf`'s `SQL.stockAsOfAdjustmentDeltaAfter`
 *     / `stockAsOfInvoiceDeltaAfter` (`date > ?`) and
 *     `SQL.getAdjustmentAggregate` (`date >= ? AND date <= ?`) — plain
 *     string comparison against an ISO `asOfDate` (normalized to
 *     `YYYY-MM-DDT23:59:59.999Z` or passed through as-is).
 *   - The renderer's "Stock history" dialog
 *     (`src/renderer/views/Inventory/StockHistoryDialog.tsx`), which sorts
 *     the merged opening-stock + adjustment rows with `lodash.orderBy(...,
 *     [(r) => r.date || ''], ['desc'])` — again a plain string compare.
 *
 * `'2000-01-01'` (10 characters, `YYYY-MM-DD`) sorts lexicographically
 * before every ISO date/datetime string this app writes to
 * `stock_adjustments.date` elsewhere (all of them 4-digit-year ISO, so the
 * comparison is decided by the leading `'20'` vs. a later year — `'20' <
 * '20'` ties, then `'0' < '1'`/`'2'` etc. for any year from 2001 on):
 * character-by-character, `'2000...' < '20XX...'` for any real adjustment
 * year XX > 00, which covers every adjustment this app has ever recorded
 * (the earliest is 2026-04-27 on the real owner database this was
 * validated against). It also sorts before the desktop's oldest real
 * invoice, `'2008...'`.
 *
 * The one honest caveat: `invoices.date` on real imported files is MIXED
 * format — legacy rows are literal `MM/DD/YYYY` strings (e.g.
 * `'01/01/2008'`) sitting alongside ISO datetimes (e.g.
 * `'2026-08-21T07:00:00.000Z'`). Under plain string comparison, EVERY
 * `MM/DD/YYYY` string (they all start with `'0'` or `'1'`, the leading
 * month digit) sorts before EVERY 4-digit-year ISO string (leading `'20'` >
 * `'1'`/`'0'`) *and* before `'2000-01-01'` itself (`'0' < '2'` on the very
 * first character) — regardless of which real calendar year the
 * `MM/DD/YYYY` value encodes. That means `'2000-01-01'` is not literally
 * "before" a legacy-formatted invoice date in the string-sort sense used
 * by this codebase. This is harmless for what `INVENTORY_BASELINE_DATE` is
 * actually compared against: it only ever appears in `stock_adjustments.date`
 * (always ISO-formatted, both here and everywhere else this app writes that
 * column — see `SQL.stockAsOfAdjustmentDeltaAfter` / `getAdjustmentAggregate`
 * above, neither of which ever compares it to `invoices.date` directly), and
 * within `stock_adjustments` the sentinel is verified earliest-sorting
 * against every real value on the owner's file. Documented here rather than
 * silently assumed, per this task's instruction to be honest about the
 * string-comparison interaction with the legacy format.
 */
export const INVENTORY_BASELINE_DATE = '2000-01-01';

export interface InventoryBaselineBackfillResult {
  /** Number of inventory items a baseline `stock_adjustments` row was inserted for (gap != 0). */
  reconciled: number;
  /** Sum of every inserted row's `quantityDelta` — net units the baseline added across all items. */
  totalDelta: number;
}

interface InventoryGapRow {
  inventoryId: number;
  gap: number;
}

/**
 * For every `inventory` row, computes `gap = inventory.quantity -
 * inventory_quantity_view.quantity` and, for each row where `gap != 0`,
 * inserts one `stock_adjustments` row with `quantityDelta = gap` and
 * `reason` set to {@link INVENTORY_BASELINE_REASON} so the view recomputes
 * to exactly the stored counter. Items whose facts already
 * fully explain the stored quantity (`gap === 0`) are left alone — no row is
 * inserted, same "don't write a no-op fact" discipline as the opening-balance
 * backfill's idempotency guard.
 *
 * `date` is stamped {@link INVENTORY_BASELINE_DATE} — a fixed sentinel
 * before every real date these rows coexist with, not "today" (the moment
 * the baseline is established / import time). There is no historical date
 * to recover for a quantity that was never backed by a fact row in the
 * first place, but the quantity itself represents stock the item already
 * had before any recorded history begins (see
 * {@link INVENTORY_BASELINE_REASON}'s doc comment) — an opening-stock date
 * reads honestly; an import-day date reads as a false event.
 */
export async function backfillInventoryBaseline(
  target: DatabaseDriver,
): Promise<InventoryBaselineBackfillResult> {
  return target.transaction(async () => {
    const gapRows = await target.all<InventoryGapRow>(
      `
        SELECT i.id AS inventoryId, i.quantity - iqv.quantity AS gap
        FROM inventory i
        JOIN inventory_quantity_view iqv ON iqv.inventoryId = i.id
        WHERE i.quantity - iqv.quantity != 0
        ORDER BY i.id ASC
      `,
    );

    if (gapRows.length === 0) {
      return { reconciled: 0, totalDelta: 0 };
    }

    let totalDelta = 0;

    for (const row of gapRows) {
      // eslint-disable-next-line no-await-in-loop
      await target.run(
        `INSERT INTO stock_adjustments (inventoryId, quantityDelta, reason, date) VALUES (?, ?, ?, ?)`,
        [
          row.inventoryId,
          row.gap,
          INVENTORY_BASELINE_REASON,
          INVENTORY_BASELINE_DATE,
        ],
      );
      totalDelta += row.gap;
    }

    return { reconciled: gapRows.length, totalDelta };
  });
}

/**
 * Defensive post-reconciliation audit: re-reads EVERY inventory row and
 * reports any whose stored `quantity` still differs from
 * `inventory_quantity_view` — i.e. rows {@link backfillInventoryBaseline}
 * should have made impossible. By construction the backfill closes every
 * gap exactly, so this returning anything means a real defect (a view
 * definition change, a trigger interfering with the inserted adjustment,
 * arithmetic overflow — something), and the import summary must say so
 * per-item rather than let a screen quietly display a wrong on-hand number.
 * This exists because that exact failure mode — every synthetic test green
 * while the owner's real file diverged silently — already happened once;
 * the import report, not the test suite, is the last line of defense on
 * real data.
 *
 * Returns warning strings (empty when everything reconciles — the expected
 * case, always). Never throws.
 */
export async function verifyInventoryReconciliation(
  target: DatabaseDriver,
): Promise<string[]> {
  const mismatched = await target.all<{
    inventoryId: number;
    name: string;
    stored: number;
    computed: number;
  }>(
    `
      SELECT i.id AS inventoryId, i.name AS name,
             i.quantity AS stored, iqv.quantity AS computed
      FROM inventory i
      JOIN inventory_quantity_view iqv ON iqv.inventoryId = i.id
      WHERE i.quantity != iqv.quantity
      ORDER BY abs(i.quantity - iqv.quantity) DESC
    `,
  );
  if (mismatched.length === 0) return [];

  const LISTED = 10;
  const detail = mismatched
    .slice(0, LISTED)
    .map(
      (m) =>
        `"${m.name}" (id ${m.inventoryId}: desktop ${m.stored}, computed ${m.computed})`,
    )
    .join('; ');
  const overflow =
    mismatched.length > LISTED
      ? ` …and ${mismatched.length - LISTED} more`
      : '';
  return [
    `RECONCILIATION FAILURE: ${mismatched.length} inventory item(s) still ` +
      `show a computed on-hand quantity different from the desktop's stored ` +
      `quantity AFTER baseline reconciliation — this should be impossible ` +
      `and needs investigation before trusting on-hand numbers: ${detail}${overflow}`,
  ];
}
