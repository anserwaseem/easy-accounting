/* eslint import/prefer-default-export: off */
import { URL } from 'url';
import path from 'path';
import { format, isValid, parse, parseISO } from 'date-fns';
import { lookup } from 'dns';
import { get, isEmpty, toNumber } from 'lodash';
import { hostname } from 'node:os';
import cp from 'node:child_process';

/**
 * Throws an error with the given message. Useful for nullish coalescing with ?? operator.
 * @param err - The error message to throw.
 * @throws {Error} Always throws an error.
 * @example const id = props.params.id ?? raise("no id provided");
 */
export const raise = (err: string): never => {
  throw new Error(err);
};

export function resolveHtmlPath(htmlFileName: string) {
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.PORT || 3001;
    const url = new URL(`http://localhost:${port}`);
    url.pathname = htmlFileName;
    return url.href;
  }
  return `file://${path.resolve(__dirname, '../renderer/', htmlFileName)}`;
}

/**
 * Formats a date to 'DD-MMM-YY' format (e.g., '01-oct-24', '02-oct-24')
 * @param date - Date object or string or number that can be parsed into a Date
 * @returns formatted date string
 */
export const formatDate = (date: Date | string | number): string => {
  return format(new Date(date), 'dd-MMM-yy').toLowerCase();
};

/** calendar yyyy-MM-dd in UTC for ISO strings (handles Z and offsets without shifting the wrong calendar day). */
const formatIsoLikeStringAsUtcYmd = (s: string): string | null => {
  const d = parseISO(s);
  if (!isValid(d)) {
    return null;
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * normalizes invoice/journal date strings to yyyy-MM-dd so SQLite datetime() sorts and compares correctly.
 * slash forms like 02/03/2026 are parsed as US (M/D/YYYY); ISO strings use the UTC calendar date.
 */
export const normalizeToSqliteDate = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return raise('date is required');
  }
  // date-only strings must stay in local calendar (do not UTC-shift).
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  // ISO-like strings with time/timezone should normalize to the UTC calendar day.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const ymd = formatIsoLikeStringAsUtcYmd(trimmed);
    if (ymd) {
      return ymd;
    }
  }
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const month = toNumber(slash[1]);
    const day = toNumber(slash[2]);
    const year = toNumber(slash[3]);
    const parsed = parse(`${month}/${day}/${year}`, 'M/d/yyyy', new Date(0));
    if (isValid(parsed)) {
      return format(parsed, 'yyyy-MM-dd');
    }
  }
  const fallback = new Date(trimmed);
  if (!Number.isNaN(fallback.getTime())) {
    return format(fallback, 'yyyy-MM-dd');
  }
  return raise(`unparseable date: ${raw}`);
};

/**
 * Converts a date string with ordinal (e.g., "October 1st, 2024") to formatted date
 * @param dateStr - Date string in format "Month DDth, YYYY"
 * @returns formatted date string (e.g., '01-oct-24')
 */
export const convertOrdinalDate = (dateStr: string): string => {
  // Remove ordinal indicators (st, nd, rd, th)
  const cleanDateStr = dateStr.replace(/(st|nd|rd|th),/g, ',');

  // Parse the cleaned date string
  const parsedDate = parse(cleanDateStr, 'MMMM d, yyyy', new Date());

  // Format to desired output
  return formatDate(parsedDate);
};

/**
 * checks if the system is connected to the internet
 * @returns a promise that resolves to true if online, false otherwise
 */
export const isOnline = (): Promise<boolean> => {
  return new Promise((resolve) => {
    lookup('google.com', (err) => {
      if (err && get(err, 'code') === 'ENOTFOUND') {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
};

/**
 * Gets the computer name based on the operating system.
 * @returns The computer name.
 * @see https://stackoverflow.com/a/75309339/13183269
 */
export const getComputerName = (): string => {
  const defaultName = hostname();

  try {
    switch (process.platform) {
      case 'win32':
        return isEmpty(process.env.COMPUTERNAME)
          ? defaultName
          : process.env.COMPUTERNAME!;
      case 'darwin': {
        const name = cp
          .execSync('scutil --get ComputerName', { timeout: 3000 })
          .toString()
          .trim();
        return isEmpty(name) ? defaultName : name;
      }
      case 'linux': {
        const name = cp
          .execSync('hostnamectl --pretty', { timeout: 3000 })
          .toString()
          .trim();
        return isEmpty(name) ? defaultName : name;
      }
      default:
        return defaultName;
    }
  } catch (error) {
    console.error('Error getting computer name:', error);
    return defaultName;
  }
};

/**
 * Formats a string by capitalizing the first letter of each word
 * @param input - The input string to format
 * @param separator - The separator to use to split the string (default is '-')
 * @returns The formatted string with capitalized words
 */
export const formatString = (input = '', separator = '-') => {
  const words = input.split(separator);

  const capitalizedWords = words.map(
    (word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
  );

  return capitalizedWords.join(' ');
};
