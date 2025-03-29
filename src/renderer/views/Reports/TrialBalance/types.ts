export interface TrialBalanceItem {
  id: number;
  name: string;
  code: string | number | undefined;
  type: string;
  debit: number;
  credit: number;
}

export interface TrialBalance {
  date: Date;
  accounts: TrialBalanceItem[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
}

export interface TrialBalanceTableProps {
  trialBalance: TrialBalance;
  isLoading: boolean;
}
