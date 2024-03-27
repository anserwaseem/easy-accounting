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

type BaseEntity = {
  id: number;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
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
