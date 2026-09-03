# 10x Analysis: Simplify & Pristine UX (Vendor Stock + Ops Loop)

Session 3 | Date: 2026-09-03

> **Lens**: Not “what else to build.” What to **remove, rename, merge, and surface** so end-users finish the job with less thinking. Builds on Session 2 friction list; challenges Session 2’s larger bets where they add surface area.

## Current Value

Vendor stock works as an opt-in shadow WIP ledger. Value is real; **trust and discoverability are not**. The clerk’s pain is not missing features — it is **three places, silent side effects, and accountant nouns**.

## The Question

What would make this 10x easier — fewer screens, fewer words, zero surprises — so a manufacturing clerk ships WIP and receives finished work without training?

---

## Brutal diagnosis (why UI feels “not pristine”)

1. **Two truths, one silent** — Warehouse updates loudly on purchase; vendor WIP updates with no banner. Pristine UI never hides a second ledger effect.
2. **Hub is a dashboard, not a desk** — On-hand + Issues stacked = overview chrome, not a single job. First viewport should answer one question: *what’s at this vendor?*
3. **Jargon tax** — “Vendor issue”, “shadow”, “Purchased” (meaning WIP removed). Manufacturing says *send out / at vendor / received back*.
4. **Setup is tribal knowledge** — Checkbox with no description; no WIP badge on accounts/party select.
5. **Import is a footgun** — File pick commits immediately; reset-to-zero under-warned.

**Rule for this session**: Prefer one clear path over a second report, second desk, or second invoice type.

---

## Massive Opportunities

### 1. Kill the three-app hop (without a new “WIP desk” product)

**What**: Stay on Purchase + Vendor Stock, but make purchase the **receive ritual’s feedback surface** (banner + projected WIP). Do **not** fork a parallel Receive that posts purchases.
**Why 10x**: Session 2’s “Vendor WIP desk” compresses the loop but risks a second posting UI. 10x here is **closing the trust loop where the clerk already works**.
**Unlocks**: Same accounting path; less training; no dual entry of purchases.
**Effort**: Medium
**Risk**: Banner ignored if noisy — keep it only when `tracksVendorStock`.
**Score**: 🔥

### 2. One noun set for the whole feature

**What**: Product copy pass — UI only (no schema rename required):
- Track vendor stock → **Track stock at this vendor (WIP)**
- Vendor issue → **Send to vendor** / **Outward**
- On hand → **At vendor**
- Activity “Purchased” → **Received via purchase**
- Import opening → **Set starting qty at vendors**
**Why 10x**: Same code, half the training calls. Pristine = words match the yard.
**Effort**: Low–Medium (copy audit)
**Risk**: Accountants who like “issue” — offer tooltip with old term once.
**Score**: 🔥

---

## Medium Opportunities

### 1. Purchase WIP banner + negative toast (Do Now)

**What**: Tracked vendor selected → banner “Posting reduces qty at vendor”; after post, toast listing WIP deltas / negatives.
**Why 10x**: Fixes the silent side effect (Session 2 F18). Highest trust ROI per line of UI.
**Effort**: Medium
**Score**: 🔥

### 2. Hub: vendor-first, one composition

**What**: Default: pick vendor (or last used). First viewport = **At vendor** table only. Issues become a tab or secondary list under the same vendor — not a second equal table fighting for attention.
**Why 10x**: Matches brand/UI rule “one job per section”; morning check becomes 2 steps.
**Effort**: Medium
**Score**: 🔥

### 3. Issues list: show items without Edit

**What**: Expandable row or “Item summary” column (`A×5, B×2`). Edit stays for mutation.
**Why 10x**: Phone with vendor → answer without opening edit form.
**Effort**: Medium
**Score**: 👍

### 4. Movement sheet from At-vendor qty

**What**: Click qty → sheet of movements (send #, purchase #) — reuse patterns from Purchases-by-Vendor drill.
**Why 10x**: Activity report becomes optional for daily work.
**Effort**: Medium
**Score**: 👍

---

## Small Gems (pristine polish)

### 1. Checkbox FormDescription

**What**: “Purchases from this account will reduce qty held here. Use for WIP locations, not agents.”
**Effort**: Low | **Score**: 🔥

### 2. WIP badge on account list + party select

**What**: Small muted chip when `tracksVendorStock`.
**Effort**: Low | **Score**: 🔥

### 3. Negative qty in red + purchase toast

**What**: On-hand and toast after post.
**Effort**: Low | **Score**: 🔥

### 4. Import: preview then Confirm

**What**: Never write on file select; show resolved rows; confirm especially if reset-others.
**Effort**: Low–Medium | **Score**: 🔥

### 5. Line context on Send-to-vendor

**What**: “At vendor: N” beside item (warehouse qty optional, muted).
**Effort**: Low | **Score**: 👍

### 6. Remember last vendor

**What**: Store last Vendor Stock / Send vendor in electron-store.
**Effort**: Low | **Score**: 👍

### 7. Auto-run Activity when vendor + range set

**What**: Drop mandatory Run for the common case (keep Refresh).
**Effort**: Low | **Score**: 👍

### 8. Empty Send form: one starter line, Enter adds next

**What**: Match invoice keyboard culture (already a product strength).
**Effort**: Low | **Score**: 👍

---

## What NOT to do (simplify by refusal)

| Temptation | Why refuse (for now) |
|------------|----------------------|
| Full “Vendor WIP desk” with its own Receive posting | Duplicates Purchase; splits maintenance; Session 1 already warned against parallel flows |
| Material→finished SKU mapping in v1 polish | High domain complexity; ship trust/nouns first |
| Paired warehouse-out toggle on every issue | Policy fork; ask business first (Session 2 blocker) |
| Multi-vendor activity dashboard tile | Nice; doesn’t fix silent purchase |
| Soft-delete / heavy audit UI | Movements already rewrite on edit; don’t add chrome |

**Pristine ≠ more chrome.** Pristine = fewer decisions, visible consequences, words that match the job.

---

## Recommended Priority

### Do Now (ship on vendor-stock PR or immediate follow-up)

1. **Purchase WIP banner + post toast (incl. negatives)** — Why: trust; Impact: receive loop closes on the screen they already use.
2. **Checkbox description + WIP badge** — Why: setup without a manual.
3. **Import preview + confirm** — Why: stop irreversible reset.
4. **Rename user-facing labels** (Purchased → Received via purchase; Issue → Send to vendor; On hand → At vendor).

### Do Next

1. **Vendor-first hub** (one composition; issues secondary).
2. **Item summary / expand on issues**; **At vendor: N** on send lines.
3. **Movement sheet** from on-hand click.
4. **Last-vendor memory** + Enter-to-add-line on Send form.

### Explore (only after Do Now validated)

1. Optional “also reduce warehouse” on Send — **only if** clerks still double-book adj.
2. Print send-slip/challan — if paper gate pass is still external.
3. True WIP desk — only if banner+hub still leaves a 3-hop complaint.

### Backlog

1. Expected return date / WIP aging.
2. Multi-vendor snapshot on Home dashboard.

---

## Ruthless scorecard (Do Now set)

| Move | Impact | Reach | Frequency | Effort | Score |
|------|--------|-------|-----------|--------|-------|
| Purchase banner + toast | Trust / correctness | All tracked-vendor clerks | Every receive | M | 🔥 |
| Copy rename | Training | All | Continuous | L | 🔥 |
| Checkbox + badge | Setup | Once per vendor + every party pick | Med | L | 🔥 |
| Import preview | Disaster prevention | Onboarding / rare | Low freq, high severity | L–M | 🔥 |
| Vendor-first hub | Daily speed | Daily checkers | High | M | 👍 |

---

## Questions

### Answered

- **Q**: Is the biggest UX hole missing features? **A**: No — **silent purchase effect** + **jargon** + **split attention on hub**.
- **Q**: Does pristine UI mean a redesign system? **A**: No — match existing shad patterns; fix hierarchy and feedback.

### Blockers (need business)

- **Q**: Should Send also reduce warehouse stock for this shop, or stay shadow forever?
- **Q**: Preferred nouns: “Send to vendor” vs “Outward challan” vs keep “Issue”?
- **Q**: On purchase when WIP would go negative: **warn+allow** (today) or **block**?

## Next Steps

- [ ] Pick nouns with one clerk (5-minute call)
- [ ] Implement Do Now #1–4 on `cursor/vendor-stock-tracking-e7ef` (or follow-up PR)
- [ ] Re-time daily loop after Do Now — target: ship+receive+check **&lt; 12 steps**, receive with **visible** WIP feedback
- [ ] Only then revisit print slip / warehouse-pair toggle
