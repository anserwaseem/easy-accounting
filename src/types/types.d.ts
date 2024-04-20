declare type User = {
  id?: number;
  username: string;
  password_hash: Buffer;
  status: number;
};

declare type Auth = {
  username: string;
  password: string;
};

declare interface ReportAccount {
  name: string;
  amount: number;
  [key: string]: unknown; // other optional properties are allowed e.g. "type", "reference", "description" etc.
}

declare interface BalanceSheet {
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

type CategoryType = 'Asset' | 'Liability' | 'Equity';
type BalanceType = 'Dr' | 'Cr';

type BaseEntity = {
  id: number;
  date: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

declare interface Account extends BaseEntity {
  name: string;
  chartId: number;
  headName?: string;
  type: CategoryType;
  code?: number;
}

declare interface Chart extends BaseEntity {
  name: string;
  type: CategoryType;
}

declare interface Ledger extends BaseEntity {
  particulars: string; // TODO: remove it in favor of linkedAccountId
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
  linkedAccountId: number;
}

declare interface Journal extends Omit<BaseEntity, 'date'> {
  date: string;
  narration: string;
  isPosted: boolean;
  journalEntries: JournalEntry[];
}

declare interface JournalEntry extends Omit<BaseEntity, 'date'> {
  journalId: number;
  debitAmount: number;
  creditAmount: number;
  /**
   * Id of account to which this entry belongs to
   */
  accountId: number;
}

/** DTO **/

declare type InsertAccount = Pick<Account, 'headName' | 'name' | 'code'>;
declare type UpdateAccount = Pick<Account, 'id' | 'headName' | 'name' | 'code'>;
