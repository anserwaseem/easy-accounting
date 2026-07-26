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
  /**
   * The single price list the business has marked public. Exactly one, because
   * every downstream consumer (storefront, ad feed) needs one price per item;
   * publishing several would only push the choice downstream.
   */
  publicPriceList: string;
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
  /** The public price — from the configured public price list. */
  price: number;
  hasImage: boolean;
  publishable: boolean;
}

interface FullCatalog {
  version: number;
  generatedAt: string | null;
  priceLists: string[];
  publicPriceList: string;
  count: number;
  items: FullCatalogItem[];
}

interface PublicCatalog {
  version: number;
  generatedAt: string | null;
  /** Which price list the published `price` came from. */
  publicPriceList: string;
  count: number;
  items: PublicCatalogItem[];
}

const VERSION = 1;

const hasAttributes = (attrs: Record<string, unknown>): boolean =>
  attrs != null && Object.keys(attrs).length > 0;

/** The row's public price (from the configured list), or null when absent/<=0. */
export function publicPriceOf(
  row: CatalogSourceRow,
  publicPriceList: string,
): number | null {
  if (!publicPriceList) return null;
  const price = row.prices[publicPriceList];
  return typeof price === 'number' && price > 0 ? price : null;
}

/** publishable = has attributes + a positive public price + has image. */
export function isPublishable(
  row: CatalogSourceRow,
  publicPriceList: string,
): boolean {
  return (
    hasAttributes(row.attributes) &&
    publicPriceOf(row, publicPriceList) !== null &&
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
    publicPriceList: options.publicPriceList,
    count: rows.length,
    items: rows.map((r) => ({
      ...r,
      publishable: isPublishable(r, options.publicPriceList),
    })),
  };
}

/**
 * Public catalog: only rows carrying a public price, and each item exposes that
 * one price and no base price. Built field-by-field so private data cannot leak
 * through an accidental spread.
 */
export function buildPublicCatalog(
  rows: CatalogSourceRow[],
  options: CatalogOptions,
  generatedAt: string | null = null,
): PublicCatalog {
  const items: PublicCatalogItem[] = [];
  for (const r of rows) {
    const price = publicPriceOf(r, options.publicPriceList);
    if (price === null) continue; // nothing public to show
    items.push({
      sku: r.sku,
      name: r.name,
      parentSku: r.parentSku,
      quantity: r.quantity,
      attributes: r.attributes,
      price,
      hasImage: r.hasImage,
      publishable: isPublishable(r, options.publicPriceList),
    });
  }
  return {
    version: VERSION,
    generatedAt,
    publicPriceList: options.publicPriceList,
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
 * attribute key present, then the public `price`. Never includes the base
 * price. A flat convenience format; feed-specific column mapping is a
 * downstream (ops) concern.
 */
export function toProductsCsv(publicCatalog: PublicCatalog): string {
  const attrKeys = new Set<string>();
  for (const it of publicCatalog.items) {
    for (const k of Object.keys(it.attributes ?? {})) attrKeys.add(k);
  }
  const attrCols = [...attrKeys].sort();

  const header = [
    'sku',
    'name',
    'parentSku',
    'quantity',
    ...attrCols.map((k) => `attr.${k}`),
    'price',
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
      it.price,
      it.hasImage,
      it.publishable,
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}
