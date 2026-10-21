/* eslint import/prefer-default-export: off */
import { URL } from 'url';
import path from 'path';
import { lookup } from 'dns';
import { get, isEmpty } from 'lodash';
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
