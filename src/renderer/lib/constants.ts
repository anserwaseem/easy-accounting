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

export const baseEntityKeys: (keyof BaseEntity)[] = [
  'id',
  'date',
  'createdAt',
  'updatedAt',
];

export const NO_DISCOUNT_POLICY_OPTION = {
  id: 0,
  name: 'No policy',
} as const;

export const FF_INVOICE_DISCOUNT_EDIT_ENABLED = false;
