import { BaseEntity } from '@/types';

/**
 * Returns global date format options being used in the project.
 */
export const dateFormatOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

/**
 * Returns global currency format options being used in the project.
 */
export const currencyFormatOptions: Intl.NumberFormatOptions = {
  style: 'currency',
  currency: 'PKR',
};

export const DEFAULT_INVOICE_NUMBER = 1;

export const INVOICE_DISCOUNT_PERCENTAGE = 40; // TODO: make this configurable

export const baseEntityKeys: (keyof BaseEntity)[] = [
  'id',
  'date',
  'createdAt',
  'updatedAt',
];
