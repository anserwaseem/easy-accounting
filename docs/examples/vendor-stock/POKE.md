# Poke vendor stock (WIP)

Test the **shipped** feature on branch `cursor/vendor-stock-tracking-e7ef` (PR #152). No extra product code. This kit only gives you a CSV + a ritual.

Import matches **exact** `account.code` / `account.name` (must already have **Track stock at vendor (WIP)** ticked) and exact `inventory.name`. Placeholder `REPLACE_*` strings will not import — that is intentional.

## 0. Safety

This writes to your live SQLite file. **Copy the database first.**

```bash
cp release/app/database.db "/tmp/database-before-vendor-stock-$(date +%Y%m%d).db"
```

If anything looks wrong: quit the app, restore that copy over `release/app/database.db`. Do not edit `.db` files by hand.

Use a **copy of production**, not the only copy, if you can.

## 1. Bind the CSV to your books (5 minutes)

You need:

| Role in the story | What to pick in YOUR data |
| --- | --- |
| Binder (WIP) | A real processor / binder / printer account |
| Press (WIP) | A second processor account |
| Agent (control) | A consignment / tour agent you buy returns through — **do not** tick WIP |
| Items A B C D | Four real inventory **names** (SKU). A will sit at **two** vendors |

Dump candidates (read-only):

```bash
sqlite3 release/app/database.db < docs/examples/vendor-stock/dump-names.sql
```

Open `docs/examples/vendor-stock/opening-happy.csv` and replace every `REPLACE_*` token. Same replacements in `opening-reset-subset.csv` and `opening-should-fail.csv`.

Leave the `notes` column. Parser ignores it.

**Code vs name:** if `vendor_code` is filled, lookup uses code (and ignores a mismatched name). Prefer real codes. Empty code + exact name also works.

## 2. App prep

1. Run the feature branch (`npm start` or your usual packaged build). Migration `025_vendor_stock` must apply on startup.
2. **Accounts** → edit Binder → tick **Track stock at vendor (WIP)** → Save. Repeat for Press. Leave Agent **unticked**.
3. Confirm **WIP** badges on those two account rows.
4. Sidebar: **Vendor Stock** should list those two under the vendor filter. Agent must **not** appear.

Warehouse sanity: on Inventory (or a note), jot warehouse qty for item **A** before you touch anything. Send must **not** change it. Purchase **will**.

## 3. Import opening (happy file)

**Vendor Stock** → **Set starting qty** (or **Import opening**, older label).

1. As-of date: **yesterday or earlier** (see §8). Not today if you want Activity “Opening” to show these numbers.
2. Leave **reset others** **off**.
3. Choose `opening-happy.csv`.
4. On current PR: preview table → **Confirm import**. File pick must not write by itself.
5. Expect success toast. If “Vendor not found” / “Track stock at vendor” / “Inventory item not found”: names/codes/flag still wrong. Fix CSV; do not keep retrying blind.

**At vendor** expected:

| Vendor | Item | Qty |
| --- | --- | --- |
| Binder | A | 100 |
| Binder | B | 40 |
| Press | A | 25 |
| Press | B | **15** (15.9 floored) |
| Press | D | 80 |

Binder C at 0: hub may **omit** zero rows (`quantity != 0`). That is OK.

Same SKU **A** at two vendors: this is the feature, not a bug.

## 4. Send to vendor (warehouse must stay)

Jot warehouse qty of **A**.

1. **Send to vendor** (shortcut **⌘4 / Ctrl+4**).
2. Vendor = Binder. Date = **today**. Line: item A, qty **20**. Save.
3. **At vendor**: Binder A = **120**. Press A still **25**.
4. Warehouse A **unchanged**. If it moved, stop — that is a product bug.

Optional: second send, Binder item C qty **10** → C appears at 10.

## 5. Purchase from WIP vendor (the receive ritual)

**Purchase → New invoice.** Pick **Binder**. Party label should show **· WIP**. Banner should warn: posting reduces qty at vendor; warehouse still increases.

- Date today. One line: item **A**, qty **30**. Post.

Expect:

- Success toast **and** a second toast **At vendor stock** (`A: -30 (now 90)` or similar).
- Binder A = **90**. Press A still **25**.
- Warehouse A **+30**.

If no banner / no second toast / party has no · WIP: flag not loaded on that party. Check `tracksVendorStock` on the account and that you used the Binder account, not a similarly named one.

## 6. Control: purchase from Agent (must NOT touch WIP)

New purchase, party = **Agent** (no · WIP, no banner).

- Item **A**, qty **10**. Post.

Expect:

- Warehouse A **+10**.
- Binder A still **90**. Press A still **25**.
- **No** “At vendor stock” toast.

This is the consignment-return trap. If Agent WIP drops, the opt-in failed.

## 7. Negatives (warn + allow)

Purchase from Binder: item **B**, qty **200** (only 40 at vendor, no extra send).

Expect:

- Post **succeeds**.
- Destructive / warning toast: B negative.
- Binder B = **40 − 200 = −160**, shown **red** on hub.

That is intended. Missing sends surface as negatives.

## 8. Activity report (math + the opening-date trick)

**Reports → At-vendor activity** (or Vendor Stock Activity). Vendor = Binder. Range = **this month**. **Run**.

Identity (Binder, after steps above, openings dated **before** range start):

| Item | Opening | Issued (sends in range) | Received via purchase | Closing (approx) |
| --- | --- | --- | --- | --- |
| A | 100 | 20 | 30 | 90 |
| B | 40 | 0 | 200 | −160 |
| C | 0 or 10 | 10 if you sent C | 0 | 10 |

If you imported **as-of today** (inside the range): those opening movements land in **Adjusted**, not Opening. Annoying but current. Re-run with as-of yesterday to see Opening populated.

Print / Excel: headers should say **Received via purchase**, not raw “Purchased”.

## 9. Edit + delete a send

1. Hub **Sends** → edit the A×20 send → change qty to **25** → save.
2. Binder A should become **95** (90 −20 +25, relative to the pre-edit 90 after purchase… wait — edits **rewrite** the send: reverse original +20, apply +25. After purchase the stock is 90 which already included the +20. Reverse 20 → 70, apply 25 → **95**). Warehouse unchanged.
3. Delete that send (confirm dialog). Reverse +25 → Binder A = **70**. Send row gone.

If warehouse moved on edit/delete: bug.

## 10. Reset-others import (destructive — do last)

Only after you are happy with §§3–9.

1. Set starting qty again. As-of = today. Tick **reset others** (warning should go red).
2. Confirm `opening-reset-subset.csv` (Binder + A=90 only).
3. Binder **A = 90**. Binder **B and C = 0** (zeroed). Press rows **untouched**.

If Press A/D changed: reset leaked across vendors — bug.

## 11. Failure file (no writes)

`opening-should-fail.csv` with Binder + fake SKU, and Agent + real SKU.

Expect **error toast**, **no** qty change. Whole file is one transaction. **First error wins** — fake SKU usually fires before the Agent row. To test untracked-vendor: keep only the Agent line in a throwaway copy.

Also try: CSV with a negative quantity → parser error before DB.

## 12. Quotation convert (optional)

Purchase **quotation** from Binder, item A qty 5. Should **not** change vendor qty until you **convert** on the invoice detail screen. After convert: vendor A −5 + warehouse +5 + toast.

## Stop / pass bar

**Pass** if all of these hold:

- Same item can sit at two vendors.
- Send never touches warehouse.
- WIP purchase lowers vendor qty and raises warehouse.
- Agent purchase never lowers vendor qty.
- Negatives allowed + visible.
- Edit/delete send reverse vendor qty only.
- Unknown item / untracked vendor import writes nothing.

**Not in scope** (do not file as bugs while poking v1):

- Send decreasing warehouse (shadow by design).
- Paper → finished-book SKU conversion (none).
- Click-through from activity totals to invoices (none yet).
- “Adjusted” including in-range opening imports (known lie).

## Files

| File | Use |
| --- | --- |
| `opening-happy.csv` | Seed two vendors, four items, duplicate, decimal floor |
| `opening-reset-subset.csv` | Reset-others after happy path |
| `opening-should-fail.csv` | Rollback |
| `dump-names.sql` | Read-only name dump |
