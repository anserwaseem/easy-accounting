-- Run against YOUR shop backup (read-only). Answers Session 5 blockers.
-- Example:
--   sqlite3 "/path/to/database-backup_2026-09-03T13-49-38-969Z.db" < docs/examples/vendor-stock/verify-family-wip.sql
--
-- This cloud environment cannot open a path on your Mac. Paste the output back.

.headers on
.mode column
.timeout 5000

SELECT '=== 1. attribute keys that look like family ===' AS section;
SELECT key, label, type, isPublic
FROM attribute_definitions
WHERE lower(key) LIKE '%family%'
   OR lower(label) LIKE '%family%'
   OR lower(key) LIKE '%parent%'
ORDER BY key;

SELECT '=== 2. parentId coverage (the real family FK) ===' AS section;
SELECT
  COUNT(*) AS inventory_rows,
  SUM(CASE WHEN parentId IS NULL THEN 1 ELSE 0 END) AS heads_or_orphans,
  SUM(CASE WHEN parentId IS NOT NULL THEN 1 ELSE 0 END) AS variants_with_parentId,
  ROUND(
    100.0 * SUM(CASE WHEN parentId IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*),
    1
  ) AS pct_variants
FROM inventory;

SELECT '=== 3. sample S-23-like family (name prefix) ===' AS section;
SELECT id, name, parentId, excludeFromCatalog, quantity AS warehouse_qty
FROM inventory
WHERE name LIKE 'S-23%' OR name LIKE 'S23%'
ORDER BY
  CASE WHEN parentId IS NULL THEN 0 ELSE 1 END,
  name
LIMIT 40;

SELECT '=== 4. does head row exist for families that have variants? ===' AS section;
SELECT
  v.parentId AS head_id,
  h.name AS head_name,
  COUNT(*) AS variant_count,
  GROUP_CONCAT(v.name, ', ') AS variant_names
FROM inventory v
LEFT JOIN inventory h ON h.id = v.parentId
WHERE v.parentId IS NOT NULL
GROUP BY v.parentId
ORDER BY variant_count DESC
LIMIT 15;

SELECT '=== 5. variants whose parentId points nowhere (broken) ===' AS section;
SELECT v.id, v.name, v.parentId
FROM inventory v
LEFT JOIN inventory h ON h.id = v.parentId
WHERE v.parentId IS NOT NULL AND h.id IS NULL
LIMIT 20;

SELECT '=== 6. name-prefix "families" with NO parentId link ===' AS section;
-- crude: names with a trailing -X / -XX style suffix, parentId null,
-- and another row whose name is the prefix. Shows convention-only families.
WITH candidates AS (
  SELECT
    id,
    name,
    parentId,
    CASE
      WHEN name GLOB '*-*' THEN substr(name, 1, length(name) - length(replace(name, '-', '')) )
      ELSE NULL
    END AS rough
  FROM inventory
)
SELECT 'skipped — see S-23 sample above; fix parentId if variants lack FK' AS note;

SELECT '=== 7. attribute JSON: any family_code values in use? ===' AS section;
SELECT id, name, json_extract(attributes, '$.family_code') AS family_code_attr
FROM inventory
WHERE json_extract(attributes, '$.family_code') IS NOT NULL
LIMIT 20;

SELECT id, name, attributes
FROM inventory
WHERE attributes LIKE '%family%'
LIMIT 10;

SELECT '=== 8. purchase parties that look like binders/presses (name sniff) ===' AS section;
SELECT id, code, name, COALESCE(tracksVendorStock, 0) AS tracksVendorStock
FROM account
WHERE isActive = 1
  AND (
    lower(name) LIKE '%bind%'
    OR lower(name) LIKE '%press%'
    OR lower(name) LIKE '%print%'
    OR lower(name) LIKE '%kutb%'
    OR lower(name) LIKE '%binder%'
  )
ORDER BY name
LIMIT 40;
