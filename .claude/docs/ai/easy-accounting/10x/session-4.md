# 10x Analysis: Completeness vs Simplicity (Vendor Stock)

Session 4 | Date: 2026-09-03

> **Lens**: After Session 3 Do Now shipped on PR #152 (`602d292`). Not “what polish remains.” What to **add for completeness**, what to **delete for cleanliness**, and what would actually make this **superior** — not just busy.
>
> Builds on Sessions 2–3. Challenges Session 2’s massive bets where they inflate a shadow counter into a fake ERP module.

## Current Value (post Do Now)

Opt-in shadow WIP qty at vendors:

| Loop step | Status |
| --- | --- |
| Flag vendor as WIP | Done (checkbox + description + WIP badge) |
| Seed starting qty | Done (preview → confirm import) |
| Send goods | Done (Send to vendor; warehouse unchanged) |
| Receive via purchase | Done (auto ↓ + banner + delta/negative toasts) |
| Check what’s left | Done (At vendor hub + activity report) |
| Fix mistakes | Done (edit/delete sends) |

**Trust loop is closed enough for same-SKU WIP.** Next work either makes the model *true*, or makes the UI *quieter*. Most “feature ideas” fail that test.

## The Question

What is the smallest set of moves that makes closing qty **believable enough to retire the side spreadsheet** — without turning Vendor Stock into a second inventory system?

---

## Brutal cut list (remove / refuse / shrink)

Superiority often means **less surface**, not more screens.

### Kill or freeze now

| Thing | Why cut / freeze | Score |
| --- | --- | --- |
| **Second “WIP Receive” posting UI** | Session 3 already refused; purchase *is* receive. Building parallel post = dual maintenance + dual training. | ❌ refuse |
| **GL WIP journals (Dr WIP / Cr Inventory)** | Completeness fantasy. Shop does not cost inventory yet (Session 1: P&L blocked on costing). Qty trust first; books later or never. | ❌ refuse for now |
| **Material→finished recipes in this PR wave** | Completeness-critical *if* SKUs differ — but unvalidated. Building BOM without one clerk confirming “paper ≠ book” wastes a sprint. | 🤔 gate on question |
| **Unused `setVendorOpeningStock` IPC as a UI** | Dead API path. Either wire one-vendor “set qty” into the hub *or* delete the IPC later — don’t leave both. Prefer: keep API, no UI (import covers seed). | ❌ no UI |
| **`adjustment` movement type with no writer** | Schema debt advertising a feature that doesn’t exist. Either ship a 3-field Adjust dialog **or** stop showing “Adjusted” as if it were intentional (in-range openings stuffed there today — lying column). | 🔥 decide |
| **Equal-weight dual tables on hub** | At vendor + Sends as peers = dashboard chrome. Clerk’s morning job is one question. Sends belong under the vendor, not beside. | 🔥 simplify |
| **Activity report as daily path** | Report is period control, not morning check. Don’t invest in dashboard tiles / multi-vendor activity until drill-down exists on the hub. | ❌ refuse chrome |
| **Print/PDF for every send** | Completeness theater unless the yard still stamps paper gate passes. Ask once; don’t build “because invoices print.” | 🤔 gate |
| **Idempotent rewrite of invoice movements** | Correctness hygiene for forensics; zero user value until someone audits movement rows. Backlog. | ❌ later |
| **Rename SQL `vendor_issues` → sends** | Cleanliness vanity. UI nouns already fixed. Schema rename = migration risk for zero clerk value. | ❌ refuse |

### What “Adjusted” is doing wrong (cleanliness)

Activity buckets in-range `opening` into **Adjusted**. Operator reads “someone adjusted WIP.” Reality: “someone re-imported starting qty.” That is **dishonest UI**. Fix options (pick one):

1. Rename column → **Opening changes** (honest, low effort), or
2. Split opening deltas from true adjustments, and only show Adjusted when a real adjust writer exists.

Doing neither leaves a polished lie in the billing helper.

---

## Completeness gaps (only the ones that matter)

Feature is **operationally complete** for: same SKU sent and purchased back, warehouse reconciled elsewhere, every send entered.

It is **incomplete** for:

1. **Location truth** — warehouse and vendor can both claim units (shadow by design).
2. **Identity truth** — material SKU ≠ finished SKU (no conversion).
3. **Proof** — activity totals without drill-down to send # / purchase #.
4. **Mid-period honesty** — no real adjust/scrap; only nuke-via-reimport or edit send.
5. **Lifecycle** — uncheck WIP flag leaves orphan rows; silent.

Anything else (aging, dashboard tiles, WhatsApp of sends) is richness without trust.

---

## Massive Opportunities (re-scored after Do Now)

### 1. Warehouse policy — one decision, not a module

**What**: Product fork, not a feature pile:
- **A. Shadow forever** (today) — document hard; optional one-click “also create stock adjustment” later.
- **B. Transfer on send** — send ↓ warehouse; purchase ↑ warehouse + ↓ vendor (purchase half already true).
- **C. Ask each send** — worst UX unless default is sticky.

**Why 10x**: Only path that answers “where are my units?” Completeness of *inventory*, not of *Vendor Stock screens*.
**Why challenge Session 2**: Building B without clerk confirmation doubles every edge case (returns, edits, negatives, stock-as-of). If they already adjust warehouse by hand and are fine, B is overreach.
**Effort**: High for B; Low for documenting A + USER_MANUAL.
**Score**: 🔥 for **deciding**; 👍 for implementing B only after decision = B.

### 2. Material → finished — completeness or irrelevant

**What**: Recipe / yield on receive.
**Why 10x**: If binders return different SKUs, current closing qty is fiction — no amount of UX polish fixes that.
**Challenge**: If they track WIP in finished-good units from the start (send “books” conceptually, buy “books”), recipes are overengineering.
**Score**: 🔥 *if* SKUs differ; ❌ *if* same SKU — **ask before any design**.

### 3. Not a massive opportunity: “richer WIP desk”

Session 3 correctly killed parallel posting. Reaffirm: ❌.

---

## Medium Opportunities (high leverage, still simple)

### 1. Movement proof from At-vendor (not a fancier report)

**What**: Click qty → sheet: date, type (send / purchase / opening), reference #, delta, running qty. Links to send edit / purchase invoice.
**Why 10x**: Turns “−3” from anxiety into a story. Makes activity report optional for daily disputes.
**Effort**: Medium (query movements by vendor+item; routes exist).
**Vs richness**: Do **not** also build a second multi-vendor dashboard. One drill path.
**Score**: 🔥

### 2. Vendor-first hub (simplify, don’t add)

**What**: First viewport = vendor picker + At vendor table only. Sends as tab/section under same vendor filter. Remember last vendor.
**Why 10x**: Removes split attention Session 3 diagnosed. Same features, less thinking.
**Effort**: Medium (layout + localStorage/electron-store).
**Score**: 🔥 (simplicity win)

### 3. Real Adjust (or stop pretending)

**What**: Tiny dialog: vendor + item + qty delta + note → `adjustment` movement.
**Why 10x**: Scrap/yield/correction without reimport nuclear option.
**Effort**: Low–Medium.
**Score**: 👍 — **or** hide Adjusted column until this ships (cleanliness > richness).

### 4. Send-line situational awareness

**What**: Beside each line: At vendor: N (and optionally Warehouse: M muted).
**Why 10x**: Prevents garbage-in that causes purchase negatives later.
**Effort**: Low.
**Score**: 🔥

### 5. Opt-in lifecycle guard

**What**: Block or warn uncheck when on-hand ≠ 0; “zero first / archive.”
**Why 10x**: Prevents silent orphans after setup mistakes.
**Effort**: Low.
**Score**: 👍

### 6. Inventory rollup “also at vendors”

**What**: Sum across tracked vendors on inventory detail.
**Why useful**: Merges mental apps.
**Risk**: Encourages treating shadow as location truth while warehouse still double-counts — can **increase** confusion until warehouse policy decided.
**Score**: 🤔 after policy; ❌ before.

---

## Small Gems (disproportionate cleanliness)

| Gem | Why | Score |
| --- | --- | --- |
| Issued → **Sent** on activity (column + Excel + print) | Last jargon bleed after Do Now | 🔥 |
| Aria still “issue” → send | Accessibility + consistency | 👍 |
| On-hand row click → activity prefiltered | Cheap proof until movement sheet | 🔥 |
| Toast “At vendor stock” → link Open vendor | Close the loop | 👍 |
| USER_MANUAL: WIP vs agent consignment | Prevents catastrophic misuse of purchase dual-use | 🔥 |
| Fix Adjusted column honesty | Stop lying | 🔥 |
| Migration 025 collision with customer_groups | Ship blocker | 🔥 |
| Enter-to-add-line + one starter row on Send | Match invoice keyboard culture | 👍 |
| Item summary on Sends list (`A×5, B×2`) | Answer phone without Edit | 👍 |

---

## Richness traps (looks superior, isn’t)

1. **WIP aging / expected return date** — useful later; without drill-down and honest qty, dates decorate fiction.
2. **Home dashboard “qty at vendors” tile** — second place to ignore; hub already exists.
3. **Multi-vendor activity matrix** — spreadsheet envy; one-vendor proof first.
4. **Soft-delete + heavy audit UI** — movements already exist; don’t build an audit product.
5. **Challan/print for every send** — only if yard requires paper; otherwise chrome.
6. **Blocking negatives instead of warn** — feels “strict/superior”; often blocks legitimate receive-before-send catchup. Keep warn+allow unless clerk asks to block.

---

## Superiority definition (use this as filter)

A change is **superior** only if it improves at least one:

1. **Believability** of closing qty (proof, honesty of columns, fewer silent orphans)
2. **One-path clarity** (fewer places to do the same job)
3. **Same-SKU loop speed** (send → purchase → check without relearning nouns)

If it only adds a screen, a synonym, or a report tile → **not superior**.

---

## Recommended Priority

### Do Now (minimal completeness + cleanliness)

1. **Ask two blockers** (below) — warehouse policy; material≠finished — before any Medium/Massive build.
2. **Copy leftovers**: Issued→Sent; aria; USER_MANUAL WIP-vs-agent paragraph.
3. **Adjusted column honesty** (rename or split) — stop the polished lie.
4. **Migration 025 renumber** before merge with customer_groups.
5. **Send-line At vendor: N** — prevent garbage-in.

### Do Next (trust without new products)

1. **Vendor-first hub** (simplify layout; last-vendor memory).
2. **Movement sheet** from on-hand click (proof).
3. **Real Adjust dialog** *or* hide Adjusted until then.
4. **Item summary on Sends** + Enter-to-add-line.
5. **Opt-in uncheck guard**.

### Explore (only after blockers answered)

1. Warehouse transfer on send — **only if** answer = must leave warehouse.
2. Material→finished — **only if** SKUs differ in real binder flow.
3. Inventory rollup — only after policy chosen so numbers don’t double-mean.

### Explicitly remove / don’t build

- WIP Receive desk
- GL WIP postings
- Schema rename issues→sends
- Multi-vendor dashboard tiles
- Soft-delete audit chrome
- Blocking negatives (unless requested)

---

## Scoreboard (post Do Now)

| Move | Completeness | Richness | 10x UX | Simplicity | Cleanliness | Superior? |
| --- | --- | --- | --- | --- | --- | --- |
| Movement drill from hub | ✓ | low | ✓ | ✓ | ✓ | **Yes** |
| Vendor-first hub | — | — | ✓ | ✓✓ | ✓ | **Yes** |
| Adjust dialog | ✓ | low | ✓ | ✓ | ✓ | **Yes** |
| Issued→Sent + manual | — | — | ✓ | ✓ | ✓✓ | **Yes** |
| Warehouse transfer | ✓✓ | med | ✓ | ✗ | ? | **Only if policy = B** |
| Material→finished | ✓✓ | high | ✓ | ✗✗ | ? | **Only if SKUs differ** |
| GL WIP | “complete” | high | — | ✗✗ | ✗ | **No** |
| Second receive UI | false | high | ✗ | ✗✗ | ✗ | **No** |
| Dashboard tile | — | high | — | ✗ | ✗ | **No** |

---

## Questions

### Answered (code + Session 3)

- **Q**: Was silent purchase the main hole? **A**: Yes — Do Now closed it (banner + toast).
- **Q**: Need a new posting surface? **A**: No.
- **Q**: Same nouns everywhere yet? **A**: Almost — **Issued** and aria “issue” remain.

### Blockers (need operator, 5 minutes)

1. **On send, warehouse qty should**: stay / decrease / ask each time?
2. **Item sent to binder vs item on purchase invoice**: same inventory row or different?
3. **Activity / closing qty used for**: internal control, vendor billing fights, or both?
4. **Negative after purchase**: keep warn+allow, or block post?

### If answers are “stay / same SKU / internal / warn”

→ Feature is **already complete enough**. Ship Do Now leftovers + vendor-first hub + movement proof. **Refuse** recipes, GL, transfer. Superiority = quieter UI + believable proof.

### If answers are “decrease / different SKUs”

→ Current feature is a **prototype**. Do Next is insufficient; plan transfer + conversion. Don’t polish more chrome first.

---

## Skeptical verdict

Do Now made the feature **honest at the purchase moment**. That was the right 10x.

What remains is **not feature richness**. It is:

- **one product decision** (shadow vs transfer; same SKU vs conversion),
- **one proof path** (movement sheet),
- **one quieter hub** (vendor-first),
- **one honesty fix** (Adjusted column),
- and a pile of **temptations that look complete and make the product worse**.

Best next move is not another screen. **Answer the blockers.** Then either declare v1 done and only ship proof+simplify — or commit to location/conversion and stop pretending shadow qty is WIP manufacturing.

## Next Steps

- [ ] Owner answers blockers 1–4 (above)
- [ ] If “shadow + same SKU”: implement Do Now leftovers + Do Next 1–3 only; freeze Explore
- [ ] If “transfer / different SKU”: write a thin design note for B+conversion before more UX polish
- [ ] Renumber migration 025 before merging parallel work
- [ ] Delete or hide dishonest Adjusted semantics in the same PR as Adjust-or-rename
