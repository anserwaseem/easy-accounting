/**
 * SQL + row mapping for the catalog export, kept separate from the service so
 * the exact query and mapping are pure (no better-sqlite3 / Electron imports)
 * and can be exercised directly in tests / validation harnesses.
 *
 * Scope: an item is a "catalog candidate" if it has been enriched with
 * attributes OR has any price-list price. Raw accounting items (no attributes,
 * no list price) are excluded. Generic — no AZS assumptions.
 */
import type { CatalogSourceRow } from './catalog';

export interface RawCatalogRow {
  sku: string;
  name: string;
  parentSku: string | null;
  basePrice: number | null;
  quantity: number | null;
  attributes: string | null;
  pricesJson: string | null;
}

export const CATALOG_QUERY = `
  SELECT
    i.name AS sku,
    i.name AS name,
    par.name AS parentSku,
    i.price AS basePrice,
    i.quantity AS quantity,
    i.attributes AS attributes,
    (
      SELECT json_group_object(pl.name, ip.price)
      FROM inventory_prices ip
      JOIN price_lists pl ON pl.id = ip.priceListId
      WHERE ip.inventoryId = i.id
    ) AS pricesJson
  FROM inventory i
  LEFT JOIN inventory par ON par.id = i.parentId
  WHERE i.attributes IS NOT NULL
     OR EXISTS (SELECT 1 FROM inventory_prices ip WHERE ip.inventoryId = i.id)
  ORDER BY i.name
`;

function parseJsonObject(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function mapCatalogRow(
  raw: RawCatalogRow,
  imageSkus: Set<string>,
): CatalogSourceRow {
  const prices = parseJsonObject(raw.pricesJson) as Record<string, number>;
  return {
    sku: raw.sku,
    name: raw.name,
    parentSku: raw.parentSku ?? null,
    basePrice: Number(raw.basePrice ?? 0),
    quantity: Number(raw.quantity ?? 0),
    attributes: parseJsonObject(raw.attributes),
    prices,
    hasImage: imageSkus.has(raw.sku),
  };
}
