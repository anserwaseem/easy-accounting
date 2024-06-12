import { Row, SortingFn } from '@tanstack/react-table';
import { type ClassValue, clsx } from 'clsx';
import { every, isArray, isNil, toString, toLower } from 'lodash';
import { twMerge } from 'tailwind-merge';

/**
 * Combines multiple class names into a single string.
 * @param inputs - The class names to be combined.
 * @returns The combined class names as a string.
 */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/**
 * Checks if the given object is a two-dimensional array.
 * @param obj - The object to be checked.
 * @returns `true` if the object is a two-dimensional array, `false` otherwise.
 */
export const isTwoDimensionalArray = (obj: unknown) => {
  if (isArray(obj)) {
    if (obj.length === 0) return false;

    return every(obj, isArray);
  }
  return false;
};

/**
 * Removes empty subarrays from a list.
 * @param list The list of subarrays.
 * @returns The list with empty subarrays removed.
 */
export const removeEmptySubarrays = (list: unknown[][]): unknown[][] =>
  list.filter((subarray) => !every(subarray, isNil));

/**
 * Converts a value to a lowercase string.
 * @param value - The value to be converted.
 * @returns The lowercase string.
 * @example toLowerString('Hello World'); // 'hello world'
 */
export const toLowerString = (value: unknown) => toLower(toString(value));

/**
 * Rounds a number to a fixed number of decimal places.
 * @param value - The number to be rounded.
 * @param fixed - The number of decimal places to round to.
 * @returns The rounded number.
 * @example getFixedNumber(1.23456, 2); // 1.23
 * @default fixed 4
 */
export const getFixedNumber = (value: number, fixed = 4) =>
  Number(value.toFixed(fixed));

/**
 * Returns the default sorting functions for the table.
 * @returns The default sorting functions.
 * @example <DataTable sortingFns={defaultSortingFunctions} {...otherProps} />
 */
export const defaultSortingFunctions: Record<string, SortingFn<any>> = {
  date: dateComparator,
  createdAt: dateComparator,
  updatedAt: dateComparator,
};

/**
 * PRIVATE FUNCTIONS
 */

function dateComparator(rowA: Row<any>, rowB: Row<any>): number {
  return (
    new Date(rowA.original.date).getTime() -
    new Date(rowB.original.date).getTime()
  );
}
