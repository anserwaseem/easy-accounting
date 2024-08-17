/* eslint-disable no-redeclare */

/**
 * Represents a boolean value in SQLite, where 0 is false and 1 is true.
 */
export type SqliteBoolean = 0 | 1;

/**
 * Casts various types to their SQLite-compatible representations.
 *
 * @param value - The value to cast. Can be either a boolean or a Date.
 * @returns The SQLite-compatible representation of the input.
 * @throws {Error} If the input type is neither boolean nor Date.
 */
export function cast(value: boolean): SqliteBoolean;
export function cast(date: Date): string;
export function cast(value: boolean | Date): SqliteBoolean | string {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value instanceof Date) {
    const pad = (num: number): string => num.toString().padStart(2, '0');

    const year = value.getFullYear();
    const month = pad(value.getMonth() + 1); // Months are zero-based
    const day = pad(value.getDate());
    const hours = pad(value.getHours());
    const minutes = pad(value.getMinutes());
    const seconds = pad(value.getSeconds());

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  throw new Error('Invalid input type for cast function');
}
