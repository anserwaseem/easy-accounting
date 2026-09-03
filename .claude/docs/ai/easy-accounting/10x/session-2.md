# 10x Analysis: Vendor Stock (WIP at vendors)

Session 2 | Date: 2026-09-03

> **Scope**: UX audit of newly shipped vendor stock feature, for manufacturing end-users who track WIP at binders/printers/finishers. Evidence from code only (`VendorStock/*`, `Reports/VendorStockActivity`, `accountForm.tsx`, `Invoice.service` purchase hooks, `VendorStock.service`).

## Current Value

**Problem solved today**: Opt-in shadow quantity ledger per vendor account. Issues increase vendor qty; purchase invoices (and purchase returns) silently adjust it; warehouse `inventory.quantity` stays untouched. Opening balances via Excel/CSV. Activity report shows opening / issued / purchased / returns / adjusted / closing for one vendor + date range.

**Who**: Clerk who ships unfinished goods to a vendor and later books a purchase when finished work returns (or when buying finished stock from that vendor).

**Core actions**: enable flag on account → import opening (once) → create vendor issues → book purchase invoices as usual → optionally run activity report.

**Mental model the UI states**: "Shadow qty at tracked vendors. Does not change warehouse inventory."

---

## Concrete UX Friction

### Setup / discovery

| # | Screen / action | Friction |
|---|-----------------|----------|
| F1 | **Accounts → Add/Edit** (`accountForm.tsx`) | Bare checkbox **"Track vendor stock"** — no `FormDescription`, no "why", no link to Vendor Stock page. Clerk must already know the feature exists and which accounts are WIP vendors vs ordinary creditors. |
| F2 | **Accounts list** | No badge/column for `tracksVendorStock`. Cannot see who is opted in without opening each account. |
| F3 | **Vendor Stock empty state** | Good pointer ("enable Track vendor stock…"), but forces a **context switch** to Accounts, then back. No deep-link "open this vendor's account". |
| F4 | **Language** | "Vendor issue", "shadow qty", "Import opening" — accountant vocabulary. Manufacturing clerk thinks: *send material out*, *WIP at binder*, *receive finished*. Mismatch raises training cost. |

### Daily issue entry (`NewVendorIssue.tsx`)

| # | Screen / action | Friction |
|---|-----------------|----------|
| F5 | **Item picker** | Full warehouse inventory list — no recent items, no "already at this vendor", no qty-on-hand-at-vendor beside the row. |
| F6 | **No warehouse / vendor qty context** | Header says warehouse unchanged, but form never shows warehouse qty or current vendor on-hand for the selected item. Blind entry → easy over-issue or wrong SKU. |
| F7 | **Lines UI** | Manual "Add line" + one row at a time; not invoice-grade (no Enter-to-append culture, no virtuoso, no bulk paste). Multi-SKU consignments are slow. |
| F8 | **No print / PDF of issue slip** | Gate pass / challan to vendor is a paper ritual; app creates a database row only. |
| F9 | **Edit issue** | Copy says "Updates vendor qty to match this issue" — correct but easy to misread as append. No before/after delta preview. |
| F10 | **Validation** | Empty `inventoryId` / qty 0 lines silently dropped on save. No inline errors; toast only after submit. |

### Hub (`VendorStock/index.tsx`)

| # | Screen / action | Friction |
|---|-----------------|----------|
| F11 | **On hand table** | Flat Vendor / Item / Qty only. No negative highlighting (service allows negative), no "stale WIP" age, no last movement date, no drill to movements. |
| F12 | **Issues table** | Shows `#`, date, vendor, **total qty**, **line count** — not which items. Must Edit to see lines. High cognitive load when reconciling a vendor call. |
| F13 | **Two unrelated tables** | On-hand + Issues on one scroll page with same vendor filter — good for overview, weak for "what left yesterday?" (no date filter on issues). |
| F14 | **Delete** | Confirm dialog is clear (qty reversed). No soft-delete / audit trail visible in UI beyond activity aggregates. |

### Opening import (`ImportVendorOpeningStock.tsx`)

| # | Screen / action | Friction |
|---|-----------------|----------|
| F15 | **Reset checkbox** | "For each vendor in the file, set items not listed to 0" — dangerous, under-warned (no confirmation step after file pick; import runs immediately on file select). |
| F16 | **No preview / dry-run** | File → parse → write. No unmatched vendor/item review grid before commit. Failures are toast-only. |
| F17 | **Success toast** | Counts input rows, not resolved vendors / zeroed items / skipped lines. |

### Purchase invoice link (critical gap)

| # | Screen / action | Friction |
|---|-----------------|----------|
| F18 | **New / Edit Purchase Invoice** | **Zero UI hint.** `Invoice.service` calls `applyVendorStockForPostedPurchase` when party account has `tracksVendorStock`. Clerk has no banner, no "will reduce vendor WIP by N", no per-line vendor-on-hand check, no warning if result goes negative. |
| F19 | **Purchase return** | Restores vendor stock (service) — also silent in UI. |
| F20 | **Mental model trap** | Purchase already means "stock in + payable". Now it *also* silently means "WIP at vendor down" for flagged accounts. Same form, two effects; only one is visible. Consignment-return purchases (agent collecting from customers) that use an untracked account correctly skip — but nothing explains when skip vs apply. |
| F21 | **Invoice details / list** | No "vendor stock movement" chip or link to activity for that invoice id. |

### Activity report (`Reports/VendorStockActivity`)

| # | Screen / action | Friction |
|---|-----------------|----------|
| F22 | **Must pick vendor + Run** | No auto-run; empty until Run. Single vendor only (no "all tracked"). |
| F23 | **Aggregate only** | Opening / Issued / Purchased / Returns / Adjusted / Closing — no movement ledger drill-down (issue #, invoice #). Clerk cannot answer "which challan / bill moved this?" from the report. |
| F24 | **Column jargon** | "Purchased" = qty *removed* from vendor WIP via purchase invoice. Counter-intuitive for manufacturing: they call that *received / finished / returned from vendor*. |
| F25 | **Adjusted** | Column exists; no UI to create adjustments except opening import / issue edit/delete side-effects. Dead-feeling unless you know the data model. |

### Cognitive load summary

1. **Opt-in flag is invisible** during the high-frequency path (purchase entry).
2. **Two stock systems** (warehouse vs vendor shadow) with asymmetric UI: warehouse updates loudly on invoices; vendor updates silently.
3. **Issue ≠ warehouse transfer** — clerk must separately adjust warehouse (or not — design choice) with no guided pairing.
4. **WIP lifecycle incomplete in nouns**: Issue → (work happens) → Purchase. Missing: expected return date, job/ref, material vs finished SKU mapping.

---

## What's Already Good

- Clear **opt-in** (`tracksVendorStock`) so ordinary creditors / consignment-return agents are not polluted.
- Explicit copy that issues **do not** change warehouse qty (honest about shadow ledger).
- Empty state on Vendor Stock points at the flag + next actions.
- Sidebar nav + **⌘/Ctrl+4** shortcut to new vendor issue (matches invoice keyboard culture).
- Vendor filter shared across on-hand + issues; link to activity report.
- Issue delete confirm explains qty reversal.
- Opening import column hint via `FILE_UPLOAD_HINT_VENDOR_OPENING_STOCK`.
- Activity report: date range presets, Excel + print, `onViewModelChange` export/print parity with other reports.
- Service allows negatives with log warn — operational reality of late booking — even if UI does not surface it.
- Edit + delete of issues supported (not write-only).

---

## Manufacturing Clerk Daily Loop (current UI)

**Assumption**: vendors already flagged; opening imported once.

### Morning check — "what's at the binder?" (~4–6 steps)

1. Sidebar → **Vendor Stock**
2. Vendor filter → pick binder
3. Scan **On hand** table (no search emphasis beyond DataTable defaults)
4. Optional: open **Activity report** (separate nav)
5. Pick same vendor + date range
6. Click **Run**

### Ship material to vendor — "issue WIP" (~8–12 steps)

1. **Vendor Stock** → **New vendor issue** (or ⌘4)
2. Confirm/select vendor
3. Set date
4. Optional notes
5. For each SKU: open item select → search → pick → type qty → (Add line) → repeat
6. **Save issue**
7. *Outside app or elsewhere*: warehouse adjustment / physical challan if they still deplete warehouse stock (app does not do this)
8. Return to Vendor Stock to verify on-hand bumped

### Receive finished work — "purchase reduces WIP" (~6–10 steps, invisible vendor effect)

1. **Purchase Invoices** → New
2. Select vendor (same account)
3. Enter finished items / qty / prices as usual
4. Save / post
5. **No confirmation** that vendor WIP reduced
6. To verify: navigate Vendor Stock → filter vendor → eyeball on-hand **or** run Activity report again

**Typical daily step count (one ship + one receive + one check)**: ~20–28 UI steps across 3 areas (Vendor Stock, Purchase, Report), with the highest-risk step (purchase) giving **zero** vendor-stock feedback.

**Setup first time (extra)**: Accounts → find vendor → Edit → check Track vendor stock → Submit → Vendor Stock → Import opening → set date → optional reset → choose file → hope parse succeeds. ~10+ steps, easy to miss flag.

---

## The Question

What would make vendor WIP tracking 10x more valuable for a manufacturing clerk — so the daily loop is one place, purchases cannot silently desync WIP, and "what's at the vendor?" is answered in seconds?

---

## Massive Opportunities

### 1. Unified "Vendor WIP desk" (issue → on-hand → receive)

**What**: One vendor-centric workspace: on-hand, open issues, expected receipts, and a **Receive** action that drafts/posts a purchase invoice *and* shows WIP deltas before save. Optionally map issued material SKUs → finished SKUs.
**Why 10x**: Collapses the 3-app-area loop into one ritual; matches how clerks talk ("binder desk").
**Unlocks**: Job refs, expected dates, aging WIP, vendor performance.
**Effort**: High
**Risk**: Overlaps Purchase Invoice flows; must not fork accounting posting.
**Score**: 🔥

### 2. Material issue that optionally pairs warehouse out

**What**: Toggle on issue: "Also reduce warehouse stock" (stock transfer / adjustment under the hood) with print challan.
**Why 10x**: Ends double entry (shadow issue + separate warehouse adj) and matches physical truth for many shops.
**Unlocks**: True WIP valuation later; fewer negative warehouse surprises.
**Effort**: High (inventory + audit trail)
**Risk**: Breaks shops that already deplete warehouse on manufacture start differently.
**Score**: 👍

---

## Medium Opportunities

### 1. Purchase-form vendor WIP banner + preflight

**What**: If selected party `tracksVendorStock`, show banner: "Posting will reduce vendor WIP" and per-line current on-hand → projected closing; block or warn on negative.
**Why 10x**: Fixes F18 — the silent side effect is the #1 trust killer.
**Impact**: Confidence; fewer fire drills from negative WIP.
**Effort**: Medium
**Score**: 🔥

### 2. Movement ledger drill-down from on-hand / activity

**What**: Click qty → list movements (issue #, invoice #, opening, adj) with links.
**Why 10x**: Turns aggregates into answers during vendor phone calls.
**Effort**: Medium
**Score**: 🔥

### 3. Issue slip print + itemized issues list

**What**: Print/PDF challan from issue; Issues table shows item summary or expandable lines.
**Why 10x**: Paper still runs the yard; screen must produce it.
**Effort**: Medium (print path exists elsewhere)
**Score**: 👍

---

## Small Gems

### 1. FormDescription on Track vendor stock checkbox

**What**: One sentence + "Purchases will reduce WIP at this vendor."
**Why powerful**: Makes opt-in intentional; documents the silent purchase link at the only setup moment.
**Effort**: Low
**Score**: 🔥

### 2. Negative qty styling + toast on purchase when WIP goes negative

**What**: Red on-hand cells; post-purchase toast "Vendor WIP: Item X now -12".
**Why powerful**: Anxiety killer; tiny code surface.
**Effort**: Low
**Score**: 🔥

### 3. Show vendor on-hand beside issue line item

**What**: After picking item, show "At vendor: N".
**Why powerful**: Prevents blind over-issue.
**Effort**: Low
**Score**: 👍

### 4. Rename report column "Purchased" → "Received (purchases)" / "Consumed by purchase"

**What**: Label that matches manufacturing mental model.
**Why powerful**: Zero backend change; cuts misreads.
**Effort**: Low
**Score**: 👍

### 5. Import dry-run preview before write

**What**: Parse → table of resolved/unresolved → Confirm.
**Why powerful**: Stops wipe-from-reset disasters (F15–F16).
**Effort**: Low–Medium
**Score**: 🔥

### 6. Badge on account list / party select for tracked vendors

**What**: Small "WIP" chip on vendors that track stock.
**Why powerful**: Discovery without opening forms.
**Effort**: Low
**Score**: 👍

---

## Recommended Priority

### Do Now

1. **Purchase WIP banner + negative warning toast** — Why: silent purchase effect is the trust hole; Impact: clerks see the loop close.
2. **Checkbox FormDescription + account badge** — Why: setup clarity; Impact: fewer mis-flagged / unflagged vendors.
3. **Import dry-run / confirm on reset-others** — Why: prevents irreversible zeroing; Impact: safe onboarding.

### Do Next

1. **Movement drill-down** from on-hand and activity.
2. **Issue print slip** + itemized issues list columns.
3. **On-hand context on issue lines** (vendor qty, optional warehouse qty).

### Explore

1. **Vendor WIP desk** with Receive → purchase draft — Risk: UX fork from New Invoice; Upside: 10x daily loop compression.
2. **Paired warehouse out on issue** — Risk: accounting policy variance; Upside: one physical truth.

### Backlog

1. Material→finished SKU mapping, expected return dates, WIP aging report.
2. Multi-vendor activity report / dashboard tile "WIP at vendors".

---

## Questions

### Answered (from code)

- **Q**: Does purchase UI mention vendor stock? **A**: No — only main-process `applyPurchaseEffect` when `tracksVendorStock`.
- **Q**: Does issue reduce warehouse? **A**: No — shadow ledger only; UI copy states this.
- **Q**: Can vendor qty go negative? **A**: Yes — service allows; UI does not highlight.

### Blockers

- **Q**: Should issue also move warehouse stock for this business, or is shadow-only intentional forever?
- **Q**: Is "purchase = WIP return" the real receive ritual, or do they need a non-purchase receive for pure job-work?

## Next Steps

- [ ] Validate with clerk: one real day count of issue vs purchase vs reconciliation phone calls
- [ ] Decide: purchase banner (Do Now) vs full WIP desk (Explore)
- [ ] If implementing Do Now, keep purchase posting path single — UI only surfaces existing `tracksVendorStock` effect
