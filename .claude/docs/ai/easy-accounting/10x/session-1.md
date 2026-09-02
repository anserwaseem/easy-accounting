# 10x Analysis: Easy Accounting

Session 1 | Date: 2026-08-30

> **Note on sources**: README and USER_MANUAL.md are known to be out of date, so every
> claim below was verified against code (`src/main/services/`, `src/renderer/views/`,
> migrations, schema), not docs. See "Corrections after code verification" at the end.

## Current Value

Easy Accounting is an **offline-first, double-entry accounting desktop app** (Electron + React + better-sqlite3) for a small trading/publishing business — the inventory carries Urdu book attributes, invoices carry bilty numbers and cartons, and discount profiles apply per item type. It is clearly built around one real business's daily flow, which is its greatest strength: it does exactly what the operator needs, fast, with no internet required.

**What exists today** (from `src/main/services/` and `src/renderer/views/`):

- Chart of accounts, ledgers, manual journals with strict double-entry (`Journal.service`, `Ledger.service`)
- Sale/purchase invoices with edit, returns, quotations (and quotation → invoice conversion), printing to PDF (`Invoice.service`, `Print.service`)
- Inventory with attributes, price lists, bulk edit, opening stock, stock adjustments (`Inventory.service`, migrations 014–022)
- Catalog publishing with public/private attribute control, image manifests, publish blockers (`Publish.service`)
- Reports: Trial Balance, Account Balances, Ledger Report (with date range, export, print totals), Bills Aging, Inventory Health, Stock As Of, Sales Performance, Average Equity Balances
- Balance sheet **import** from Excel (`Statement.service.saveBalanceSheet`)
- Cloud backup to Supabase per machine (`Backup.service`), with a native Backup menu (create/list/show folder in `menu.ts`) and progress toasts (`BackupToastListener`)
- Company profile + invoice print settings (`Settings/index.tsx`, `useCompanyProfile`, `useInvoicePrintSettings`) and per-account pricing/discount tools (`Accounts/AccountPricing`)
- Dashboard with Cash Flow + Financial Overview
- Strong keyboard-first data entry culture (Enter appends invoice rows, focus management PR #125)

**The core loop**: create invoices → stock and ledgers update → check ledgers/aging → print/export.

## The Question

What would make this 10x more valuable — not for a hypothetical market, but first for the business running it every day, and then for the thousands of similar SMEs (Pakistan-style B2B trading: credit sales, recoveries, WhatsApp, cheques) that current cloud accounting products serve badly?

---

## Massive Opportunities

### 1. The catalog becomes an order channel (Catalog → Orders → Draft Invoices)

**What**: The published catalog (`Publish.service` already generates public JSON + CSV with public price list and public attributes) grows a "place order" flow: a customer browses the published catalog, builds a cart, and submits. The order lands in the app as a **draft sale invoice** against their account, priced from their price list/discount profile, waiting for one keystroke to confirm.
**Why 10x**: This flips the product from _recording_ business to _bringing in_ business. Every order that arrives digitally is an invoice you didn't have to type — and the data model is already 90% there: accounts, price lists per customer purpose, discount profiles per item type, quotations as draft invoices (`isQuotation`). The missing piece is just a submission channel (even a WhatsApp message with a structured order, or a tiny hosted form posting to Supabase, which the app already talks to).
**Unlocks**: Customers self-serve on current stock and prices; order entry time goes to ~zero; the catalog stops being a brochure and becomes the top of the funnel.
**Effort**: High (needs a hosted endpoint + order inbox UI, but reuses catalog, quotations, pricing)
**Risk**: Customers may not adopt a portal; mitigate by making WhatsApp the front door (share catalog link, accept orders as pre-filled links).
**Score**: 🔥

### 2. Companion read-only mobile view (owner's pocket dashboard)

**What**: A minimal mobile/web view — receivables by customer, today's sales, stock of a given item, a customer's ledger — fed by the existing Supabase backup pipe (upload a small JSON snapshot alongside the DB backup).
**Why 10x**: The single most common SME owner question is asked _away from the desk_: "what's this customer's balance?" while on the phone with them. Today the answer requires the one PC the app runs on. `Backup.service` already ships the whole DB to Supabase; shipping a queryable snapshot is a small delta for a category change: the business in your pocket.
**Unlocks**: Multi-device without solving true sync; owner/salesman split (desk operator enters, owner checks anywhere).
**Effort**: High (new surface, auth story) — but read-only sidesteps sync conflicts entirely.
**Risk**: Security of financial data in the cloud; needs real auth, not the anon key.
**Score**: 🔥

### 3. Natural-language entry assistant ("received 50,000 from Ali Traders in bank")

**What**: A single input box that turns a sentence into a _proposed_ journal entry or payment receipt — accounts matched from the chart, debit/credit worked out, shown for confirmation before posting. Local matching first (account name fuzzy match + templates for the 6 recurring transaction shapes: receipt, payment, expense, cheque, discount, return); an LLM only as fallback.
**Why 10x**: Double-entry is the app's power and its biggest usability tax — every non-accountant operator has to think "which side is the debit?" The templates for a trading business are so repetitive that 90% of manual journals are one of a handful of shapes. This turns the scariest screen into the easiest one.
**Effort**: High for LLM path, **Medium if built as transaction templates first** (see Medium #3 — do that first, this grows out of it).
**Risk**: Wrong postings erode trust — hence always propose, never auto-post.
**Score**: 👍

### 4. Multi-company / multi-year books

**What**: Multiple database files (one per company or fiscal year) with a switcher, plus a year-end close that rolls balances into opening entries for a new file.
**Why 10x**: Every business that survives needs year N+1; every accountant serving SMEs needs company N+1. Right now there is one `database.db` per machine forever, and the ledger grows unboundedly. This is what turns "an app for one business" into "an app an accountant installs for every client."
**Effort**: Medium-High (DB path indirection in `Database.service`, close-year routine in `Statement.service`)
**Risk**: Migration complexity across files; version skew between files.
**Score**: 👍

---

## Medium Opportunities

### 1. Receive Payment / Make Payment flow (against invoices)

**What**: A first-class "Receive Payment" screen: pick customer → see open invoices (data already powering Bills Aging) → enter amount + mode (cash/bank/cheque) → allocate across invoices → posting happens automatically.
**Why 10x**: This is the **highest-leverage gap in the product**. The app models the sale side of credit business beautifully (invoices, aging, ledgers) but recording the _recovery_ — the thing a credit-sales business does every single day — is a raw manual journal today. The code itself shows the cost: `useBillsAging.ts` has to _reconstruct_ bills and receipts by regex-matching `"Journal #(\d+)"` out of ledger `particulars` strings and FIFO-allocating credits against debits — a fragile inference of facts the operator knew at entry time and had nowhere to record. A real payment flow with an allocation table replaces ~200 lines of reconstruction heuristics with ground truth.
**Impact**: Daily task goes from "compose a journal, get the sides right, hope aging picks it up" to three clicks; aging stops being inferred and becomes recorded fact (partial payments, disputed bills, and non-FIFO allocations all become expressible).
**Effort**: Medium (UI + one posting routine; allocation table `invoice_payments` is a small migration; Bills Aging then reads it directly)
**Score**: 🔥

### 2. Generate the financial statements (P&L + Balance Sheet as reports)

**What**: An **Income Statement** and a **Balance Sheet** report generated from the ledger for any period — the two documents every bank, tax filing, and owner conversation asks for. Today the app can _import_ a balance sheet (`Statement.service.saveBalanceSheet`) but cannot _produce_ one; Trial Balance is as close as it gets.
**Why 10x**: An accounting app that can't print its own financial statements outsources its final deliverable to Excel. All the data exists; migration 001 already added Revenue/Expense heads. This is the difference between "bookkeeping tool" and "accounting software" — and it's mostly aggregation over queries that already exist for Trial Balance.
**Impact**: The year-end scramble disappears; monthly P&L becomes a habit instead of a project.
**Effort**: Medium
**Score**: 🔥

### 3. Transaction templates ("Recovery", "Expense", "Cheque deposited"…)

**What**: Named, reusable journal shapes with blanks — pick "Customer recovery via bank", fill customer + amount, done. User-definable, seeded with the standard trading-business set.
**Why 10x**: 90% of manual journals in this kind of business are one of ~6 shapes. Templates make the journal screen operator-proof, and they are the stepping stone to the NL assistant (Massive #3).
**Impact**: Journal entry time and error rate collapse; new staff onboard in minutes.
**Effort**: Low-Medium
**Score**: 🔥

### 4. Customer statement — one click, WhatsApp-ready

**What**: From any account: "Statement" → clean PDF of the period's transactions + closing balance (Ledger Report already computes all of this) → saved with a share-friendly filename, or straight into a WhatsApp share.
**Why 10x**: In this market the account statement _is_ the collections tool — it's what you send when you want to be paid. The data and even the print path (`Print.service`) exist; what's missing is a customer-facing skin and the one-click ritual. Combine with Bills Aging: "send statements to everyone over 60 days" becomes one action.
**Impact**: Collections get faster; the app becomes the thing that gets you paid, not just the thing that records it.
**Effort**: Low-Medium
**Score**: 🔥

### 5. Post-dated cheque tracking

**What**: Record cheques received/issued with due dates; a "cheques maturing this week" view; one click to convert a matured cheque into its posting (deposit/clear/bounce).
**Why 10x**: PDCs are the backbone of B2B credit in this market and they live in a drawer or a diary today. This is memory the business already trusts software to hold — and a bounced cheque untracked is real money lost.
**Impact**: Zero missed deposits; the weekly cash picture becomes forward-looking.
**Effort**: Medium
**Score**: 👍

### 6. Period lock + audit safety

**What**: Lock entries before a chosen date (month/year close); show who/when on every posting (single-user today, but `createdAt` exists everywhere); an explicit reversal flow instead of edits for locked periods.
**Why 10x**: Trust. The moment a second person touches the books — or the first tax filing happens — "could anything have changed since?" becomes the question. Cheap to build now, impossible to retrofit trust later.
**Effort**: Low-Medium
**Score**: 👍

---

## Small Gems

### 1. Global search (Ctrl+K) across accounts, invoices, items

**What**: One palette: type anything → jump to the account ledger, invoice, or inventory item.
**Why powerful**: The app already loves keyboards (PR #125). Every lookup today is navigate → page → search-in-page. This makes the whole app feel instant and is pure recall of data already indexed.
**Effort**: Low
**Score**: 🔥

### 2. Customer balance + overdue flag inside New Invoice

**What**: While creating a sale invoice, show the selected account's current balance and days-overdue right next to the account picker.
**Why powerful**: The exact moment credit risk is created is the moment the operator can't see it. One query (already written for Bills Aging), one line of UI — prevents real losses.
**Effort**: Low
**Score**: 🔥

### 3. Duplicate invoice / "same as last time"

**What**: One button on any invoice: copy items and quantities into a new draft at today's prices.
**Why powerful**: Repeat orders are the rhythm of a trading business; re-typing 30 line items to re-order is the single most annoying recurring chore the app has.
**Effort**: Low
**Score**: 🔥

### 4. Backup staleness indicator

**What**: A small always-visible status in the sidebar: "Backed up 2h ago ✓" / amber when stale, red when failing or offline; click to back up now.
**Why powerful**: The entire business lives in one SQLite file on one disk. Backup already has a native menu (`menu.ts`: Create Backup, list, show folder) and progress toasts — what's missing is the _passive_ signal: the menu only answers when asked, and a toast only fires during an operation. Staleness is precisely the state nobody asks about. One persistent indicator converts silent risk into calm.
**Effort**: Low (last-backup timestamp is already derivable from `listBackups()`)
**Score**: 🔥

### 5. Low-stock / reorder alerts on the dashboard

**What**: Reorder level per item (or inferred from sales velocity — Sales Performance report already computes it); dashboard card: "5 items below reorder level."
**Why powerful**: Inventory Health exists but must be _visited_. Stockouts of fast movers are pure lost revenue; surfacing them is a query away.
**Effort**: Low
**Score**: 👍

### 6. Print → Share (WhatsApp) for invoices

**What**: Next to Print: "Save PDF & Share" — writes the PDF with a clean name (`INV-1023 Ali Traders.pdf`) and opens the share target / reveals in folder.
**Why powerful**: The real-world next step after printing is almost always "send it on WhatsApp." Today that's print → find file → rename → attach.
**Effort**: Low
**Score**: 👍

### 7. Keyboard shortcut overlay (?)

**What**: Press `?` anywhere → cheat sheet of the shortcuts that already exist.
**Why powerful**: PR #125 built real shortcut depth that only its author knows about. Discovery is the only missing feature.
**Effort**: Trivial
**Score**: 👍

---

## Recommended Priority

_(Revised 2026-08-30 after owner's answers — see "What the answers change" below.)_

### Do Now (quick wins, ship this month)

1. **Customer group view** — Why: a customer is N split accounts (`name-itemType`); every order confirmation today hand-picks them in Bills Aging. Auto-group by customer, show combined exposure + days-to-clear in one click. Impact: minutes → seconds on _every single order_.
2. **Receive Payment flow (bank + cash)** — Why: biggest daily pain on the recovery side; replaces aging's regex/FIFO reconstruction with recorded fact.
3. **Global search (Ctrl+K)** — Why: hours saved across every session; cmdk primitives already in the codebase.
4. **Customer balance in New Invoice** + **Duplicate invoice** — Why: two low-effort changes at the exact center of the core loop.
5. **Backup staleness indicator** — Why: one label that protects the whole business.

### Do Next (high leverage, this quarter)

1. **The Order Desk** — Why: the WhatsApp-order → credit-check → discount-negotiation → invoice ritual is the business's true center and is spread across three screens today. One screen: credit snapshot beside the order, confirm/counter/reject, confirm → draft invoice → print + cartons. Unlocks: order turnaround in one sitting; judgment backed by data instead of memory.
2. **P&L + Balance Sheet reports** — Why: completes the accounting story; bank/tax deliverables come _from_ the app.
3. **Customer statement one-click + share** — Why: turns the ledger into a collections tool; pairs with the agent relationship (statements per customer group, sent via the agent).
4. **Transaction templates** — Why: operator-proofs journals; stepping stone to the NL assistant.

### Explore (strategic bets)

1. **Agent order channel** — Risk: agent adoption; Upside: agents submit structured orders (shared link/form pre-filled from the catalog + customer's price list) that land directly in the Order Desk. The public-portal variant is superseded — the orders come from agents.
2. **Companion mobile read-only view** — Risk: cloud security story; Upside: the owner's pocket dashboard (credit snapshots on the phone, where the agent conversation happens), without solving sync.

### Backlog (good, not now)

1. NL entry assistant — build templates first, learn the shapes, then automate them.
2. Post-dated cheque tracking — recoveries are mostly bank/cash today; revisit if cheques grow.
3. Multi-company / year-close — single business for now; year-close alone may return at FY boundaries.
4. Tax fields (GST/withholding) — wait until statements exist.
5. Urdu/localized UI — premature before anyone beyond the first business runs it.

---

## Questions

### Answered

- **Q**: Is there already a way to record payments against invoices? **A**: No dedicated flow — Bills Aging reads open balances, but payment entry is a manual journal (`Journal.service`); no `invoice_payments`/allocation table exists in schema or migrations 001–023.
- **Q**: Can the app produce a balance sheet? **A**: Only import one (`Statement.service.saveBalanceSheet`); no generated P&L or balance sheet report exists under `src/renderer/views/Reports/`.
- **Q**: Is there cloud infrastructure to build on? **A**: Yes — Supabase backups per machine (`Backup.service`) and a catalog publishing pipeline (`Publish.service`), both reusable for orders/mobile snapshots.

### Blockers — ANSWERED (owner, 2026-08-30)

- **Q**: How do orders arrive today? **A**: Mostly WhatsApp, from **sales agents** on behalf of their clients (direct customer calls are rare). Each order is manually confirmed from Bills Aging: select the agent's head → date range 1/1/25–today → multi-select **all accounts of the customer**, where a customer is split into accounts named `${name}-${itemTypeName1..N}` (one per item type, because discounts differ per type). If the customer is slow clearing overdues, the concern goes back to the agent — reduce the offered discount, reject, or chase missing items — and only then is the sale invoice created, printed, and packed with cartons.
- **Q**: Are recoveries mostly cash, bank, or cheques? **A**: Mostly **bank and cash**. → Payment flow ships with bank/cash modes first; PDC tracking drops out of "Do Next".
- **Q**: Anyone beyond the first business running this? **A**: **No.** → Polish the daily loop; multi-company, localization, and docs-as-distribution move to backlog.

### What the answers change

1. **The order-confirmation ritual is the product's true center, and it's unmodeled.** Every order triggers: WhatsApp message → Bills Aging → agent head → date range → hand-picking a customer's split accounts → judgment call on payment habit → discount negotiation with the agent → new invoice → print → pack. Three screens, several minutes, and the crucial judgment ("how does this customer pay?") lives in the operator's head. Two features fall straight out of this:
   - **Customer group as a first-class concept** (small-medium): auto-group the `${name}-${itemType}` split accounts under one customer; one click anywhere shows combined exposure. Kills the multi-select ritual instantly. The `useBillsAging` days-to-clear computation already produces the "payment habit" number worth surfacing per customer.
   - **The Order Desk** (medium, new 🔥): one screen per incoming order — customer credit snapshot (total outstanding across all their accounts, oldest unpaid bill, average days-to-clear, last receipts) beside the requested items and offered discount; actions: _confirm_ (→ draft invoice, priced by discount profile), _counter_ (reduced discount, one message back to the agent), _reject_. The invoice + carton print step already exists. This is the catalog→orders bet landed where the orders actually are: with agents, not end customers.
2. **Receive Payment flow**: unchanged at #1, now scoped to bank + cash modes first.
3. **Demoted**: PDC tracking (🤔, revisit if cheques grow), multi-company/year-close (backlog — single business, though year-close alone may return for FY boundaries), catalog public portal (superseded by agent-facing Order Desk).

## Addendum: verified against the shop's real database (2026-08-28 backup)

The owner challenged the "customer group view" idea ("the system already does `${name}-${itemType}`, it must know!") and provided the production DB. Findings:

**Scale**: 1,313 accounts under 7 agent heads (custom chart heads with `parentId` → Current Asset; the largest agent head carries 833 accounts), 12,359 invoices (~30–60 sale invoices/month recently), 113,927 invoice items (avg 10.4/invoice), 2,752 journals, 870 discount profiles (≈ one per customer-account), 3 item types.

**Does the system know the grouping? It knows the _convention_, not the _fact_ — in exactly one place.** `partyAccountTyping.ts` (New Invoice split-by-type) detects item-type-suffixed accounts and resolves typed↔base by string matching at runtime, name first, code prefix as fallback. Three problems, all confirmed in the data (customer specifics kept out of the repo; see the session conversation):

1. **215 shop names exist more than once** across cities — one name appears as 14 separate accounts in ~8 cities. `findBasePartyRowForSingleAccountId` matches **by name first** (`baseParties.find(name === base)`) — for those 215 names it can bind a typed account in one city to the base account of a same-named customer in another. Latent wrong-customer risk inside split invoice resolution.
2. **The code fallback breaks on inconsistent code spellings**: base and typed accounts of the same customer carry differently abbreviated/cased city prefixes, and some codes embed spaces.
3. **Bills Aging contains none of this logic** (zero references) — which is exactly why the multi-select ritual exists. The knowledge lives where invoices are created, not where the credit decision is made.

Sample proving the split is real: one customer's base account holds 3 invoice headers but has **no ledger entries at all**; its typed account carries the whole ledger — outstanding balance, all 9 receipts. Either account alone shows half the customer.

**Revised recommendation (replaces "customer group view" as pitched):** don't build a new manual grouping UI — **promote the convention the app already half-knows into a stored fact**. Add `customerGroupId` to `account`, seed it automatically from code-prefix matching, and show a one-time review screen for the ambiguous cases (the 215 colliding names). Then reuse the stored grouping in Bills Aging (auto-select a customer's accounts), New Invoice (fixing the name-first mis-binding risk as a side effect), statements, and the future Order Desk. Roughly a day of migration + seeding logic, and it hardens an existing correctness risk rather than adding a feature.

**Receipt-shaped journals** (credit to an agent-head party, debit to a cash-in-hand or bank account): 3–14/month detected by heuristic, against 99–289 total journals/month — consistent with recoveries flowing through manual journals and with bank/cash as the modes.

**Imported history is inert — one migration activates ~18 years of it.** Owner's clarification: invoices older than early 2026 were imported, without journal/ledger entries (pre-history reaches aging only as opening balances — so payment-habit metrics have ~2026-onward depth, which is fine for the Order Desk). But the import also left **11,846 of 12,359 invoices (96%) with `MM/DD/YYYY` string dates** (system-generated ones are ISO). Every date filter in the services compares strings (`i.date >= ?`), and `'01/01/2008' < '2026-…'` lexically, so imported invoices sit below any ISO bound:

- Sales Performance silently starts at Jan 2026 — the 2008–2025 sales history (most of the 113k invoice items) is invisible to it.
- `MAX(i.date)` last-sold values are wrong for items only sold pre-import (month-first string order ≠ chronology), so Inventory Health's dead-stock signal can mislabel.
- Stock As Of's rollback (`CASE WHEN i.date > ?`) never sees imported invoices as "after" any date — wrong for pre-2026 as-of dates.

→ **New Do-Now item: a one-off date-normalization migration** (`MM/DD/YYYY` → ISO). Low effort; fixes last-sold/dead-stock and as-of correctness, and turns ~18 years of imported sales history into usable analytics — seasonality per item and per customer that the book trade runs on.

## Owner corrections, round 3 (2026-08-31)

1. **A web version is already being built** (`anserwaseem/easy-accounting-web`). The "companion read-only mobile view" bet is therefore already in motion. Refined recommendation: sequence the web app to ship the **read-only slices first** — customer-group credit snapshot, stock lookup, ledger view — since that's the highest-value use (answering "what's this customer's balance?" away from the desk) and needs no write-path/sync work.
2. **No agent-facing portal is viable**: agents have limited English and send orders as pen-on-paper photos over WhatsApp. The "agent order channel" bet is dropped. Order intake stays operator-typed; a cheap improvement is attaching the WhatsApp order photo to the order/invoice record so the source rides along. (Handwritten-Urdu OCR intake is a long shot — noted, not recommended.)
3. **Order Desk framing corrected**: the payment schedule isn't kept in anyone's head — Bills Aging provides it fully once assembled. The desk's real value is narrower and still real: the snapshot arrives **with the order** instead of being assembled per-order; pending orders become a queue instead of WhatsApp scrollback; counter/reject decisions are recorded (today they live only in chat); confirm becomes the invoice without retyping items.
4. **Allocation is a business rule, not a guess**: receipts always clear the **oldest bill first**. So Receive Payment needs no manual allocation UI — pick customer group, amount, mode (bank/cash) → system allocates oldest-first automatically and _stores_ the allocation rows, making explicit what aging currently re-derives. Open design question: oldest-first **per account** or **across the customer's split accounts** — decide before the migration.

## Owner challenges, round 4 (2026-08-31) — data-verified

1. **Receive Payment: DEFERRED, data agrees.** Owner's hypothesis: recoveries land as one big journal at the end of each agent's tour. Confirmed in the DB: seven monthly "tour concluded" journals (Jan–Jul 2026), 95–143 entries each — one debit to the agent's "Received From" account, ~90–140 credit lines to individual customers. Journals routed through cash/bank credit only 2–3 customers each. A per-customer Receive Payment screen would be _slower_ than the current single batch journal. If this ever gets built, the right shape is a **tour-settlement grid** (customer+amount rows auto-balanced against the agent account) — but the journal screen already effectively is that grid (its performance was even optimized in PR #139). Residual cost of deferring: aging keeps reconstructing allocation by regex+FIFO — which works and matches the business rule.
2. **P&L: blocked on costing — owner is right.** The revenue side exists (603 of 666 invoice journals credit Revenue; the 'Sale' account carries ~80M Cr), but there is no cost layer: no per-item purchase cost tracking, so no COGS, so no gross profit. The DB even shows the workaround: a manually posted 'Profit & Loss A/c 31.12.25' account — the P&L is being computed outside the system and imported once a year. → P&L (and a self-balancing Balance Sheet, which needs retained earnings) moves behind a new prerequisite: **inventory costing**. That reframes costing as the real strategic bet: weighted-average cost from purchase invoices → COGS per sale → margin per item, per customer, per agent tour. For a trading business, "which items and customers actually make money" is the 10x question the current system cannot answer. Caveat: opening costs for imported stock would need estimating.
3. **Order Desk: DROPPED** — owner's judgment accepted. At 1–3 orders/day, with aging already providing the assembled answer, the build cost outweighs the queue/record-keeping gain.

**Surviving priority list after four rounds:**

- **Do Now**: stored customer grouping · date normalization migration · Ctrl+K · balance-in-New-Invoice + duplicate invoice · backup staleness indicator
- **Do Next**: one-click customer statement (share-ready) · web app read-only slices first
- **Strategic**: inventory costing → then P&L/Balance Sheet → then margin analytics (per item / customer / tour)
- **Dropped/deferred**: Receive Payment (batch reality), Order Desk, agent portal, PDC tracking, multi-company

## Next Steps

- [ ] Validate: count how many manual journals are payment-shaped in the real DB (confirms Receive Payment as #1).
- [ ] Research: smallest viable order-submission channel (WhatsApp deep links vs. tiny Supabase-hosted form).
- [ ] Decide: whether Revenue/Expense heads are populated enough in real data to generate a P&L today, or need a chart cleanup first.

---

## Corrections after code verification (docs are stale)

Claims checked against code because README/USER_MANUAL are out of date:

- **Confirmed — no payment flow**: no `invoice_payments`/allocation table anywhere in schema or migrations 001–023; Bills Aging reconstructs receipts from ledger entries via `particulars.match(/Journal #(\d+)/)` + FIFO (`useBillsAging.ts:203`). Recommendation #1 stands, strengthened.
- **Confirmed — no P&L / generated balance sheet**: zero hits for income statement / profit-and-loss / `getBalanceSheet` in `src/`; `Statement.service` only imports.
- **Confirmed — no global command palette**: `cmdk` primitives exist (`shad/ui/command.tsx`) but are only used inside `multiSelect`; no app-wide Ctrl+K. The primitive being present makes the gem even cheaper.
- **Confirmed — no duplicate-invoice action**: all "duplicate" hits are inventory name-collision checks.
- **Corrected — backup is not invisible**: native Backup menu + toasts exist; the gap is narrowed to a _staleness_ indicator (gem #4 reworded).
- **Beyond the docs**: company profile + invoice print settings and per-account pricing/discount tooling (`Accounts/AccountPricing`) exist undocumented. Worth noting: keeping USER_MANUAL.md current is itself cheap leverage now — the manual is the distribution artifact if the app ever goes beyond the first business, and features nobody can discover (the manual doesn't mention quotations, returns, reports, backups, or settings at all) are features that don't exist to a new user.
