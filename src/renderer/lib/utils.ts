import { Row, SortingFn } from '@tanstack/react-table';
import { type ClassValue, clsx } from 'clsx';
import {
  every,
  isArray,
  isNil,
  toString,
  toLower,
  isEmpty,
  toNumber,
  trim,
} from 'lodash';
import { twMerge } from 'tailwind-merge';
import {
  currencyFormatOptions,
  currencyFormatter,
  currencyIntFormatter,
} from './constants';
import { toast } from '../shad/ui/use-toast';

/**
 * Throws an error with the given message. Useful for nullish coalescing with ?? operator.
 * @param err - The error message to throw.
 * @throws {Error} Always throws an error.
 * @example const id = props.params.id ?? raise("no id provided");
 */
export const raise = (err: string): never => {
  throw new Error(err);
};

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
 * Converts a value to a lowercase, trimmed string.
 * @param value - The value to be converted.
 * @returns The lowercase, trimmed string.
 * @example toLowerTrim('  Hello World  '); // 'hello world'
 */
export const toLowerTrim = (value: unknown) => toLower(trim(toString(value)));

/**
 * Rounds a number to a fixed number of decimal places.
 * @param value - The number to be rounded.
 * @param fixed - The number of decimal places to round to.
 * @returns The rounded number.
 * @example getFixedNumber(1.23456, 2); // 1.23
 * @default fixed = 4
 */
export const getFixedNumber = (value: number, fixed = 4) =>
  Number(value.toFixed(fixed));

/**
 * Returns the default sorting functions for the table.
 * @returns The default sorting functions.
 * @example <DataTable sortingFns={defaultSortingFunctions} {...otherProps} />
 */
export const defaultSortingFunctions: Record<string, SortingFn<any>> = {
  date: dateStringComparator,
  createdAt: dateComparator,
  updatedAt: dateComparator,
};

/**
 * Returns formatted currency
 * @param value - The number to format
 * @returns Formatted currency.
 * {@link currencyFormatOptions}
 * @example getFormattedCurrency(12.888); // PKR 12.89
 */
export const getFormattedCurrency = (value: number | bigint): string =>
  currencyFormatter.format(value);

/**
 * Formats currency without decimal places.
 * @param value - The number to be formatted.
 * @returns Formatted currency string without decimals.
 * @param withoutCurrency - Whether to remove the currency symbol.
 * @example getFormattedCurrencyInt(1234.56); // PKR 1,235
 * @example getFormattedCurrencyInt(1234.56, { withoutCurrency: true }); // 1,235
 */
export const getFormattedCurrencyInt = (
  value: number,
  { withoutCurrency = false } = {},
): string =>
  currencyIntFormatter
    .format(getFixedNumber(value, 0))
    .replace(withoutCurrency ? currencyFormatOptions.currency! : '', '');

/**
 * Parses a currency-like amount from a value.
 * @param value - The value to parse.
 * @returns The parsed amount.
 * @example parseCurrencyLikeAmount('1,234.56'); // 1234.56
 */
export const parseCurrencyLikeAmount = (value: unknown): number | null => {
  if (isNil(value)) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = toString(value).replace(/[^0-9.-]/g, '');
  if (isEmpty(normalized)) return null;

  const amount = toNumber(normalized);
  return Number.isFinite(amount) ? amount : null;
};

/**
 * Compares two date strings
 * @param rowA - The first row - date: DD/MM/YYYY e.g. 26/02/2025
 * @param rowB - The second row - date: DD/MM/YYYY e.g. 26/02/2025
 * @returns The comparison result
 * @todo doesn't work // FIXME
 */
export function dateStringComparator(rowA: Row<any>, rowB: Row<any>): number {
  const parseDate = (dateStr?: string): number => {
    if (!dateStr) return 0; // Handle missing date
    const [month, day, year] = dateStr.split('/').map(Number);
    return new Date(year, month - 1, day).getTime();
  };

  const dateA = parseDate(rowA.original?.date);
  const dateB = parseDate(rowB.original?.date);

  return dateA - dateB;
}

type AsyncFunc<T> = () => Promise<T>;
interface HandleAsyncOptions {
  successMessage?: string;
  errorMessage?: string;
  onSuccess?: (result: any) => void;
  onError?: (error: any) => void;
  onFinally?: () => void;
  getErrorMessage?: (error: string) => string;
  shouldExpectResult?: boolean;
}

/**
 * Handles the result of an asynchronous function.
 * @param asyncFunc - The asynchronous function to handle.
 * @param options - The options for the function.
 * @param options.successMessage - The message to display when the function succeeds.
 * @param options.errorMessage - The message to display when the function fails.
 * @param options.onSuccess - The function to call when the function succeeds.
 * @param options.onError - The function to call when the function fails.
 * @param options.getErrorMessage - The function to call when the function fails.
 * @returns The result of the asynchronous function.
 */
export async function handleAsync<T>(
  asyncFunc: AsyncFunc<T>,
  options: HandleAsyncOptions = {},
): Promise<void> {
  const {
    successMessage,
    errorMessage,
    onSuccess,
    onError,
    onFinally,
    getErrorMessage,
    shouldExpectResult = true,
  } = options;

  try {
    const result = await asyncFunc();

    if (!shouldExpectResult || !!result) {
      if (successMessage) {
        toast({
          description: successMessage,
          variant: 'success',
        });
      }
      onSuccess?.(result);
    } else if (shouldExpectResult) {
      raise(errorMessage || 'Operation failed');
    }
  } catch (error) {
    console.error(error);

    const errorMsg = error instanceof Error ? error.message : toString(error);
    const description = getErrorMessage
      ? getErrorMessage(errorMsg)
      : errorMessage || 'Operation failed';

    toast({
      description,
      variant: 'destructive',
    });

    onError?.(error);
  } finally {
    onFinally?.();
  }
}

// PRIVATE FUNCTIONS

function dateComparator(rowA: Row<any>, rowB: Row<any>): number {
  return (
    new Date(rowA.original.date).getTime() -
    new Date(rowB.original.date).getTime()
  );
}
