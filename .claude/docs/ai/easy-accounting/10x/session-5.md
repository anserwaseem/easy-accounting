# 10x Analysis: Family WIP at Press → Binder (S-23 → S-23-G / S-23-Z)

Session 5 | Date: 2026-09-04

> **Trigger**: Owner caveat after poke-kit. Original WIP example is not same-SKU shadow stock. Press delivers family-level work (e.g. `S-23`) to binder; later demand allocates that WIP into variant SKUs (`S-23-Z`, `S-23-G`, …) which are what purchases/sales actually book.
>
> Challenges Session 2/4 “material→finished” bet: the conversion key is **inventory family** (`parentId`), not a free-form BOM of unrelated materials — unless the business also does paper→book (separate question).

## Current Value (what we built)

Vendor stock is **per `inventoryId`**. Send +Q on item X; purchase from tracked vendor −Q on the **same** X. Opt-in, activity, negatives all assume that identity.

That model is **wrong** for the press→binder family story.

## The Question

How should WIP qty work when **what sits at the binder is a family bucket**, but **what comes back (and what clients order) is variant SKUs**?

---

## Domain restatement (owner)

1. Item **A1** prepared at press **P1**, delivered to binder **B1** at qty **Q1**.
2. A1 is essentially the **family** identity (example: `S-23`) — not a finished binding variant.
3. Clients’ order frequency later decides **Q2** of `S-23-Z`, **Q3** of `S-23-G`, … from that family WIP.
4. So: one undifferentiated WIP pool → many finished inventory rows.

### Code fact check (do not invent `family_code`)

In this repo there is **no** attribute key named `family_code`. Family grouping is:

- `inventory.parentId` → head row’s `id` (migration 020)
- Head: `parentId IS NULL` (often named `S-23`)
- Variants: `S-23-G`, `S-23-Z`, … with `parentId` → head
- Discriminators live in `attributes` JSON (e.g. `binding`) — family link is still `parentId`
- Invoices always reference **exact** `inventoryId` / exact `name` — never “any S-23-*”

If the live DB uses a private attribute called `family_code` instead of (or in addition to) `parentId`, that is **data**, not app logic today. App reads `parentId` for copy-attributes / catalog `parentSku`. Confirm which field production actually fills.

---

## Why shipped WIP breaks

| Step | Reality | Current vendor stock |
| --- | --- | --- |
| Deliver to binder | +Q1 of **family** WIP at B1 | Must pick one `inventoryId`. If you send `S-23`, OK so far. |
| Purchase / receive finished | Lines are `S-23-Z`, `S-23-G` | Decrements **those** rows at B1 — which were never sent → **instant negatives** on variants; family head still holds Q1 forever |
| Closing at binder | “How much S-23 family left?” | No family rollup; only per-SKU shadows |
| Activity / billing | Family issued vs variants received | Report cannot reconcile Q1 vs Q2+Q3 |

Same-SKU poke kit still useful for **agent opt-in / warehouse isolation** tests. It does **not** validate the binder manufacturing loop.

---

## How it should work (recommended shape)

### Core idea: **family WIP bucket + variant consume**

Track shadow qty at binder against the **family head** (or an explicit family key = head `inventory.id`). Purchases of any variant in that family **consume the family bucket**, while warehouse still increases on the **variant** rows (existing purchase inventory behavior).

```
Press P1  --send-->  Binder B1 family S-23   += Q1
Demand decides variants
Purchase from B1:  S-23-Z × Q2, S-23-G × Q3
  → warehouse S-23-Z += Q2, S-23-G += Q3   (already true)
  → vendor WIP family S-23 at B1  -= (Q2 + Q3)
Closing family WIP = Q1 - Q2 - Q3 (± scrap)
```

Press can be a second tracked vendor (P1) if they also hold WIP, or press→binder can be modeled as send **from** nowhere / from warehouse / from press location — policy still open (Session 4 blocker).

### Ledger rules (qty only, still no journals)

| Event | Vendor stock effect | Warehouse effect |
| --- | --- | --- |
| Send family head to binder | Binder family head **+Q** | Unchanged (shadow) *or* −Q if transfer policy |
| Purchase variant from binder | Binder **family head −Q** (resolve variant → family) | Variant **+Q** (existing) |
| Purchase return variant | Family head **+Q** | Variant **−Q** (existing) |
| Send variant explicitly (rare) | Either forbid, or +variant and treat as already-allocated WIP | policy |
| Scrap / yield loss | Family head **−Q** via adjustment | none |

**Resolve variant → family:** `familyInventoryId = item.parentId ?? item.id`. Purchase line on `S-23-G` consumes WIP on head `S-23`.

### What Activity must show

Per vendor, for each **family head** (not every variant as a peer row):

| Column | Meaning |
| --- | --- |
| Opening / Issued / Closing | Family WIP units |
| Received via purchase | Sum of purchase qtys of **all variants in family** (and head if ever purchased) |
| Drill-down | Which variant invoices consumed the bucket |

Optional secondary view: variant warehouse arrivals vs family WIP consumption (yield: received variants vs consumed family — scrap = consumed − received if they differ).

### Opening import

Import rows should target **family heads** (or accept a variant name and coerce to head with a warning). Importing `S-23-G` as opening WIP at binder is usually wrong if WIP is undifferentiated.

### Negatives

Family bucket going negative = finished more variants than family WIP recorded (missing send from press, or wrong family link). Same warn+allow as today, but message names the **family**, not only the variant line.

---

## Alternative shapes (when to use)

### A. Explicit “Allocate / Finish” action (richer, more honest)

WIP stays on family until clerk runs **Finish at binder**: pick family, enter variant qtys (Q2, Q3), optionally scrap. That posts:

- family WIP −(Q2+Q3+scrap)
- optional: temporary variant-at-vendor, or straight to “ready to purchase”

Purchase invoice then only moves warehouse + money, and may also −variant-at-vendor if you keep a second stage.

**Use when:** binding decision is a real shop-floor step before the purchase invoice exists.  
**Skip when:** the purchase invoice *is* that decision (common for this app’s “purchase from binder” ritual).

### B. Same-SKU fiction (what we shipped)

Only works if binding is known **before** press→binder (send `S-23-G`, buy `S-23-G`). Owner’s caveat says demand decides **later** → **reject for binder WIP**.

### C. Attribute `family_code` bucket

If production never filled `parentId` and only has a string attribute, consume-by-attribute. Worse: no FK integrity, typos split families. Prefer migrate/seed `parentId`, then Model family-head.

### D. Full BOM material→finished

Paper/board SKUs → book SKUs with yield. **Different** problem from family→variant. Do not conflate unless press stage is literally raw materials.

---

## What this does to the shipped feature

| Piece | Keep | Change |
| --- | --- | --- |
| Opt-in `tracksVendorStock` | ✓ | — |
| Shadow vs warehouse | ✓ | — |
| Send document | ✓ | Default line picker: **family heads** (or warn if variant) |
| Purchase hook | ✓ path | Decrement **family head**, not line `inventoryId` when line is a variant |
| Activity | ✓ idea | Aggregate by family; purchased = sum of variant consumes |
| Opening import | ✓ | Prefer heads; coerce variants → head |
| Same-SKU tests / poke | ✓ for regression | Add family scenario as the **real** binder test |

Effort: **Medium** if `parentId` is populated in production. **High** if families only exist as name prefixes / ad-hoc attributes — need a data repair first.

---

## Ruthless verdict

You did not “miss a small caveat.” You described a **different product**:

- Shipped: location shadow for identical SKUs.
- Needed: **family WIP pool** at a vendor, consumed by **variant purchases**.

Until consume-by-family exists, binder closing qty will fight the side spreadsheet forever — UX polish will not save it.

Do **not** add more hub chrome before answering the blockers below. The next code change, if any, is the purchase-effect resolution rule + activity aggregation — not another screen.

---

## Questions (blockers)

### Answered

- **Q**: Is family a first-class concept in code? **A**: Yes via `parentId` / catalog `parentSku`. Not via `family_code` attribute in repo.
- **Q**: Do invoices book variants? **A**: Yes — exact `inventoryId` per line.

### Need owner

1. **Is there a stockable head row `S-23`**, or only variants `S-23-*`? (If no head row, we must create WIP-only heads or another family key.)
2. **Is `parentId` filled** on production variants, or only name convention / some attribute?
3. **When goods leave press for binder, is binding known?** (If sometimes known, allow variant sends as already-allocated; if never, force family sends.)
4. **Is the purchase invoice from binder the moment variants are chosen**, or is there an earlier allocate/finish step?
5. **Does press P1 also need WIP tracking**, or only binder B1?
6. **Scrap**: if Q1 family yields Q2+Q3 &lt; Q1, is the rest scrap, still at binder, or returned material?

## Next Steps

- [ ] Answer blockers 1–6 with one real S-23 example (numbers)
- [ ] Check production: `% of variants with parentId NOT NULL`
- [ ] If parentId healthy: design minimal patch — `resolveFamilyInventoryId` in `applyPurchaseEffect` + activity group-by family
- [ ] If parentId empty: data repair before any WIP v2
- [ ] Extend poke kit with family scenario only after rule exists
- [ ] Freeze further same-SKU UX work sold as “binder WIP complete”
