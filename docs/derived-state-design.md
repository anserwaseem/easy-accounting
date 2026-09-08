# Derived-State Design: demoting `ledger` and `inventory.quantity`

Status: design proposal, no code changed by this document.
Scope: `src/core/services/*` (the live implementation, wired in `src/main/coreRuntime.ts`).
The parallel `src/main/services/{Journal,Ledger,Invoice,Inventory}.service.ts` files are
superseded — nothing on the live path instantiates them (`coreRuntime.ts` imports only from
`../core`) — so they are out of scope for the migration itself, but are noted where their tests
would need the same fixture treatment if they are ever deleted.

Context this design builds on: migration `024_add_uuid_to_business_tables.js` already added a
`uuid` column + backfill + insert trigger to every "business table" it lists, **including
`ledger` and `inventory`**. That list is effectively "tables the sync layer will replicate by
identity." This document's central claim is that `ledger` (whole table) and `inventory.quantity`
(one column) must come **out** of that replicated set before a sync layer is built on top of
migration 024, because both are currently mutated as running counters.

---

## 1. Current state: `ledger`

### 1.1 Schema (`src/sql/schema.sql:78-94`)

```sql
CREATE TABLE IF NOT EXISTS "ledger" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "date" DATETIME NOT NULL,
  "particulars" STRING NOT NULL,
  "accountId" INTEGER,
  "debit" DECIMAL DEFAULT 0,
  "credit" DECIMAL DEFAULT 0,
  "balance" DECIMAL NOT NULL DEFAULT 0,
  "balanceType" STRING NOT NULL,
  "linkedAccountId" INTEGER,
  "createdAt" DATETIME,
  "updatedAt" DATETIME,
  FOREIGN KEY("accountId") REFERENCES "account"("id"),
  CHECK ("balanceType" IN ('Cr', 'Dr'))
);
```

No index exists on `ledger.accountId`, `ledger.date`, or `journal_entry.accountId` /
`journal_entry.journalId` anywhere in `schema.sql` or `src/main/migrations/*.js` — the only
indexes touching these tables are `idx_journal_invoiceId` (migration 016) and the uuid unique
indexes from migration 024. Every ledger query today does a full or near-full scan filtered on
`accountId`. This matters for the performance discussion in §4.

### 1.2 Write flows (file:line)

1. **`JournalService.insertJournal`** — `src/core/services/JournalService.ts:237-312`
   - Inserts one `journal` row and N `journal_entry` rows (facts).
   - Calls `insertLedgerEntries` (`JournalService.ts:421-516`), which does a **proportional
     split**: for a journal with one debit-side entry and many credit-side entries (or vice
     versa — `insertJournal` rejects the many-to-many case at `JournalService.ts:244-246`), it
     cross-multiplies each debit line against each credit line and writes one `ledger` row per
     `(entry, counterparty)` pair via `SQL.insertLedger` (`JournalService.ts:49-50, 469, 503`).
     Each row carries a **running balance it just computed in JS** from the account's prior
     balance (`ledgerService.getBalance`, called once per entry inside the loop —
     `JournalService.ts:441`).
   - Before doing that, it checks whether the journal is **back-dated** relative to existing
     ledger rows for any affected account (`ledgerService.hasNewerEntries`,
     `JournalService.ts:263-268` → `LedgerService.ts:176-182`, `SQL.checkNewerEntries`
     `LedgerService.ts:20-25`). If so, the whole account's ledger is deleted and replayed in
     date order (`rebuildLedger` / `rebuildLedgerFromEntries`, `JournalService.ts:314-365`).
   - This "maybe rebuild" branch exists **only** because `balance`/`balanceType` are stored,
     mutable, order-dependent values. It is ~90 lines of machinery whose entire purpose is
     working around the fact that a running counter breaks when a write lands out of
     chronological order — precisely the failure mode two interleaving devices will trigger
     constantly.
2. **`JournalService.removeLedgerEffectOfJournals`** — `JournalService.ts:376-396`. Used by
   invoice void/edit (`InvoiceService.ts:1461, 1720`). Filters ledger rows by parsing
   `particulars` with a regex (`/^Journal #(\d+)$/`, `JournalService.ts:389`) to find rows
   belonging to the journals being removed, then replays the remainder via
   `rebuildLedgerFromEntries`.
3. **`StatementService.setupLedgers`** — `src/core/services/StatementService.ts:161-169`. This
   is the one write path that does **not** go through `JournalService` at all:
   ```ts
   await this.ledgerService.insertLedger({
     date,
     particulars: 'Opening Balance from B/S',
     accountId,
     debit,
     credit,
     balance: amount,
     balanceType,
   });
   ```
   No `journal` row, no `journal_entry` rows, no `linkedAccountId`. It is reached from the
   "Getting Started" onboarding screen (`src/renderer/views/Home/GettingStarted/index.tsx:44`
   → IPC `saveBalanceSheet`, `src/main/main.ts:362`, `src/main/preload.ts:113-116`,
   `src/core/api/AppApi.ts:520-522`) to seed opening balances from an imported balance sheet.
   **This is the only place in the live code where a `ledger` row is a fact with no
   corresponding journal — see §2.**
4. **`LedgerService.insertLedger`** (`LedgerService.ts:285-296`) — the shared low-level writer
   used by both #1/#2 (via `JournalService`) and #3 (`StatementService`) directly.

### 1.3 Read flows (file:line)

All reads go through `LedgerService.ts`:

- `getLedger(accountId)` (168-170) — full ordered ledger for one account, `ORDER BY
datetime(date,'localtime') ASC, id ASC`. Used by report/detail views and internally by
  `JournalService.rebuildLedger`.
- `getBalance(accountId)` (184-186) — `ORDER BY date DESC, id DESC LIMIT 1`. Used by
  `insertLedgerEntries` to seed the running total, and by any UI showing "current balance."
- `getBalancesForAccountIds(accountIds[])` (189-204) — **already uses a window function**:
  `ROW_NUMBER() OVER (PARTITION BY accountId ORDER BY date DESC, id DESC)` (`LedgerService.ts
:69-87`). This is direct evidence the codebase already relies on SQLite window-function
  support at the size this app runs at, and is the strongest local precedent for the view design
  in §4.
- `getBalanceAtDate`, `getBalancesForAccountIdsAsOfDate`, `getLedgerRange`,
  `getLedgerRangeForAccountIds`, `getLedgersUpToDateForAccountIds` — all date-scoped variants of
  the above, used by `src/renderer/views/Reports/LedgerReport`,
  `Reports/AverageEquityBalances`, `Reports/AccountBalances`, `Reports/TrialBalance`, and
  `src/renderer/views/Invoice/invoiceDetails.tsx` (account balance shown on an invoice).

---

## 2. Is `ledger` a pure projection of `journal` + `journal_entry`? — precise answer

**Almost, and it can be made exactly so with one migration, but it is not today.**

What is genuinely derivable, algorithmically, from `journal_entry` alone:

- **`particulars`** — always the literal string `` `Journal #${journalId}` `` for
  journal-sourced rows (`JournalService.ts:476, 510`). Pure format string, zero information.
- **`linkedAccountId`** — determined by the proportional-split pairing algorithm in
  `insertLedgerEntries`. Because `insertJournal` forbids a journal having more than one entry on
  _both_ sides simultaneously (`JournalService.ts:244-246`), every journal is 1:1, 1:N or N:1
  between its debit-side and credit-side entries. The "linked account" for a given ledger row is
  therefore the accountId of the entry(ies) on the opposite side of the **same `journalId`** —
  fully reconstructable via a self-join on `journal_entry.journalId`, requiring no data not
  already in `journal_entry`.
- **`debit` / `credit` (the proportional split amounts)** — `proportionalDebit = d.debitAmount *
c.creditAmount / totalCredits` (`JournalService.ts:450-451`). Because one side always has
  exactly one entry, `totalDebits`/`totalCredits` collapses to that single entry's amount, and
  (assuming a balanced journal — enforced client-side by `src/renderer/views/NewJournal/index.tsx
:116-135, 208-214`, which blocks submission while debits ≠ credits) the debit-side and
  credit-side formulas agree on the same number for each `(debit entry, credit entry)` pair. Pure
  arithmetic over `journal_entry.debitAmount`/`creditAmount` — no independent fact.
- **`balance` / `balanceType`** — a running SUM with a sign flip by `chart.type`
  (`JournalService.ts:337-351`). Pure aggregate — exactly what window functions are for, and
  already done this way for the "latest balance" case (§1.3).
- **`date`** — for journal-sourced rows, always `journal.date` (`JournalService.ts:294, 334`
  passes the same `date` through). No independent fact.

What is **not** derivable, because it is a fact with no other home:

- **The `StatementService.setupLedgers` rows** (§1.2 item 3): `particulars = 'Opening Balance
from B/S'`, `accountId`, `debit`/`credit`, `balance`, `balanceType`, `date =
balanceSheet.date`. There is no `journal`/`journal_entry` row backing these at all today.
  Dropping `ledger` without first migrating this data would **silently delete every opening
  balance ever imported through Getting Started** on any DB that used it.

**Conclusion:** `ledger` can become a pure projection, but only after `StatementService`'s
opening-balance import is rewritten to insert a real `journal` + two `journal_entry` rows (one
debit, one credit, against whatever contra-account is chosen — see §5) instead of writing
`ledger` directly. That is a **prerequisite migration**, not a data-migration afterthought,
because it is the one place the "replicated tables contain only facts" rule is currently broken
in the write path (not just in the derived `ledger` table).

---

## 3. Current state: `inventory.quantity`

### 3.1 Schema (`src/sql/schema.sql:96-109, 211-231`)

```sql
CREATE TABLE IF NOT EXISTS "inventory" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    ...
    "quantity" INTEGER NOT NULL DEFAULT 0,
    ...
);
CREATE TABLE IF NOT EXISTS "inventory_opening_stock" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "inventoryId" INTEGER NOT NULL UNIQUE,
    "quantity" INTEGER NOT NULL,
    "asOfDate" DATETIME,
    "old_quantity" INTEGER,
    ...
);
CREATE TABLE IF NOT EXISTS "stock_adjustments" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "inventoryId" INTEGER NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "reason" TEXT,
    "date" DATETIME NOT NULL,
    ...
);
```

### 3.2 Write flows (file:line) — `src/core/services/InventoryService.ts` SQL block, lines 74-84:

```sql
updateInventoryQuantity: `UPDATE inventory SET quantity = quantity + ? WHERE id = ?`
setInventoryQuantity:    `UPDATE inventory SET quantity = ? WHERE id = ?`
```

- `setInventoryQuantity` — used by `setOpeningStock` (`InventoryService.ts:728, 752`) to force
  an absolute "as of" value alongside an `inventory_opening_stock` upsert
  (`InventoryService.ts:733-738, 754-759`, `SQL.upsertOpeningStock` at lines 65-72).
- `updateInventoryQuantity` (the **`quantity = quantity + ?` read-modify-write**) is used by:
  - `InventoryService.applyStockAdjustment` (`InventoryService.ts:779-815`) — pairs it with an
    `INSERT INTO stock_adjustments` in the same transaction.
  - `InvoiceService` — its own copy of the same relative-update SQL
    (`InvoiceService.ts:104-108`, `SQL.updateInventoryItem`), invoked from
    `applyPersistedSaleInventoryDecrements`/`applyPersistedPurchaseInventoryIncrements`
    (`InvoiceService.ts:1086-1117`) on invoice post, and again (with the delta negated) on
    invoice void/edit-reverse (`InvoiceService.ts:1533-1535, 1776-1810`).

`UPDATE inventory SET quantity = quantity + ?` is the textbook two-device drift bug: if Device A
and Device B both decrement the same item concurrently while offline, whichever write a
last-write-wins sync applies second will stomp the other's decrement — the item can end up
overstated by exactly the lost decrement. This is a strictly worse failure mode than `ledger`'s,
because `ledger.balance` at least gets fully rebuilt from scratch by `rebuildLedgerFromEntries`
whenever a stale write is detected; `inventory.quantity` has no equivalent self-healing path at
all — it is a bare mutable counter.

### 3.3 Read flows (file:line)

- `InventoryService.getInventory` / `getAllInventory` (`InventoryService.ts:34-44, 113-118`) —
  `SELECT i.*, ...` includes the stored `quantity` directly; this is what powers the on-hand
  column in `src/renderer/views/Inventory/inventoryTable.tsx`.
- `InventoryService.getInventoryQuantity` (95-97) — single-row lookup, used before every relative
  update to read-then-write the current value (the race window itself).
- **`InventoryService`'s own "as of a date" report logic already treats `quantity` as an anchor
  to be corrected, not a ground truth** (`InventoryService.ts:1255-1330`,
  `getStockAsOfDate`/similar): it computes `quantityAsOf = currentQuantity − delta`, where
  `delta` comes from two pure-SQL aggregates that already sum the facts:
  - `stockAsOfInvoiceDeltaAfter` (`InventoryService.ts:342-375`) — sums `invoice_items.quantity`
    for sale/purchase invoices _after_ a cutoff date, correctly excluding quotations
    (`isQuotation`) and handling `isReturned`/`returnedAt` reversals.
  - `stockAsOfAdjustmentDeltaAfter` (`InventoryService.ts:377-383`) — sums
    `stock_adjustments.quantityDelta` after the cutoff.
    This is important: **the app already contains, and already trusts, a pure-SQL formula for
    "how much did quantity move between two points in time."** The only reason it's phrased as
    "rewind from the live counter" rather than "sum up from opening stock" is that the live counter
    happens to be sitting right there. §5 inverts this to compute forward from
    `inventory_opening_stock` instead, which removes the dependency on the counter entirely.
- **`InventoryHealth` report SQL never reads `inventory.quantity` at all** —
  `getSaleAggregateHealth`/`getPurchaseAggregateHealth`/`getAdjustmentAggregate`
  (`InventoryService.ts:238-262, 308-314`) aggregate straight from `invoice_items` and
  `stock_adjustments`. This is a second existing precedent, alongside
  `getBalancesForAccountIds`'s window function, that the codebase is already comfortable
  computing derived quantities live from fact tables rather than trusting a stored counter.

### 3.4 Is `inventory.quantity` a pure projection?

**Yes, unconditionally — more cleanly than `ledger`.** Unlike ledger there is no
StatementService-style rogue writer: every write to `quantity` is paired with a write to either
`inventory_opening_stock` (`setOpeningStock`) or `stock_adjustments` (`applyStockAdjustment`), or
derives from `invoice_items` (invoice post/void/edit). `invoice_items` rows are also mutated in
place on edit (`InvoiceService.ts:1464` `SQL.deleteInvoiceItems` + reinsert), not append-only, so
a live `SUM` over current `invoice_items` rows always matches the current state without needing
any special-casing for edits — only genuine returns (`isReturned`/`returnedAt`) need the CASE
logic §5 borrows from `stockAsOfInvoiceDeltaAfter`.

---

## 4. Target design: views vs. rebuild-on-write cache — `ledger`

### Recommendation: **SQL views**, not a cache table.

Reasoning specific to this codebase:

1. **The rebuild machinery ledger has today (`hasNewerEntries` / `needsRebuild` /
   `rebuildLedger`) is itself proof that a stored running counter cannot survive out-of-order
   writes without ad hoc detect-and-replay logic.** Multi-device sync makes "a write lands after
   later-dated rows already exist" the _common_ case, not the rare backdate case it is today.
   A cache table would need to run that same detect-and-replay logic after every sync-apply,
   for every account touched by every incoming journal — i.e. it inherits the exact bug class
   this project is trying to eliminate, just relocated to "runs after sync" instead of "runs on
   local insert." A view has no rebuild step, ever: it is correct by construction regardless of
   insertion order, because it recomputes from `journal_entry` on every read.
2. **The codebase already proves out the required window-function feature at this app's actual
   scale** — `getBalancesForAccountIds` (`LedgerService.ts:69-87`) is a working
   `ROW_NUMBER() OVER (PARTITION BY accountId ORDER BY date DESC, id DESC)` query today. better-
   sqlite3 ships a modern SQLite (window functions available since SQLite 3.25, 2018), so there
   is no dependency risk in going further with the same feature.
3. **Performance reality for "tens of thousands of rows":** the view computation is two cheap
   passes over `journal_entry`, which is already the smallest per-row table in the system
   (2 rows/journal on average). A `SUM(...) OVER (PARTITION BY accountId ORDER BY date, id)`
   evaluated per account, filtered to that account's rows, is `O(rows for that account · log)`
   with the right index — trivial at tens of thousands of total rows, sub-millisecond per account
   in practice for SQLite. The one real cost is the **proportional-split fan-out join** (§4.1) —
   but the same "at most one side has >1 entries" invariant that makes the JS loop linear
   (`JournalService.ts:436-515` is `O(max(D,C))` per journal, not `O(D·C)`) makes the SQL cross
   join linear too: `CROSS JOIN` between a 1-row side and an N-row side produces N rows, not N².
   No index exists on `journal_entry.journalId` today (§1.1) — add one; see §6.
4. **A view deletes code instead of adding a parallel maintenance path.** Choosing the cache-table
   route would mean keeping `rebuildLedgerFromEntries`, `hasNewerEntries`,
   `removeLedgerEffectOfJournals`'s regex particulars-matching, and the whole "call rebuild after
   every write that could be stale" discipline — just re-triggered by sync-apply instead of local
   insert. Choosing the view route deletes all of it: `JournalService.insertJournal` no longer
   needs the `needsRebuild` branch (`JournalService.ts:257-301`) at all, because there is nothing
   to keep in sync — the view _is_ always in sync.

The tradeoff being accepted: the view SQL for the proportional split (§4.1) is genuinely fiddly
to get bit-exact, and is new SQL that doesn't exist anywhere in the codebase today (unlike the
window-function balance query, which is a small extension of an existing pattern). This is why
§7's equivalence harness is the actual gate, not this document — if the view's output cannot be
made to match stored `ledger` bit-for-bit across the equivalence corpus, fall back to the
rebuild-on-write cache table as Plan B (same recompute function as today's
`rebuildLedgerFromEntries`, just called unconditionally on every write instead of only when
`hasNewerEntries` fires, and with `ledger` excluded from the sync replica set / recomputed
locally after every sync-apply rather than replicated).

### 4.1 View SQL sketch (to validate via §7's harness before relying on it)

Step 1 — reconstruct the paired "ledger lines" (one row per `(entry, counterparty)` pair, per
side), from `journal_entry` alone:

```sql
CREATE VIEW journal_entry_pairs AS
-- one row per (debit-side entry, credit-side entry) pair within the same journal
SELECT
  j.id            AS journalId,
  j.date          AS date,
  d.id            AS debitEntryId,
  d.accountId     AS debitAccountId,
  c.id            AS creditEntryId,
  c.accountId     AS creditAccountId,
  -- amount: equals both proportionalDebit and proportionalCredit given a balanced journal
  ROUND(d.debitAmount * c.creditAmount /
    (SELECT SUM(je.creditAmount) FROM journal_entry je WHERE je.journalId = j.id), 8) AS amount
FROM journal j
JOIN journal_entry d ON d.journalId = j.id AND d.debitAmount  > 0
JOIN journal_entry c ON c.journalId = j.id AND c.creditAmount > 0;

CREATE VIEW ledger_lines AS
SELECT debitAccountId  AS accountId, date, debitEntryId AS entryId, creditAccountId AS linkedAccountId,
       amount AS debit, 0 AS credit, 'Journal #' || journalId AS particulars, journalId, debitEntryId AS orderTiebreak
FROM journal_entry_pairs
UNION ALL
SELECT creditAccountId AS accountId, date, creditEntryId AS entryId, debitAccountId  AS linkedAccountId,
       0 AS debit, amount AS credit, 'Journal #' || journalId AS particulars, journalId, creditEntryId AS orderTiebreak
FROM journal_entry_pairs;
```

Step 2 — running balance per account, sign-flipped by `chart.type`, exactly matching
`JournalService.rebuildLedgerFromEntries`'s switch (`JournalService.ts:337-351`):

```sql
CREATE VIEW ledger_view AS
SELECT
  ll.*,
  CASE ct.type
    WHEN 'Liability' THEN 'raw'  -- placeholder; real signedDelta computed below
  END,
  ABS(SUM(
    CASE WHEN ct.type IN ('Asset','Expense') THEN ll.debit - ll.credit
         ELSE ll.credit - ll.debit END
  ) OVER (PARTITION BY ll.accountId ORDER BY ll.date, ll.orderTiebreak
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS balance,
  CASE WHEN (
    SUM(CASE WHEN ct.type IN ('Asset','Expense') THEN ll.debit - ll.credit
             ELSE ll.credit - ll.debit END)
    OVER (PARTITION BY ll.accountId ORDER BY ll.date, ll.orderTiebreak
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  ) >= 0
  THEN CASE WHEN ct.type IN ('Asset','Expense') THEN 'Dr' ELSE 'Cr' END
  ELSE CASE WHEN ct.type IN ('Asset','Expense') THEN 'Cr' ELSE 'Dr' END
  END AS balanceType
FROM ledger_lines ll
JOIN account a ON a.id = ll.accountId
JOIN chart ct ON ct.id = a.chartId;
```

(The `CASE ct.type WHEN 'Liability' THEN 'raw' END` line above is a stray editing artifact of
drafting this sketch and must be deleted — the two real computed columns are `balance` and
`balanceType`; flagging it here rather than silently cleaning it up so whoever implements this
notices the sketch needs a careful line-by-line rewrite, not a copy-paste.)

Ordering note: `ll.orderTiebreak` uses the **originating `journal_entry.id`** as the tie-break
within a date, not a ledger-row id (there is no physical ledger row to have one). Because
`journal_entry` rows are inserted in the same order `JournalService.insertJournal` iterates
`journalEntries` (`JournalService.ts:282-291`), and the JS proportional-split loop iterates in
that same array order, `journal_entry.id` ordering reproduces the exact sequence today's stored
`ledger.id` ordering encodes. This is the detail the equivalence harness must stress hardest,
since `balance`/`balanceType` at a given row (unlike the final total) are order-dependent.

`StatementService`'s opening-balance rows, once migrated into real `journal`/`journal_entry` rows
(§2, §6 migration step), fall out of this view exactly like any other journal — no special case
needed once that prerequisite lands, which is itself a strong argument for doing that fix first
regardless of which of views/cache-table gets chosen for the running balance.

---

## 5. Target design: `inventory.quantity`

### Recommendation: **computed column via a view**, no window function needed.

Unlike `ledger`, this is a single scalar aggregate per item, not a running list — no
`PARTITION BY ... ORDER BY` requirement, just `SUM`s with `CASE`-guarded filters, directly
lifted from the already-trusted `stockAsOfInvoiceDeltaAfter`/`stockAsOfAdjustmentDeltaAfter`
formulas (`InventoryService.ts:342-383`), inverted to compute _forward_ from
`inventory_opening_stock` instead of _backward_ from the live counter:

```sql
CREATE VIEW inventory_quantity_view AS
SELECT
  i.id AS inventoryId,
  COALESCE(os.quantity, 0)
  + COALESCE((
      SELECT SUM(
        CASE
          WHEN COALESCE(inv.isQuotation, 0) != 0 THEN 0
          WHEN inv.invoiceType = 'Purchase' THEN
            CASE WHEN COALESCE(inv.isReturned, 0) = 0 THEN ii.quantity
                 ELSE ii.quantity - ii.quantity  -- returned purchase: net zero on-hand effect
            END
          WHEN inv.invoiceType = 'Sale' THEN
            CASE WHEN COALESCE(inv.isReturned, 0) = 0 THEN -ii.quantity
                 ELSE 0  -- returned sale: stock came back, net zero movement
            END
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
FROM inventory i;
```

This must be checked line-by-line against the exact CASE logic in `stockAsOfInvoiceDeltaAfter`
(`InventoryService.ts:342-375`) during implementation — that existing query is the specification
for "how a return affects on-hand," and the sketch above is a first pass, not a transcription.
The forward-and-backward formulas should be provably equivalent (both describe the same physical
movement), and the equivalence harness (§7) tests exactly that: does
`inventory_quantity_view.quantity` match the currently-stored `inventory.quantity` on every real
row of every real DB.

Items with **no** `inventory_opening_stock` row (never had opening stock set) correctly default
to `0` via the `COALESCE(os.quantity, 0)` — matching `inventory.quantity`'s own
`NOT NULL DEFAULT 0` (`schema.sql:101`).

---

## 6. Migration sequence

`src/main/migrations/` currently ends at `024_add_uuid_to_business_tables.js`. Migrations below
start at **025** and are written in the same idiom as the existing files (`hasColumn` guard,
`db.transaction(() => {...})()`, `console.log`/`console.error` around a try/catch, exported as
`{ name, up }`) — see `src/main/migrations/016.js` and `023.js` for the reference shape.

**025 — `025_migrate_opening_balance_ledger_to_journal.js`** (prerequisite; ledger only)

- For every `ledger` row with `particulars = 'Opening Balance from B/S'` (the only rows with no
  backing journal — §2), synthesize a `journal` row (`narration = 'Opening Balance from B/S'`,
  same `date`, `isPosted = 1`, `invoiceId = NULL`) and two `journal_entry` rows: one on
  `accountId` for `debit`/`credit` as stored, one on a designated contra account for the balancing
  side. **Needs a product decision**: use a fixed "Opening Balance Equity" system account
  (create it via `ChartService`/`AccountService` if absent, matching the pattern
  `StatementService.setupLedgers` already uses via `ChartService.getChartName` /
  `AccountService.insertAccountIfNotExists`, `StatementService.ts:100-137`), so the import stays
  double-entry-balanced without asking the user anything retroactively.
- Do **not** touch existing `ledger` rows' `balance`/`balanceType`/`linkedAccountId` in this
  migration — it only adds the missing `journal`/`journal_entry` rows so §2's "pure projection"
  claim becomes true. Verification (§7) runs after this migration and before 026.

**026 — `026_index_journal_entry_and_ledger_lookup.js`** (performance prerequisite for the view)

- `CREATE INDEX IF NOT EXISTS idx_journal_entry_journalId ON journal_entry(journalId);`
- `CREATE INDEX IF NOT EXISTS idx_journal_entry_accountId ON journal_entry(accountId);`
- `CREATE INDEX IF NOT EXISTS idx_ledger_accountId_date ON ledger(accountId, date, id);` (kept
  temporarily — still needed by the equivalence harness comparing against the still-live table;
  drop it in 029 alongside the table itself).
- `CREATE INDEX IF NOT EXISTS idx_invoice_items_inventoryId ON invoice_items(inventoryId);`
- `CREATE INDEX IF NOT EXISTS idx_invoice_items_invoiceId ON invoice_items(invoiceId);`
- `CREATE INDEX IF NOT EXISTS idx_stock_adjustments_inventoryId ON stock_adjustments(inventoryId);`
  (`inventory_opening_stock.inventoryId` is already indexed via its `UNIQUE` constraint,
  `schema.sql:213`.)

**027 — `027_create_ledger_and_inventory_quantity_views.js`**

- Creates `journal_entry_pairs`, `ledger_lines`, `ledger_view` (§4.1) and
  `inventory_quantity_view` (§5) as plain SQL views (`CREATE VIEW IF NOT EXISTS ...`). Additive
  only — the stored `ledger` table and `inventory.quantity` column are untouched and still the
  source of truth for every service at this point. This migration ships and gets used **only** by
  the equivalence test suite (§7) initially — no service code changes yet.

**028 — service cutover (code change, not a migration)** — see §7 for gating: only proceed once
the equivalence harness passes on every DB in the corpus.

- `LedgerService`'s read queries swap `FROM ledger` → `FROM ledger_view` (a `WHERE` filter on a
  view is native SQL, no service-layer logic change beyond the SQL strings themselves).
- `LedgerService.insertLedger`/`deleteLedger` and `JournalService.insertLedgerEntries` /
  `rebuildLedger*` / `hasNewerEntries` / `removeLedgerEffectOfJournals`'s ledger-rewrite half are
  deleted — the view needs no writes and no rebuilds.
- `InventoryService.getInventory`/`getAllInventory`/`getInventoryQuantity` swap their `quantity`
  column reference to `inventory_quantity_view` (a `LEFT JOIN` on `i.id =
inventory_quantity_view.inventoryId`), and `applyStockAdjustment`/invoice
  post/void/edit stop calling `SQL.updateInventoryQuantity`/`SQL.setInventoryQuantity` — they
  only write `stock_adjustments`/`inventory_opening_stock`/`invoice_items` (already facts) plus
  keep the opening-stock upsert.

**029 — `029_drop_ledger_table_and_inventory_quantity_column.js`** (destructive; ships only after
028 has run in production for at least one full release cycle with no regressions)

- `DROP INDEX idx_ledger_accountId_date; DROP TRIGGER trg_ledger_uuid; DROP INDEX idx_ledger_uuid;
DROP TABLE ledger;` then `CREATE VIEW ledger AS SELECT * FROM ledger_view;` if any external
  tooling/report SQL still references the bare name `ledger` (cheap insurance; drop this
  compatibility view in a later cleanup once confirmed unused).
- `ALTER TABLE inventory DROP COLUMN quantity;` (SQLite ≥3.35, which better-sqlite3 bundles) or,
  if targeting an older bundled SQLite, the copy-rename pattern already used in migration `001.js`
  for `chart`. Also remove `inventory` and `ledger` from migration 024's replicated-table
  assumption (see next bullet) — this is really a **sync-layer config change**, not a schema
  change, but is listed here because it must land in the same release as the `DROP`.
- **Whatever mechanism the eventual sync layer uses to decide "which tables replicate"** must
  exclude `ledger` (dropped entirely — nothing to replicate) and must **not** treat
  `inventory.quantity` specially since it no longer exists as a column; the view recomputes
  locally on every device from the replicated `inventory_opening_stock`/`stock_adjustments`/
  `invoice_items` facts. `uuid`-on-`ledger` (from migration 024) becomes moot once the table is
  gone; `uuid`-on-`inventory` stays, since `inventory` itself (name/price/description) remains a
  real replicated fact table — only its `quantity` column was ever the problem.

---

## 7. Test strategy: equivalence harness

The existing test bootstrap pattern (`src/core/services/__tests__/JournalService.test.ts:37-49`)
already builds a DB from `schema.sql` + every `migrations/*.js` file in numeric order, exactly
matching production bootstrap. The harness reuses this verbatim:

```ts
// scratch: docs/derived-state-design equivalence harness sketch, not shipped code
function buildDbFromRealFile(dbFilePath: string): Database.Database {
  const db = new Database(dbFilePath); // real user DB, opened directly — read-only checks
  MIGRATIONS.forEach((m) => m.up(db)); // idempotent no-ops if already applied; brings any
  // older exported DB up through 027 for the check
  return db;
}

function assertLedgerEquivalence(db: Database.Database) {
  const stored = db
    .prepare(
      `SELECT accountId, date, id, debit, credit, balance, balanceType, linkedAccountId, particulars
     FROM ledger ORDER BY accountId, date, id`,
    )
    .all();
  const computed = db
    .prepare(
      `SELECT accountId, date, entryId AS id, debit, credit, balance, balanceType, linkedAccountId, particulars
     FROM ledger_view ORDER BY accountId, date, orderTiebreak`,
    )
    .all();
  expect(computed.length).toBe(stored.length);
  stored.forEach((row, i) => {
    expect(roundMoney(computed[i].balance)).toBe(roundMoney(row.balance));
    expect(computed[i].balanceType).toBe(row.balanceType);
    expect(computed[i].linkedAccountId).toBe(row.linkedAccountId);
    // debit/credit/particulars compared too — omitted here for brevity
  });
}

function assertInventoryQuantityEquivalence(db: Database.Database) {
  const stored = db
    .prepare(`SELECT id, quantity FROM inventory ORDER BY id`)
    .all();
  const computed = db
    .prepare(
      `SELECT inventoryId AS id, quantity FROM inventory_quantity_view ORDER BY inventoryId`,
    )
    .all();
  const byId = new Map(computed.map((r) => [r.id, r.quantity]));
  stored.forEach((row) => expect(byId.get(row.id)).toBe(row.quantity));
}
```

Gating rule: **every DB in the corpus must pass both assertions with zero mismatches** before
migration 028 (the service cutover) is allowed to merge. Corpus =

1. Every fixture DB already built inline in `src/core/services/__tests__/*.test.ts` (they already
   exercise back-dated journals, multi-line splits, invoice voids/edits, stock adjustments —
   reuse them as-is by running the two assertions above at the end of each existing test, in
   addition to their current assertions).
2. At least one real, non-trivial production-shaped DB — ask the user for an export of an actual
   `database.db` (per `DatabaseService.getPath`, `src/main/services/Database.service.ts:41-60`),
   or synthesize one via `Backup.service.ts`'s restore path if a sanitized sample exists, to catch
   patterns the hand-written fixtures don't hit (e.g. an account that has both a
   `StatementService`-imported opening balance and years of ordinary journals mixed in, or an
   inventory item with a return-after-edit history).
3. A generated adversarial DB: back-dated journals inserted after later ones on the same account
   (exercises `rebuildLedgerFromEntries` in the baseline vs. the view's order-independence),
   an N:1 split journal with an odd number that doesn't divide evenly (rounding), and an item
   whose `stock_adjustments` would take quantity negative if summed in the wrong order (there
   is none — SUM is commutative — but this DB doubles as a check that the _view's_ SUM order
   truly doesn't matter, unlike the JS loop's).

Rounding note: `insertLedgerEntries`'s JS math (`JournalService.ts:450-460`) uses IEEE-754
doubles; the view's `SUM`/`ROUND` will not bit-for-bit match float rounding in every edge case.
Compare with a small epsilon (cents-level, matching `DECIMAL` column intent) rather than exact
equality, and treat any mismatch above that epsilon as a genuine bug to chase down, not a
tolerance to widen.

---

## 8. Service-layer changes, sized

| Change                                                                                                                                                                                                  | File(s)                                                            | Est. hours                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Migration 025: opening-balance ledger → journal backfill + `StatementService.setupLedgers` rewritten to call `journalService.insertJournal` instead of `ledgerService.insertLedger`                     | `migrations/025_*.js`, `StatementService.ts`                       | 4–6                                                                            |
| Migration 026: indexes                                                                                                                                                                                  | `migrations/026_*.js`                                              | 1                                                                              |
| Migration 027: views (§4.1, §5), including getting the proportional-split SQL and window-function sign logic bit-exact                                                                                  | `migrations/027_*.js`                                              | 8–12                                                                           |
| Equivalence harness + wiring into existing test files                                                                                                                                                   | `__tests__/*.test.ts`, new harness module                          | 6–8                                                                            |
| Running harness against real/synthetic corpus, fixing view SQL until green                                                                                                                              | —                                                                  | 4–10 (highest variance item; depends entirely on how close the first draft is) |
| `LedgerService` read-query cutover (`FROM ledger` → `FROM ledger_view`)                                                                                                                                 | `LedgerService.ts`                                                 | 2                                                                              |
| Delete `JournalService` rebuild machinery (`rebuildLedger*`, `hasNewerEntries`, ledger-rewrite half of `removeLedgerEffectOfJournals`, `insertLedgerEntries`)                                           | `JournalService.ts`                                                | 3                                                                              |
| `InventoryService` cutover (`getInventory`/`getInventoryQuantity` join to view; delete `updateInventoryQuantity`/`setInventoryQuantity` call sites)                                                     | `InventoryService.ts`                                              | 3                                                                              |
| `InvoiceService` cutover (delete its own `updateInventoryItem` relative-update calls, keep `invoice_items` writes as-is since they were already facts)                                                  | `InvoiceService.ts`                                                | 2                                                                              |
| Migration 029: drop table/column + compatibility view                                                                                                                                                   | `migrations/029_*.js`                                              | 2                                                                              |
| Regression pass across renderer report views that read ledger/quantity shapes (`LedgerReport`, `AverageEquityBalances`, `AccountBalances`, `TrialBalance`, `Inventory`, `InventoryHealth`, `StockAsOf`) | `src/renderer/views/Reports/**`, `src/renderer/views/Inventory/**` | 4–6                                                                            |
| **Total**                                                                                                                                                                                               |                                                                    | **≈39–53 hours**                                                               |

Not included: whatever the eventual sync/replication layer itself costs — this table only covers
getting `ledger`/`inventory.quantity` off the "stored counter" pattern, which is this document's
scope.

---

## 9. Risks and rollback

**Risks**

- The proportional-split view SQL (§4.1) is new and non-trivial; if it cannot be made bit-exact
  within a reasonable iteration budget, fall back to a rebuild-on-write cache table (same
  `rebuildLedgerFromEntries` function, called unconditionally, `ledger` excluded from whatever the
  sync layer's replica-table list ends up being, recomputed locally after every sync-apply). This
  is strictly less elegant than the view but reuses code that already exists and is already
  tested, so it is the safe fallback, not a redesign.
- `StatementService`'s opening-balance rewrite (migration 025) changes what "Getting Started"
  writes going forward, and backfills history — this touches every existing user's DB that ever
  used that onboarding flow. Needs its own focused test beyond the general equivalence harness:
  confirm the synthesized journal doesn't double-count if the balance-sheet import is re-run
  (the `ChartService.findOrCreateChart`/`AccountService.insertAccountIfNotExists` calls in
  `StatementService.setupLedgers`, lines 107-137, are already idempotent-by-name; the new
  `journal` insert is not idempotent by default and must be guarded, e.g. by checking for an
  existing `journal.narration = 'Opening Balance from B/S' AND journal.date = ...` before
  inserting, mirroring how `journal.invoiceId` already de-duplicates invoice-sourced journals).
- Floating-point rounding differences between the JS proportional-split math and SQL `SUM`/divide
  could produce cent-level mismatches on some historical journals with unusual split ratios —
  the equivalence harness (§7) is designed to surface these before cutover, not after.
- `ALTER TABLE inventory DROP COLUMN quantity` (migration 029) is destructive and irreversible on
  the DB file itself. Take a `Backup.service.ts` snapshot immediately before running 029 in
  production (the app already has a backup mechanism — reuse it, don't build a new one).

**Rollback story**

- Migrations 025–027 are purely additive (backfill + indexes + views) — rolling back means simply
  not shipping the migration 028 service cutover; the app keeps reading/writing `ledger` and
  `inventory.quantity` exactly as today, and the new views sit unused. No destructive step has
  happened yet, so rollback is a no-op revert of the service-layer diff.
- Migration 028 (service cutover) rollback = revert the `LedgerService`/`JournalService`/
  `InventoryService`/`InvoiceService` diffs to read/write the stored table/column again; the
  table and column are still present and still being kept correct by migration-025-era code paths
  restored, so this is a clean revert as long as 029 hasn't shipped yet.
- Migration 029 (the actual `DROP`) is the only irreversible step. Gate it behind: (a) the
  equivalence harness green on the full corpus, (b) migration 028 running in production for at
  least one full release with no user-reported balance/quantity discrepancies, and (c) a fresh
  `Backup.service.ts` snapshot taken immediately before it runs. If problems surface after 029,
  recovery is "restore the pre-029 backup," not "write a reverse migration" — there is no way to
  un-drop a column with data intact, so the backup is the actual rollback mechanism for this step,
  not the migration file.
