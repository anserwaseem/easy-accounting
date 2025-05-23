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
 * Returns global datetime format options being used in the project.
 */
export const datetimeFormatOptions: Intl.DateTimeFormatOptions = {
  ...dateFormatOptions,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

export const currency = 'PKR';

/**
 * Returns global currency format options being used in the project.
 */
export const currencyFormatOptions: Intl.NumberFormatOptions = {
  style: 'currency',
  currency,
};

export const DEFAULT_INVOICE_NUMBER = 1;

export const INVOICE_DISCOUNT_PERCENTAGE = 40; // TODO: make this configurable

export const baseEntityKeys: (keyof BaseEntity)[] = [
  'id',
  'date',
  'createdAt',
  'updatedAt',
];
