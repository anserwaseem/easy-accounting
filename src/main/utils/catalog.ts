/**
 * Pure catalog-shaping logic for the Publish feature.
 *
 * Deliberately free of DB / Electron / filesystem imports so it can be
 * exhaustively unit-tested — most importantly the tier-separation guarantee:
 * the base ("private") price and any non-public price list must NEVER appear in
 * the public catalog or the CSV. That is enforced structurally here by building
 * public items from a whitelist of fields rather than by filtering a full item.
 *
 * This module is generic: it knows nothing about AZS, "tajirana", or Urdu. A
 * business decides which named price lists are public via configuration; the
 * base `inventory.price` is treated as private and is never published.
 */

/** One inventory item as the service reads it from the DB (generic shape). */
export interface CatalogSourceRow {
  sku: string;
  name: string;
  parentSku: string | null;
  /** inventory.price — the base/private price. Never published. */
  basePrice: number;
  quantity: number;
  /** Parsed inventory.attributes JSON, keyed by attribute_definitions.key. */
  attributes: Record<string, unknown>;
  /** priceListName -> price, for ALL price lists the item has. */
  prices: Record<string, number>;
  /** Whether an image exists for this SKU (per the images manifest). */
  hasImage: boolean;
}

interface CatalogOptions {
  /** Names of price lists the business has marked public. */
  publicPriceLists: string[];
}

interface FullCatalogItem extends CatalogSourceRow {
  publishable: boolean;
}

/** Public item — a whitelist. Intentionally has NO basePrice field. */
interface PublicCatalogItem {
  sku: string;
  name: string;
  parentSku: string | null;
  quantity: number;
  attributes: Record<string, unknown>;
  /** Only public price lists. */
  prices: Record<string, number>;
  hasImage: boolean;
  publishable: boolean;
}

interface FullCatalog {
  version: number;
  generatedAt: string | null;
  priceLists: string[];
  publicPriceLists: string[];
  count: number;
  items: FullCatalogItem[];
}

interface PublicCatalog {
  version: number;
  generatedAt: string | null;
  priceLists: string[];
  count: number;
  items: PublicCatalogItem[];
}

const VERSION = 1;

const hasAttributes = (attrs: Record<string, unknown>): boolean =>
  attrs != null && Object.keys(attrs).length > 0;

/** Public prices for a row: the subset of its prices on public lists, > 0. */
export function publicPricesOf(
  row: CatalogSourceRow,
  publicPriceLists: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of publicPriceLists) {
    const price = row.prices[name];
    if (typeof price === 'number' && price > 0) out[name] = price;
  }
  return out;
}

/** publishable = has attributes + at least one (>0) public price + has image. */
export function isPublishable(
  row: CatalogSourceRow,
  publicPriceLists: string[],
): boolean {
  return (
    hasAttributes(row.attributes) &&
    Object.keys(publicPricesOf(row, publicPriceLists)).length > 0 &&
    row.hasImage
  );
}

/** All distinct price-list names across the rows, sorted (stable columns). */
export function allPriceListNames(rows: CatalogSourceRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const n of Object.keys(r.prices)) set.add(n);
  return [...set].sort();
}

export function buildFullCatalog(
  rows: CatalogSourceRow[],
  options: CatalogOptions,
  generatedAt: string | null = null,
): FullCatalog {
  return {
    version: VERSION,
    generatedAt,
    priceLists: allPriceListNames(rows),
    publicPriceLists: [...options.publicPriceLists].sort(),
    count: rows.length,
    items: rows.map((r) => ({
      ...r,
      publishable: isPublishable(r, options.publicPriceLists),
    })),
  };
}

/**
 * Public catalog: only rows that have at least one public price, and each item
 * carries ONLY public prices and no base price. Built field-by-field so private
 * data cannot leak through an accidental spread.
 */
export function buildPublicCatalog(
  rows: CatalogSourceRow[],
  options: CatalogOptions,
  generatedAt: string | null = null,
): PublicCatalog {
  const items: PublicCatalogItem[] = [];
  for (const r of rows) {
    const prices = publicPricesOf(r, options.publicPriceLists);
    if (Object.keys(prices).length === 0) continue; // nothing public to show
    items.push({
      sku: r.sku,
      name: r.name,
      parentSku: r.parentSku,
      quantity: r.quantity,
      attributes: r.attributes,
      prices,
      hasImage: r.hasImage,
      publishable: isPublishable(r, options.publicPriceLists),
    });
  }
  return {
    version: VERSION,
    generatedAt,
    priceLists: [...options.publicPriceLists].sort(),
    count: items.length,
    items,
  };
}

const csvEscape = (value: unknown): string => {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Generic CSV of the public catalog. Columns: fixed fields, then one column per
 * attribute key present, then one per public price list. Never includes the
 * base price. A flat convenience format; feed-specific column mapping is a
 * downstream (ops) concern.
 */
export function toProductsCsv(publicCatalog: PublicCatalog): string {
  const attrKeys = new Set<string>();
  for (const it of publicCatalog.items) {
    for (const k of Object.keys(it.attributes ?? {})) attrKeys.add(k);
  }
  const attrCols = [...attrKeys].sort();
  const priceCols = publicCatalog.priceLists; // already sorted, public-only

  const header = [
    'sku',
    'name',
    'parentSku',
    'quantity',
    ...attrCols.map((k) => `attr.${k}`),
    ...priceCols.map((n) => `price.${n}`),
    'hasImage',
    'publishable',
  ];
  const lines = [header.map(csvEscape).join(',')];
  for (const it of publicCatalog.items) {
    const row = [
      it.sku,
      it.name,
      it.parentSku ?? '',
      it.quantity,
      ...attrCols.map((k) => it.attributes?.[k] ?? ''),
      ...priceCols.map((n) => it.prices[n] ?? ''),
      it.hasImage,
      it.publishable,
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}
