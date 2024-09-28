export type DbUser = {
  id?: number;
  username: string;
  password_hash: string;
  status: number;
};

export type UserCredentials = {
  username: string;
  password: string;
};

export interface ReportAccount {
  name: string;
  amount: number;
  [key: string]: unknown; // other optional properties are allowed e.g. "type", "reference", "description" etc.
}

export interface BalanceSheet {
  date: Date;
  assets: {
    current: Record<string, ReportAccount[]>; // example object: { "Cash and Bank": [ { name: "Cash", amount: 1000 }, { name: "Bank", amount: 2000 } ] }
    totalCurrent: number;
    fixed: Record<string, ReportAccount[]>; // example object: { "Property, Plant and Equipment": [ { name: "Land", amount: 1000 }, { name: "Building", amount: 2000 } ] }
    totalFixed: number;
    total: number;
  };
  liabilities: {
    current: Record<string, ReportAccount[]>; // example object: { "Accounts Payable": [ { name: "John", amount: 1000 } ] }
    totalCurrent: number;
    fixed: Record<string, ReportAccount[]>; // example object: { "": [ { name: "Long Term Debt", amount: 1000 } ] }
    totalFixed: number;
    total: number;
  };
  equity: {
    current: Record<string, ReportAccount[]>; // example object: { "": [ { name: "Retained Earnings", amount: 1000 } ] }
    total: number;
    totalCurrent?: number; // not used
    fixed?: Record<string, ReportAccount[]>; // not used
    totalFixed?: number; // not used
  };
}

export enum AccountType {
  Asset = 'Asset',
  Liability = 'Liability',
  Equity = 'Equity',
  Revenue = 'Revenue',
  Expense = 'Expense',
}

export enum BalanceType {
  Dr = 'Dr',
  Cr = 'Cr',
}

type BaseEntity = {
  id: number;
  date: string;
  createdAt?: Date;
  updatedAt?: Date;
};

/** Account */
export interface Account extends BaseEntity {
  name: string;
  chartId: number;
  headName?: string;
  type: AccountType;
  code?: number;
}
export type InsertAccount = Pick<Account, 'headName' | 'name' | 'code'>;
export type UpdateAccount = Pick<Account, 'id' | 'headName' | 'name' | 'code'>;

/** Chart */
export interface Chart extends BaseEntity {
  name: string;
  type: AccountType;
}

/** Ledger */
export interface Ledger extends BaseEntity {
  particulars: string;
  /**
   * Id of account to which this ledger belongs to
   */
  accountId: number;
  debit: number;
  credit: number;
  balance: number;
  balanceType: BalanceType;
  /**
   * Id of account from which empty Cr/Dr amount is coming.
   */
  linkedAccountId?: number;
}
export type GetLedger = Ledger & { linkedAccountName?: string };

/** Journal Entry */
export interface JournalEntry extends Omit<BaseEntity, 'date'> {
  journalId: number;
  debitAmount: number;
  creditAmount: number;
  /**
   * Id of account to which this entry belongs to
   */
  accountId: number;
}

/** Journal */
export interface Journal extends Omit<BaseEntity, 'date'> {
  date: string;
  narration?: string;
  isPosted: boolean;
  journalEntries: JournalEntry[];
}

export type HasMiniView = {
  isMini?: boolean;
};
