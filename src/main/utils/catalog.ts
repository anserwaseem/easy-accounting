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
  /** Explicit "hold this back" override, set per item by the business. */
  excludeFromCatalog: boolean;
}

export interface CatalogOptions {
  /**
   * The single price list the business has marked public. Exactly one, because
   * every downstream consumer (storefront, ad feed) needs one price per item;
   * publishing several would only push the choice downstream.
   */
  publicPriceList: string;
  /**
   * Attribute keys the business has marked public (attribute_definitions.isPublic).
   *
   * Attributes are free-form per business, so they routinely carry internal
   * bookkeeping — import flags, sourcing notes, sales history. Publishing is
   * therefore opt-in: only these keys reach the public catalog. Omitting this
   * publishes nothing, which is the safe direction to fail.
   */
  publicAttributeKeys?: readonly string[];
  /**
   * Whether an item still needs a photograph to be publishable. Defaults to
   * true, which is the only state a live storefront should ever be in.
   *
   * Turned off to stand the whole catalogue up before the photography is done —
   * so categories, filters, navigation and checkout can be exercised at real
   * scale instead of against a handful of items. The storefront then shows its
   * own placeholder for anything unphotographed.
   *
   * Deliberately a *flag*, not placeholder images written into the manifest.
   * Fake images would make `hasImage` true for ever: the app could no longer
   * answer "which items still need a photograph", and the gate that keeps
   * unsellable items off the shop would be gone rather than merely relaxed.
   * Turning this back on drafts them again on the next publish, with nothing
   * for anyone to remember.
   */
  requireImage?: boolean;
  /**
   * Attribute keys an item must carry before it can be published.
   *
   * A capability, not a policy: this module knows nothing about which
   * attributes matter to a given business. It exists because some attributes
   * are not descriptive but *structural* — a downstream consumer branches on
   * them — and an item missing one does not fail, it gets silently filed under
   * whatever the default branch happens to be. Refusing to publish is the
   * honest answer: an unclassified item is not ready, in exactly the way an
   * unpriced one is not.
   *
   * Empty (the default) requires nothing, so an installation that has no such
   * attribute is unaffected.
   */
  requiredAttributeKeys?: readonly string[];
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

/**
 * The row's attributes narrowed to the keys marked public — a whitelist, so a
 * newly-invented key is private until someone says otherwise.
 */
export function publicAttributesOf(
  row: CatalogSourceRow,
  publicAttributeKeys: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of publicAttributeKeys) {
    const value = row.attributes?.[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The row's public price (from the configured list), or null when absent/<=0. */
export function publicPriceOf(
  row: CatalogSourceRow,
  publicPriceList: string,
): number | null {
  if (!publicPriceList) return null;
  const price = row.prices[publicPriceList];
  return typeof price === 'number' && price > 0 ? price : null;
}

/** Why an item is not ready. `missing ${key}` names a required attribute. */
export type PublishBlocker =
  | 'no image'
  | 'no public price'
  | 'no public attributes'
  | `missing ${string}`;

/**
 * Every reason this item cannot be published. Empty means ready.
 *
 * **This is the definition of publishable, and the only one.** It returns the
 * reasons rather than a verdict because both callers need both: the catalog
 * needs a boolean, and the inventory table needs to tell the user *what to go
 * and fix*. Those were two implementations of the same rule for a while — one
 * here and one in the service — and they drifted twice, each time producing a
 * Publish column that disagreed with what a publish actually did. A rule that
 * is stated once cannot disagree with itself.
 *
 * Judged on public attributes only: an item described entirely by internal keys
 * has nothing to show a customer.
 *
 * Exclusion is deliberately *not* a blocker. "Held back" is a decision, not a
 * deficiency — the item may meet every condition — so callers check
 * `excludeFromCatalog` themselves and report it as its own state.
 */
export function publishBlockers(
  row: CatalogSourceRow,
  options: CatalogOptions,
): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (!row.hasImage && (options.requireImage ?? true)) {
    blockers.push('no image');
  }
  if (publicPriceOf(row, options.publicPriceList) === null) {
    blockers.push('no public price');
  }
  if (!hasAttributes(publicAttributesOf(row, options.publicAttributeKeys))) {
    blockers.push('no public attributes');
  }
  // named individually: "missing product_type" says what to set, where a
  // generic "missing a required attribute" would leave you hunting
  for (const key of missingRequiredAttributes(
    row,
    options.requiredAttributeKeys,
  )) {
    blockers.push(`missing ${key}`);
  }
  return blockers;
}

/** Ready to publish: not held back, and nothing blocking. */
export function isPublishable(
  row: CatalogSourceRow,
  options: CatalogOptions,
): boolean {
  return !row.excludeFromCatalog && publishBlockers(row, options).length === 0;
}

/** Required attribute keys this row does not carry a value for. */
export function missingRequiredAttributes(
  row: CatalogSourceRow,
  requiredAttributeKeys: readonly string[] = [],
): string[] {
  return requiredAttributeKeys.filter((key) => {
    const value = row.attributes?.[key];
    return value === undefined || value === null || value === '';
  });
}

/** Parses the configured list: comma or whitespace separated, blanks dropped. */
export function parseAttributeKeyList(raw: string): string[] {
  return (raw || '')
    .split(/[,\s]+/)
    .map((k) => k.trim())
    .filter(Boolean);
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
      publishable: isPublishable(r, options),
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
      attributes: publicAttributesOf(r, options.publicAttributeKeys),
      price,
      hasImage: r.hasImage,
      publishable: isPublishable(r, options),
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
