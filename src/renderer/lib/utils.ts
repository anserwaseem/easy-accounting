import { type ClassValue, clsx } from 'clsx';
import { every, isArray, isNil, set } from 'lodash';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isTwoDimensionalArray = (obj: unknown) => {
  if (isArray(obj)) {
    if (obj.length === 0) return false;

    return every(obj, isArray);
  }
  return false;
};

export const removeEmptySubarrays = (list: unknown[][]): unknown[][] => {
  return list.filter((subarray) => !every(subarray, isNil));
};

export const firstDuplicateIndex = (list: unknown[]): number => {
  const dict = {};

  for (const [index, value] of list.entries()) {
    if ((value as keyof typeof dict) in dict)
      return dict[value as keyof typeof dict];

    set(dict, value as keyof typeof dict, index);
  }

  return -1;
};
