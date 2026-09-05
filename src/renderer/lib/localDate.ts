export const toLocalDateInputValue = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const toLocalNoonDate = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);

export const toLocalNoonIsoString = (date: Date): string =>
  toLocalNoonDate(date).toISOString();

/** hydrate a stored date (YYYY-MM-DD or ISO) as local-noon ISO, same as invoice dates. */
export const toLocalNoonIsoStringFromStored = (raw: string): string => {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(5, 7));
    const day = Number(trimmed.slice(8, 10));
    return toLocalNoonIsoString(new Date(year, month - 1, day));
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime())
    ? toLocalNoonIsoString(new Date())
    : toLocalNoonIsoString(parsed);
};
