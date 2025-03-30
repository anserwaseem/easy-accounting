import type { BalanceType } from '@/types';

export interface AccountBalanceItem {
  id: number;
  name: string;
  code?: number | string;
  balance: number;
  balanceType: BalanceType;
  address?: string;
  phone1?: string;
  phone2?: string;
  goodsName?: string;
}

export interface AccountBalances {
  headName: string;
  accounts: AccountBalanceItem[];
  totalDebit: number;
  totalCredit: number;
}
