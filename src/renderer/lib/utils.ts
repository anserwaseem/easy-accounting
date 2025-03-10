import { Row, SortingFn } from '@tanstack/react-table';
import { type ClassValue, clsx } from 'clsx';
import { every, isArray, isNil, toString, toLower } from 'lodash';
import { twMerge } from 'tailwind-merge';
import { currencyFormatOptions } from './constants';
import { toast } from '../shad/ui/use-toast';

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
  Intl.NumberFormat('en-US', currencyFormatOptions).format(value);

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
  getErrorMessage?: (error: string) => string;
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
  const { successMessage, errorMessage, onSuccess, onError, getErrorMessage } =
    options;

  try {
    const result = await asyncFunc();

    if (result) {
      if (successMessage) {
        toast({
          description: successMessage,
          variant: 'success',
        });
      }
      if (onSuccess) onSuccess(result);
    } else {
      throw new Error(errorMessage || 'Operation failed');
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

    if (onError) onError(error);
  }
}

// PRIVATE FUNCTIONS

function dateComparator(rowA: Row<any>, rowB: Row<any>): number {
  return (
    new Date(rowA.original.date).getTime() -
    new Date(rowB.original.date).getTime()
  );
}
