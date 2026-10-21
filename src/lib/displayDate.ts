import { format, isValid } from 'date-fns';

/**
 * The app-wide display format for a calendar date, e.g. '03 Feb, 2026'.
 *
 * Every surface that shows a date to the user goes through here so the app
 * speaks one format. Machine formats (query bounds, sort keys, file names)
 * deliberately do NOT live here — see the `yyyy-MM-dd` usages in the report
 * hooks, which are compared against stored strings.
 */
export const DISPLAY_DATE_FORMAT = 'dd MMM, yyyy';

/** the app-wide display format for a timestamp, e.g. '03 Feb, 2026, 02:05:09 PM'. */
export const DISPLAY_DATETIME_FORMAT = 'dd MMM, yyyy, hh:mm:ss a';

/** compact day + month for narrow cells, e.g. '03 Feb'. */
export const DISPLAY_DAY_MONTH_FORMAT = 'dd MMM';

/** time only for the sync pill, e.g. '02:05 PM'. */
export const DISPLAY_TIME_FORMAT = 'hh:mm a';

/** a bare calendar day as stored in agent_tours / stock_adjustments: '2026-02-03'. */
const BARE_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * a local wall-clock timestamp as SQLite writes it: '2026-02-03 14:05:09'
 * (also accepts the 'T' separator). No timezone suffix means local time.
 */
const LOCAL_CLOCK =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;

/**
 * Parse a stored date into a local Date without ever shifting the calendar day.
 *
 * Stored dates come in three shapes and they do NOT all survive a naive
 * `new Date(raw)`:
 *
 * - `'2026-02-03'` (bare day: agent_tours, stock_adjustments,
 *   vendor_stock_movements). `new Date('2026-02-03')` parses as UTC midnight,
 *   so it renders as Feb 2 in any negative-offset timezone. Handled by
 *   building the local date from its parts.
 * - `'2026-02-03 14:05:09'` (SQLite localtime: createdAt / updatedAt).
 *   Parsed as local wall-clock time.
 * - `'2026-02-03T07:00:00.000Z'` (local-noon ISO: invoices, journals, ledger).
 *   A real instant, so the local getters give the right calendar day.
 *
 * @param raw - a stored date string, or a Date
 * @returns the parsed Date, or null when the value is empty or unparseable
 */
export const parseStoredDate = (
  raw: string | Date | null | undefined,
): Date | null => {
  if (raw == null) return null;

  if (raw instanceof Date) {
    return isValid(raw) ? raw : null;
  }

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const bareDay = BARE_DAY.exec(trimmed);
  if (bareDay) {
    const [, year, month, day] = bareDay;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const localClock = LOCAL_CLOCK.exec(trimmed);
  if (localClock) {
    const [, year, month, day, hour, minute, second, fraction] = localClock;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0,
    );
  }

  const parsed = new Date(trimmed);
  return isValid(parsed) ? parsed : null;
};

/**
 * Format a stored date as the app-wide display date, e.g. '03 Feb, 2026'.
 *
 * @param raw - a stored date string or Date
 * @returns the formatted date, '' for an empty value, or the raw text when it
 *   cannot be parsed (so a bad value stays visible instead of vanishing)
 */
export const formatDisplayDate = (
  raw: string | Date | null | undefined,
): string => {
  const parsed = parseStoredDate(raw);
  if (!parsed) {
    return raw == null ? '' : String(raw).trim();
  }
  return format(parsed, DISPLAY_DATE_FORMAT);
};

/**
 * Format a stored timestamp as the app-wide display timestamp, e.g.
 * '03 Feb, 2026, 02:05:09 PM'.
 */
export const formatDisplayDateTime = (
  raw: string | Date | null | undefined,
): string => {
  const parsed = parseStoredDate(raw);
  if (!parsed) {
    return raw == null ? '' : String(raw).trim();
  }
  return format(parsed, DISPLAY_DATETIME_FORMAT);
};

/**
 * Format a stored date as a compact day + month, e.g. '03 Feb'. Used by
 * narrow cells (the collection sheet's tour column headers).
 */
export const formatDisplayDayMonth = (
  raw: string | Date | null | undefined,
): string => {
  const parsed = parseStoredDate(raw);
  if (!parsed) {
    return raw == null ? '' : String(raw).trim();
  }
  return format(parsed, DISPLAY_DAY_MONTH_FORMAT);
};

/**
 * Format a stored timestamp as a time only, e.g. '02:05 PM'.
 */
export const formatDisplayTime = (
  raw: string | Date | null | undefined,
): string => {
  const parsed = parseStoredDate(raw);
  if (!parsed) {
    return raw == null ? '' : String(raw).trim();
  }
  return format(parsed, DISPLAY_TIME_FORMAT);
};
