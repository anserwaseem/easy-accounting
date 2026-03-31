/** Generic */
type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

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

export type BaseEntity = {
  id: number;
  date: string;
  createdAt?: Date;
  updatedAt?: Date;
};

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

export enum InvoiceType {
  Purchase = 'Purchase',
  Sale = 'Sale',
}

export interface TrialBalanceItem {
  id: number;
  name: string;
  code?: number | string;
  debit: number;
  credit: number;
  type: AccountType;
}

export interface TrialBalance {
  date: Date;
  accounts: TrialBalanceItem[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
}

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

export const Sections = ['assets', 'liabilities', 'equity'] as const;
export type Section = (typeof Sections)[number] | null; // used in parser: need for reading user written sections text, e.g., "Current Assets", "Fixed Liabilities", "Non Current Liabilities" etc. // FUTURE: need to support both singular and plural forms of these sections

export const SectionTypes = ['current', 'fixed'] as const;
export type SectionType = (typeof SectionTypes)[number] | null;

export const SingularSections = ['asset', 'liability', 'equity'] as const;
export type SingularSection = (typeof SingularSections)[number]; // used in chart & statement services

/** Account */
export interface Account extends BaseEntity {
  name: string;
  chartId: number;
  headName?: string;
  type: AccountType;
  code?: number | string;
  address?: string;
  phone1?: string;
  phone2?: string;
  goodsName?: string;
  isActive: boolean;
  discountProfileId?: number | null;
  discountProfileName?: string | null;
  discountProfileIsActive?: boolean | null;
}

export type InsertAccount = Omit<
  Account,
  keyof BaseEntity | 'chartId' | 'type'
>;
export type UpdateAccount = Prettify<
  Omit<Account, keyof BaseEntity | 'chartId' | 'type'> & Pick<BaseEntity, 'id'>
>;

/** Chart */
export interface Chart extends BaseEntity {
  name: string;
  type: AccountType;
  parentId?: number;
}
export type InsertChart = Pick<Chart, 'name' | 'type' | 'parentId'>;

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
  billNumber?: number;
  discountPercentage?: number;
  journalEntries: JournalEntry[];
}

export type UpdateJournalFields = Pick<
  Journal,
  'narration' | 'billNumber' | 'discountPercentage'
>;

export type HasMiniView = {
  isMini?: boolean;
};

/** Inventory */
export interface InventoryItem extends Omit<BaseEntity, 'date'> {
  name: string;
  price: number;
  quantity: number;
  description?: string;
  itemTypeId?: number | null;
  itemTypeName?: string | null;
}
export interface UpdateInventoryItem {
  id: number;
  price: number;
  name?: string;
  quantity?: number;
  description?: string;
  itemTypeId?: number | null;
}
export interface InsertInventoryItem {
  name: string;
  price: number;
  description?: string;
  itemTypeId?: number | null;
}

export interface ItemType extends Omit<BaseEntity, 'date'> {
  name: string;
  isActive: boolean;
  isPrimary?: boolean;
  inventoryCount?: number;
}

export interface DiscountProfile extends Omit<BaseEntity, 'date'> {
  name: string;
  isActive: boolean;
  accountCount?: number;
}

export interface ProfileTypeDiscount extends Omit<BaseEntity, 'date'> {
  profileId: number;
  itemTypeId: number;
  discountPercent: number;
  itemTypeName?: string;
}

/** opening stock (one row per item; old_quantity = inventory.quantity before this run) */
export interface InventoryOpeningStock {
  id?: number;
  inventoryId: number;
  quantity: number;
  asOfDate?: string;
  old_quantity?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** item for set opening stock: name (matched or created in service) and quantity */
export interface SetOpeningStockItem {
  name: string;
  quantity: number;
}

export interface ApplyStockAdjustmentPayload {
  inventoryId: number;
  quantityDelta: number;
  reason?: string;
  date?: string;
}

export type StockAdjustment = Prettify<
  BaseEntity & ApplyStockAdjustmentPayload
>;

/** Invoice */
export interface InvoiceItem extends Omit<BaseEntity, 'date'> {
  inventoryId: number;
  quantity: number; // will be provided by UI
  discount: number; // will be provided by UI
  invoiceId?: number; // will be assigned at service layer
  price?: number; // will be fetched at service layer
  discountedPrice?: number; // will be calculated at service layer
}

export type Invoice = Prettify<
  BaseEntity & {
    invoiceItems: Prettify<InvoiceItem>[];
    extraDiscount?: number; // will be provided by UI
    /** when extraDiscount > 0, the account to credit (discount applied from this party account) */
    extraDiscountAccountId?: number;
    biltyNumber?: string; // will be provided by UI
    cartons?: number; // will be provided by UI
    totalAmount?: number; // will be calculated at service layer
    invoiceNumber?: number; // only given from UI for the first time => user input
    invoiceType?: InvoiceType;
    accountMapping: {
      singleAccountId?: number;
      /** same customer often has multiple accounts; multiple accounts = one invoice per customer, one journal per account */
      multipleAccountIds?: number[];
    };
  }
>;

/** DTO */
export type LedgerView = Prettify<Ledger & { linkedAccountName?: string }>;
export type JournalView = Prettify<Journal & { amount: number }>;
export type InvoicesView = Prettify<
  Omit<Invoice, 'invoiceItems'> & { accountName: string }
>;
export type InvoiceItemView = {
  price: number;
  quantity: number;
  discount: number;
  itemTypeName?: string | null;
  inventoryItemName: string;
  inventoryId?: number;
  inventoryItemDescription?: string;
  discountedPrice?: number;
  accountName?: string;
};
export type InvoiceView = Prettify<
  Omit<Invoice, 'invoiceItems'> & {
    accountName?: string;
    accountAddress?: string | null;
    accountGoodsName?: string | null;
    invoiceItems: Array<InvoiceItemView>;
  }
>;
export type InvoicesExport = Prettify<
  Pick<Invoice, 'invoiceNumber' | 'date' | 'totalAmount'> & {
    totalQuantity: number;
  }
>;

export type ApiResponse = {
  success: boolean;
  error?: string;
};

export type BackupCreateResult = Prettify<
  ApiResponse & {
    path?: string;
  }
>;

export type BackupType = 'local' | 'cloud' | 'local + cloud';

export type BackupInfo = {
  filename: string;
  timestamp: Date;
  size: number;
  type: BackupType;
};

export type BackupMetadata = {
  filename: string;
  timestamp: Date;
  size: number;
  local: boolean;
  cloud: boolean;
};

// backup operation event types
export type BackupOperationStatus = 'in-progress' | 'error' | 'success';
export type BackupOperationType = 'backup' | 'restore';

export type BackupOperationStatusEvent = {
  status: BackupOperationStatus;
  type: BackupOperationType;
  message: string;
};

export type BackupOperationProgressStatus =
  | 'started'
  | 'processing'
  | 'uploading'
  | 'completed'
  | 'failed';
export type BackupOperationTransferType = 'upload' | 'download';

export type BackupOperationProgressEvent = {
  status: BackupOperationProgressStatus;
  type: BackupOperationTransferType;
  message: string;
};
