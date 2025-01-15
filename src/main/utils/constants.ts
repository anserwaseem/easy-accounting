import { AccountType, type Chart } from '../../types';
import { cast } from './sqlite';

export const INITIAL_CHARTS: Omit<Chart, 'id'>[] = [
  {
    name: 'Fixed Asset',
    type: AccountType.Asset,
    date: cast(new Date()),
  },
  {
    name: 'Current Asset',
    type: AccountType.Asset,
    date: cast(new Date()),
  },
  {
    name: 'Fixed Liability',
    type: AccountType.Liability,
    date: cast(new Date()),
  },
  {
    name: 'Current Liability',
    type: AccountType.Liability,
    date: cast(new Date()),
  },
  {
    name: 'Equity',
    type: AccountType.Equity,
    date: cast(new Date()),
  },
  {
    name: 'Revenue',
    type: AccountType.Revenue,
    date: cast(new Date()),
  },
  {
    name: 'Expense',
    type: AccountType.Expense,
    date: cast(new Date()),
  },
];

export const DEFAULT_USER = {
  username: 'default',
  password: 'default',
};

export const INVOICE_DISCOUNT_PERCENTAGE = 40;
