import { type ClassValue, clsx } from 'clsx';
import { every, isArray, isNil, set } from 'lodash';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const isTwoDimensionalArray = (obj: unknown) => {
  if (isArray(obj)) {
    if (obj.length === 0) return false;

    return every(obj, isArray);
  }
  return false;
};

export const removeEmptySubarrays = (list: unknown[][]): unknown[][] =>
  list.filter((subarray) => !every(subarray, isNil));
