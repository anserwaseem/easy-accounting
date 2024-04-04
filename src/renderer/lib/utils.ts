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

var MAX_DEPTH = 20;

export var expandedLog = (obj: Record<string, unknown>, depth: number = 0) => {
  var [[name, item]] = Object.entries(obj);
  if (depth < MAX_DEPTH && typeof item === 'object' && item) {
    var typeString = Object.prototype.toString.call(item);
    var objType = typeString.replace(/\[object (.*)\]/, '$1');

    console.group(`${name}: ${objType}`);
    Object.entries(item).forEach(([key, value]: any) => {
      console.log({ [key]: value }, depth + 1);
    });
    console.groupEnd();
  } else {
    var itemString = `${item}`;
    if (typeof item === 'string') {
      itemString = `"${itemString}"`;
    }
    console.log(`${name}: ${itemString}`);
    return;
  }
};
