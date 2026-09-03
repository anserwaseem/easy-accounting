-- read-only helpers to bind the CSVs to YOUR database.
-- never write. never run these against a copy you care about without a backup first.
--
-- usage:
--   sqlite3 release/app/database.db < docs/examples/vendor-stock/dump-names.sql
--
-- pick TWO real vendors from the first list (one WIP, one agent control)
-- and FOUR real inventory names from the second list.
-- paste those exact strings into opening-happy.csv (code + name + item).

.headers on
.mode column
.timeout 2000

SELECT '--- candidate vendors (creditors / suppliers) ---' AS hint;
SELECT id, code, name, COALESCE(tracksVendorStock, 0) AS tracksVendorStock, isActive
FROM account
WHERE isActive = 1
ORDER BY name
LIMIT 80;

SELECT '--- inventory SKUs (name is the match key — exact, trimmed) ---' AS hint;
SELECT id, name, quantity AS warehouse_qty
FROM inventory
ORDER BY name COLLATE NOCASE
LIMIT 80;

SELECT '--- already flagged WIP vendors (empty until you tick the checkbox) ---' AS hint;
SELECT id, code, name
FROM account
WHERE COALESCE(tracksVendorStock, 0) = 1;
