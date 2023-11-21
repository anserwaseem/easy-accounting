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
