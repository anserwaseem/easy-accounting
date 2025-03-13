/* eslint import/prefer-default-export: off */
import { URL } from 'url';
import path from 'path';
import { format, parse } from 'date-fns';
import { lookup } from 'dns';
import { get, isEmpty } from 'lodash';
import { hostname } from 'node:os';
import cp from 'node:child_process';

export function resolveHtmlPath(htmlFileName: string) {
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.PORT || 1212;
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
