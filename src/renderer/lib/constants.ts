import { BaseEntity } from '@/types';

export const dateFormatOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

export const datetimeFormatOptions: Intl.DateTimeFormatOptions = {
  ...dateFormatOptions,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

export const currency = 'PKR';

export const currencyFormatOptions: Intl.NumberFormatOptions = {
  style: 'currency',
  currency,
};

export const currencyFormatter = new Intl.NumberFormat(
  'en-US',
  currencyFormatOptions,
);

export const currencyIntFormatter = new Intl.NumberFormat('en-US', {
  ...currencyFormatOptions,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const DEFAULT_INVOICE_NUMBER = 1;

export const INVOICE_DISCOUNT_PERCENTAGE = 40; // TODO: make this configurable

export const baseEntityKeys: (keyof BaseEntity)[] = [
  'id',
  'date',
  'createdAt',
  'updatedAt',
];
