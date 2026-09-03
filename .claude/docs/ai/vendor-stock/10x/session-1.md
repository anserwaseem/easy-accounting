# 10x Analysis: Vendor Stock / WIP Tracking

Session 1 | Date: 2026-09-03

> **Sources**: code on `cursor/vendor-stock-tracking-e7ef` (`VendorStock.service.ts`, UI under `src/renderer/views/VendorStock/`, report, migration `025.js`, `Invoice.service` purchase hooks, account opt-in). Not docs — `USER_MANUAL.md` has zero coverage.

## Current Value

**Problem it solves today**: track quantity of goods sitting at a binder/printer/vendor (WIP) without treating that location as warehouse stock. Operator can send materials, see on-hand at vendor, and have purchases from that vendor auto-reduce the shadow qty — then bill/reconcile via an activity report.

**Who**: desk operator + owner reconciling what is still at a tracked vendor vs what came back as purchase invoices. Opt-in per account so consignment-return agents (same purchase invoice type) do not pollute WIP.

**Core action**: Send to vendor → later post purchase from that vendor → closing qty = opening + issued − purchased (± returns/adjustments).

**Where time goes**: opening import, sends list, purchase posting (toast feedback), activity report for period close.

---

## 1. What Exists Today

### Schema / migration (`src/main/migrations/025.js`, mirrored in `src/sql/schema.sql`)

| Piece | Role |
| --- | --- |
| `account.tracksVendorStock` | Opt-in flag (default 0) |
| `vendor_stock` | On-hand shadow qty PK `(vendorAccountId, inventoryId)` |
| `vendor_issues` + `vendor_issue_items` | Documented “sends” with `issueNumber` |
| `vendor_stock_movements` | Append-only ledger: `opening`, `issue`, `purchase`, `purchase_return`, `adjustment` |

Timestamps via triggers (same pattern as rest of app).

**Merge risk**: another branch (`0639a4c`) also claimed migration **025** for `customer_groups`. This branch’s `025_vendor_stock` will collide on merge — renumber one before ship.

### Service (`src/main/services/VendorStock.service.ts` ~890 LOC)

- `getOnHand` / `getTrackedVendorAccounts`
- `setOpeningStock` (single vendor) + `importOpeningStock` (multi-vendor by code/name)
- Issue CRUD: `createIssue`, `updateIssue`, `deleteIssue`, `getIssues`, `getIssue`, `getNextIssueNumber`
- `applyPurchaseEffect` — called from `Invoice.service` inside existing txn; skips untracked accounts; **allows negative qty**; returns toast strings
- `getActivity` — period opening / issued / purchased / purchaseReturned / adjusted / closing

**Explicit non-goal (tested)**: issues do **not** change `inventory.quantity` (warehouse).

### Invoice hooks (`src/main/services/Invoice.service.ts`)

Applied on posted **Purchase** only (not quotations until convert):

- insert / convert quotation → `purchase`
- update → reverse old lines as `purchase_return`, then re-apply as `purchase`
- return / delete path → `purchase_return` via `applyVendorStockFromStoredLines`

Lines built from `singleAccountId` or per-line `multipleAccountIds` (`buildVendorStockLinesFromInvoice`).

### UI routes (`src/renderer/routes.tsx`)

| Route | Screen |
| --- | --- |
| `/vendor-stock` | On-hand + sends list + opening import (`VendorStock/index.tsx`) |
| `/vendor-stock/issues/new` | Create send (`NewVendorIssue.tsx`) |
| `/vendor-stock/issues/:id/edit` | Edit send (same component) |
| `/reports/vendor-stock-activity` | Activity report |

### Account opt-in

- Checkbox: “Track stock at vendor (WIP)” + help text distinguishing WIP locations vs consignment agents (`Accounts/accountForm.tsx`)
- WIP badge on account list cells (`Accounts/index.tsx`)
- Persisted via `Account.service` insert/update/select

### Purchase UX

- Party options annotated `· WIP` when flag set
- Banner when selected vendor tracks stock
- Post-save / convert toasts: “At vendor stock” with qty deltas + negative warnings (`NewInvoice/index.tsx`, `invoiceDetails.tsx`)

### Sidebar / shortcuts

- Nav row “Vendor Stock” + plus → new send; shortcut **4** (`Sidebar.tsx`, `useAppNavigationShortcuts.ts`)
- Reports hub card: “At-vendor activity”

### Opening import

- Excel/CSV preview → confirm (`ImportVendorOpeningStock.tsx`, `parseVendorOpeningStock`)
- Columns: `vendor_code`|`vendor_name`, item `name`, `quantity`
- Optional “reset others to 0” per vendor in file

### Edit / delete sends

- Full rewrite on update (clear stock + movements for issue, re-insert)
- Delete reverses qty, removes issue + issue movements; confirm dialog

### Tests

- `VendorStock.service.test.ts`: issue vs warehouse, purchase skip untracked, return, activity math, reject untracked issue, update/delete rewrite
- Migrations suite expects `025_vendor_stock` tables/column

---

## 2. Friction / Incomplete Edges

### Model gaps (product-critical)

1. **No warehouse-out on send**  
   By design shadow ledger. Physical warehouse and “at vendor” can both claim the same units. Operator must remember a separate stock adjustment — or accept double-counting. Copy repeats “warehouse unchanged” so users know; the *workflow* is incomplete for true location tracking.

2. **No material → finished mapping**  
   Issue and purchase decrement/increment the **same `inventoryId`**. Print-shop reality: send paper/board, receive bound books (different SKUs). Closing qty only reconciles if WIP is tracked in finished-good units (or materials never purchased as different items). This is the largest conceptual hole.

3. **No conversion / scrap / yield**  
   `adjustment` exists in CHECK constraint and activity bucketing, but **no API/UI** creates `adjustment` movements (in-range `opening` is stuffed into `adjusted`). Cannot record wastage, partial return of unused material, or unit conversion.

### UI gaps

4. **No movement drill-down**  
   Activity report is item totals only. Cannot click “Received via purchase” → invoices, or “Issued” → sends. Billing disputes need SQLite or memory.

5. **No on-hand → activity / invoice deep links**  
   Vendor Stock page and report are siloed; on-hand negatives only color red.

6. **Issue form is bare**  
   No current vendor on-hand, no warehouse qty, no recent purchases for that vendor/item, no print/PDF for a send, no view-only detail route (edit only).

7. **No manual adjust UI**  
   Fixes go through re-import opening (absolute set) or edit/delete sends — blunt instruments once purchases exist.

8. **Disabling opt-in is silent**  
   Unchecking `tracksVendorStock` leaves orphan `vendor_stock` rows; future purchases stop decrementing; no warning, no freeze, no archive.

9. **Opening re-import history noise**  
   Absolute set writes a delta `opening` movement when qty changes; prior openings remain. Activity “Adjusted” can absorb in-range openings — confusing vs true adjustments.

10. **Invoice edit movement noise**  
    Edit does not delete prior `referenceType=invoice` movements; it appends `purchase_return` then new `purchase`. Qty correct; forensic trail messy; no idempotent rewrite like issues get.

11. **Activity print is ad-hoc `window.open`**  
    Other reports prefer hidden iframe + `print:hidden` parity; this one diverges (`VendorStockActivity/index.tsx`).

12. **`setVendorOpeningStock` IPC unused by UI**  
    Only multi-vendor file import is exposed; single-vendor API is dead weight for now.

### Backend edges

13. Negatives allowed on purpose (purchase can drive below zero) — good for catching missing sends, bad if unchecked until toast.
14. Purchase quotations correctly skip until convert — good.
15. No inventory / journal / ledger side effects — intentional, but means WIP has **zero accounting presence** (no asset reclass, no COGS timing).

---

## 3. Integration Map

| Domain | Integration | Verdict |
| --- | --- | --- |
| **Purchase invoices** | Auto ± vendor qty when party flagged; toasts; WIP banner | Strong (core loop) |
| **Sale invoices** | None | Expected |
| **Quotations** | Deferred until convert | Correct |
| **Warehouse inventory** | Explicitly untouched on issue; purchase still increases warehouse as usual | Shadow only — dual books risk |
| **Journals / ledger** | None | WIP invisible to GL |
| **Inventory UI / attributes** | None | Cannot see “also at vendor X” on item |
| **Stock adjustments** | Unrelated table | No bridge |
| **Reports** | Dedicated activity + Purchases by Vendor (sibling, money/qty bought, not WIP) | Partial |
| **Sidebar** | First-class nav + shortcut 4 | Present |
| **Accounts** | Flag + badge + form copy | Present |
| **Print / PDF** | Activity Excel + crude print; no send print | Thin |
| **USER_MANUAL** | Missing | Gap |

---

## 4. Copy / Terminology Inconsistencies

Intentional dual language (user “Send” vs code “Issue”) is half-polished:

| Surface | Wording |
| --- | --- |
| Sidebar / button / toasts | **Send to vendor**, **Send #N** |
| Routes / types / SQL / IPC | `vendor-stock/issues`, `VendorIssue*`, `vendor_issues`, `createVendorIssue` |
| Aria-labels on list actions | still say **“Edit issue #…”** / **“Delete issue #…”** |
| Report column | **Issued** (not “Sent”) |
| Page title | **Vendor Stock** |
| Report title | **At-vendor activity** |
| Toast title | **At vendor stock** |
| Account flag | **Track stock at vendor (WIP)** |
| Purchase party suffix | **· WIP** |
| Badge | **WIP** |
| Opening CTA | **Set starting qty** (not “Opening stock”) |
| Types comment | “shadow qty” |

**WIP** is overloaded: manufacturing work-in-process vs “goods at vendor location.” Help text on the account form is the only place that explains the agent/consignment exclusion.

**Received via purchase** is clearer than raw “Purchased,” but activity still says **Issued** next to UI **Sends**.

---

## 5. Overbuilt vs Underbuilt

### Overbuilt (for current job)

- Full **document model** (header + lines + numbered issues) *plus* a **parallel movement ledger** — necessary for audit, but edit/delete of issues rewrite movements while invoice path only appends compensating rows (inconsistent sophistication).
- Movement type **`adjustment`** with no writer.
- Single-vendor `setOpeningStock` + IPC with no UI.
- ~2.7k-line first feature commit surface area (service + 3 screens + report + invoice plumbing + parser + migration + tests) for a shadow qty counter that still cannot model material→finished.

### Underbuilt (for the real WIP job)

- Warehouse transfer (or explicit “does not leave warehouse” vs “ships out”) choice
- Material/finished conversion or BOM yield
- Movement-level drill-down and invoice/send links
- Manual adjust + scrap
- Inventory page visibility (“qty at vendors”)
- Opt-in disable / orphan cleanup
- User manual / onboarding for the agent-vs-WIP purchase trap
- Cross-check report: vendor closing vs sum of open sends − purchases (sanity)

### Right-sized

- Account opt-in (protects consignment purchase misuse) — high-leverage, correctly skeptical of purchase-invoice dual meaning
- Purchase auto-decrement + negative warnings — closes the billing loop without new documents
- Opening import with preview — matches how this business seeds stock elsewhere

---

## The Question

What would make vendor WIP tracking **10x** more valuable — so the operator trusts closing qty enough to bill/reconcile without a side spreadsheet?

---

## Massive Opportunities

### 1. True two-location inventory (warehouse ↔ vendor)

**What**: Send optionally (or always) decrements warehouse; purchase from tracked vendor increases warehouse *and* decreases vendor qty (already does latter). Or: stock adjustment link auto-created with the send.
**Why 10x**: Today’s shadow ledger cannot answer “where are my units?” without mental math. Location truth is the category jump from note-taking to inventory.
**Unlocks**: negative warehouse prevention on send; stock-as-of including vendor locations; theft/loss visibility.
**Effort**: High (inventory txn rules, returns, edits, reporting)
**Risk**: Breaks current “send without moving books” habit if forced; needs a mode or confirmation.
**Score**: 🔥

### 2. Material → finished conversion (WIP recipes)

**What**: On purchase (or a “receive finished” action), map consumed materials at vendor to finished SKUs with yield (e.g. 100 sheets → 80 books). Vendor stock tracks materials; warehouse receives finished.
**Why 10x**: Matches print/bind reality; without it, WIP qty is fiction whenever SKUs differ.
**Unlocks**: accurate material WIP valuation; scrap reporting; honest closing.
**Effort**: Very High (BOM/recipe table, receive UI, edge cases)
**Risk**: Overfitting to one vendor workflow; start with 1:N simple recipes per vendor.
**Score**: 🔥

### 3. Vendor WIP as billable / payable control account

**What**: Optional journal on send (Dr WIP asset / Cr Inventory) and reverse on purchase receipt — GL and qty stay aligned.
**Why 10x**: Turns operational WIP into financial WIP; owner sees asset still outside warehouse.
**Effort**: High (account mapping, settings, reverse on edit/delete)
**Risk**: Accounting policy debates; many SMEs may not want it day one.
**Score**: 🤔

---

## Medium Opportunities

### 1. Movement drill-down on activity report

**What**: Expand row → list of sends/invoices/openings with dates and links.
**Why 10x**: Turns report from “number” into “proof” for vendor disputes.
**Impact**: Daily reconciliation speed; trust in negatives.
**Effort**: Medium (query by vendor+inventory+date; reuse invoice/issue routes)
**Score**: 🔥

### 2. Send form situational awareness

**What**: Show vendor on-hand + warehouse qty per line; warn if send > warehouse (even if warehouse not decremented); suggest items previously sent to that vendor.
**Why 10x**: Prevents the missing-send / over-send mistakes that create negatives later.
**Effort**: Low–Medium
**Score**: 🔥

### 3. Manual adjust + scrap reason codes

**What**: Small UI writing real `adjustment` movements with notes.
**Why 10x**: Opening re-import is nuclear; adjusts are how WIP stays honest mid-period.
**Effort**: Low
**Score**: 👍

### 4. Inventory “At vendors” rollup

**What**: On inventory row/detail, sum qty across tracked vendors; link out.
**Why 10x**: Stops WIP being a separate mental app.
**Effort**: Medium
**Score**: 👍

### 5. Opt-in lifecycle guards

**What**: Warn/block uncheck when on-hand ≠ 0; optional archive; freeze movements.
**Effort**: Low
**Score**: 👍

---

## Small Gems

### 1. Unify copy: Issued → Sent (or Sends)

**Why powerful**: kills issue/send split in the report operators actually print.
**Effort**: Low | **Score**: 🔥

### 2. Fix aria-labels still saying “issue”

**Effort**: Trivial | **Score**: 👍

### 3. Click on-hand row → pre-filtered activity

**Effort**: Low | **Score**: 🔥

### 4. Post-purchase toast → link to vendor stock page

**Effort**: Low | **Score**: 👍

### 5. Sanity strip: Σ closing vs expected from last import

**Effort**: Low | **Score**: 🤔

### 6. USER_MANUAL section: when to flag WIP vs agent

**Effort**: Low | **Score**: 🔥 (prevents silent data corruption)

### 7. Resolve migration 025 number collision before merge

**Effort**: Low | **Score**: 🔥 (ship blocker, not product, but real)

---

## Recommended Priority

### Do Now

1. **USER_MANUAL + copy pass** (Sent vs Issued; aria-labels) — trust and onboarding.
2. **Migration number conflict** with customer_groups 025 — unblock merge.
3. **Activity drill-down** (even read-only movement list) — makes the report usable for billing fights.
4. **Send-form on-hand hints** — prevents garbage in.

### Do Next

1. **Decide warehouse policy**: shadow forever vs optional transfer on send — product fork; everything else hangs on this.
2. **Manual adjustments** using existing `adjustment` type.
3. **Inventory rollup** of vendor qty.

### Explore

1. **Material→finished recipes** — only if business confirms SKUs differ at vendor (likely for binders).
2. **GL WIP postings** — only if owner wants balance-sheet WIP.

### Backlog

1. Print/PDF for sends (nice, not 10x).
2. Align activity print with iframe report pattern.
3. Idempotent invoice movement rewrite (cleanup, not user-facing).
4. Remove or wire unused `setVendorOpeningStock` UI.

---

## Skeptical Verdict

Feature is a **competent shadow qty subsystem** wired correctly into the dangerous purchase-invoice dual-use (WIP vendor vs consignment agent) via opt-in — that part is shrewd.

It is **not yet WIP manufacturing tracking**. Without warehouse movement and/or material→finished mapping, closing qty is only trustworthy when:

- same SKU is sent and bought back, and
- warehouse is reconciled by hand, and
- every send was entered.

Until drill-down and one of the “true location” bets land, this risks becoming a second spreadsheet inside the app — polished, tested, and still incomplete for the binder workflow that motivated it.

---

## Questions

### Answered (from code)

- **Q**: Does send reduce warehouse? **A**: No — by design and tested.
- **Q**: Do untracked purchase parties affect WIP? **A**: No — skipped in `applyPurchaseEffect`.
- **Q**: Can vendor qty go negative? **A**: Yes; toast warns after purchase.
- **Q**: Is `adjustment` usable? **A**: Schema only; no writer UI/API.

### Blockers (need business input)

- **Q**: On send, should warehouse decrease, stay, or ask each time?
- **Q**: Are materials and finished goods different inventory rows for WIP vendors?
- **Q**: Is activity report for internal control, vendor billing, or both?
- **Q**: Should WIP appear on the balance sheet?

## Next Steps

- [ ] Validate warehouse policy with operator (one real send + purchase week)
- [ ] Confirm whether Item-X sent is same SKU as purchase lines from that vendor
- [ ] Decide: drill-down + copy polish first vs location-truth project
- [ ] Renumber migrations before merging parallel 025 work
