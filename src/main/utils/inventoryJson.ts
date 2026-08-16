/**
 * Parsers for the JSON columns/aggregates the inventory query returns.
 *
 * Kept separate and pure so the (defensive) parsing of user-supplied attribute
 * JSON and of the price aggregate can be unit-tested. Both must never throw:
 * a malformed value degrades to empty rather than breaking the whole page.
 */

/** Parses an attributes JSON object; anything unusable becomes {}. */
export function parseJsonRecord(
  raw: string | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Parses json_group_object(priceListId, price) into { [priceListId]: price }.
 * Keys arrive as strings from SQLite's JSON1, so they are coerced to numbers.
 */
export function parseListPrices(
  raw: string | null | undefined,
): Record<number, number> {
  const parsed = parseJsonRecord(raw);
  const out: Record<number, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const id = Number(key);
    const price = Number(value);
    if (Number.isFinite(id) && Number.isFinite(price)) out[id] = price;
  }
  return out;
}
