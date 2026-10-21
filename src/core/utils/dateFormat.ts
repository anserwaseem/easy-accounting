import { parse } from 'date-fns';
import {
  formatDisplayDate,
  formatDisplayDateTime,
} from '../../lib/displayDate';

/**
 * Formats a date to the app-wide display format, e.g. '03 Feb, 2026'.
 * Pure, no platform dependency — safe to call from the main process.
 * @param date - Date object or string or number that can be parsed into a Date
 * @returns formatted date string
 */
export const formatDate = (date: Date | string | number): string => {
  return formatDisplayDate(date instanceof Date ? date : new Date(date));
};

/**
 * Formats a timestamp to the app-wide display format, e.g.
 * '03 Feb, 2026, 02:05 PM'. Safe to call from the main process.
 */
export const formatDateTime = (date: Date | string | number): string => {
  return formatDisplayDateTime(date instanceof Date ? date : new Date(date));
};

/**
 * Converts a date to the app-wide display format.
 *
 * Accepts either a stored date ('2026-02-03' or a local-noon ISO string) or a
 * long-form ordinal string ('October 1st, 2024'). The old implementation only
 * understood the long form and threw a RangeError on the stored shapes the
 * database actually holds.
 *
 * @param dateStr - the date value to format
 * @returns formatted date string, e.g. '03 Feb, 2026'
 */
export const convertOrdinalDate = (dateStr: string): string => {
  const trimmed = (dateStr ?? '').trim();
  if (!trimmed) return '';

  // long-form ordinal, e.g. "October 1st, 2024" — remove the ordinal suffix
  if (/[A-Za-z]/.test(trimmed)) {
    const cleanDateStr = trimmed.replace(/(st|nd|rd|th),/g, ',');
    const parsedDate = parse(cleanDateStr, 'MMMM d, yyyy', new Date());
    if (!Number.isNaN(parsedDate.getTime())) {
      return formatDisplayDate(parsedDate);
    }
  }

  return formatDisplayDate(trimmed);
};
