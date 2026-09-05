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
  /** optional Urdu print name; empty falls back to name */
  nameUrdu?: string;
  /** optional Urdu print address; empty falls back to address */
  addressUrdu?: string;
  /** optional Urdu print goods / bilty carrier name; empty falls back to goodsName */
  goodsNameUrdu?: string;
  isActive: boolean;
  /** when true, purchase invoices reduce this account's vendor stock; issues increase it */
  tracksVendorStock?: boolean;
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

/** one row from Urdu fields spreadsheet import */
export type AccountUrduFieldPatch = {
  id?: number;
  code?: string | number | null;
  name?: string;
  nameUrdu?: string | null;
  addressUrdu?: string | null;
  goodsNameUrdu?: string | null;
};

export type AccountUrduBulkUpdateResult = {
  updated: number;
  notFound: number;
  ambiguous: number;
};

/** one row from inventory Urdu description spreadsheet import */
export type InventoryUrduFieldPatch = {
  id?: number;
  name?: string;
  descriptionUrdu?: string | null;
};

export type InventoryUrduBulkUpdateResult = {
  updated: number;
  notFound: number;
  ambiguous: number;
};

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
  /** set when journal is created from an invoice; null/undefined for manual journals */
  invoiceId?: number | null;
  journalEntries: JournalEntry[];
}

export type UpdateJournalFields = Pick<
  Journal,
  'narration' | 'billNumber' | 'discountPercentage'
>;

/** header fields batch-loaded for ledger narration column (avoids per-row getJournal IPC) */
export type JournalNarrationSummary = {
  narration: string;
  billNumber?: number;
  discountPercentage?: number;
};

export type HasMiniView = {
  isMini?: boolean;
};

/** A business-defined custom attribute (migration 020). */
export interface AttributeDefinition {
  id: number;
  key: string;
  label: string;
  unit?: string | null;
  valueType: 'text' | 'number' | 'bool';
  sortOrder: number;
  /** SQLite stores booleans as 0/1 */
  isActive: 0 | 1;
  /**
   * Whether this attribute is included in the published public catalog.
   * Opt-in: attributes routinely hold internal bookkeeping, so a new one is
   * private until marked public.
   */
  isPublic: 0 | 1;
  /** how many items currently carry a value for this attribute */
  usageCount?: number;
}

export interface UpsertAttributeDefinition {
  id?: number;
  key: string;
  label: string;
  unit?: string | null;
  valueType: 'text' | 'number' | 'bool';
  sortOrder?: number;
  /** defaults to false — publishing is opt-in */
  isPublic?: boolean;
}

/** Inventory */
export interface InventoryItem extends Omit<BaseEntity, 'date'> {
  /**
   * identity: the photo folder, the SKU, the ad-feed id, what a customer quotes
   */
  name: string;
  price: number;
  quantity: number;
  description?: string;
  /** optional Urdu print description; empty falls back to description */
  descriptionUrdu?: string | null;
  itemTypeId?: number | null;
  itemTypeName?: string | null;
  listPosition?: number | null;
  /** variant grouping: the head item of this item's family, if any (migration 020) */
  parentId?: number | null;
  /** custom attributes keyed by attribute_definitions.key (migration 020) */
  attributes?: Record<string, unknown>;
  /** price per named price list, keyed by price_lists.id (migration 020) */
  listPrices?: Record<number, number>;
  /** explicit "hold this back from the catalog" override (migration 022) */
  excludeFromCatalog?: 0 | 1;
  /**
   * customer-facing name, distinct from the identifying `name` (migration 023).
   * Null/absent is normal: a consumer then composes a title of its own.
   */
  title?: string | null;
}
export interface UpdateInventoryItem {
  id: number;
  price: number;
  name?: string;
  quantity?: number;
  description?: string;
  /** optional Urdu print description; blank clears it */
  descriptionUrdu?: string | null;
  /** customer-facing name; blank clears it (migration 023) */
  title?: string | null;
  itemTypeId?: number | null;
  listPosition?: number | null;
}
export interface InsertInventoryItem {
  name: string;
  price: number;
  description?: string;
  /** optional Urdu print description; blank stores NULL */
  descriptionUrdu?: string | null;
  /** customer-facing name; blank stores NULL (migration 023) */
  title?: string | null;
  itemTypeId?: number | null;
  listPosition?: number | null;
}

/** summary after applying list # rows matched by trimmed item name */
export interface ApplyListPositionsResult {
  updated: number;
  notFoundNames: string[];
  ambiguousNames: string[];
}

/** one row patch for bulk inventory grid save */
export interface BulkPriceListPositionPatch {
  id: number;
  price: number;
  listPosition: number | null;
  /** omitted means unchanged; null makes this item its own head */
  parentId?: number | null;
  /**
   * Prices on named price lists that changed for this item (migration 020).
   * A null price removes the item from that list.
   */
  listPrices?: Array<{ priceListId: number; price: number | null }>;
  /** omitted means unchanged; null/empty clears English description */
  description?: string | null;
  /** omitted means unchanged; null/empty clears Urdu description */
  descriptionUrdu?: string | null;
}

export interface BulkPriceListPositionResult {
  updated: number;
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

/** Vendor stock (shadow qty at a tracked vendor; does not touch warehouse inventory.quantity) */
export type VendorStockMovementType =
  | 'opening'
  | 'issue'
  | 'purchase'
  | 'purchase_return'
  | 'adjustment';

export interface VendorStockRow {
  vendorAccountId: number;
  vendorAccountName: string;
  vendorAccountCode?: number | string | null;
  inventoryId: number;
  inventoryName: string;
  quantity: number;
}

export interface VendorStockOpeningRow {
  vendorCode?: string | number | null;
  vendorName?: string | null;
  name: string;
  quantity: number;
}

export interface VendorIssueItemInput {
  inventoryId: number;
  quantity: number;
}

export interface CreateVendorIssuePayload {
  vendorAccountId: number;
  date: string;
  notes?: string;
  items: VendorIssueItemInput[];
}

export type UpdateVendorIssuePayload = CreateVendorIssuePayload;

export interface VendorIssueListItem {
  id: number;
  issueNumber: number;
  vendorAccountId: number;
  vendorAccountName: string;
  date: string;
  notes?: string | null;
  totalQuantity: number;
  lineCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface VendorIssueView extends VendorIssueListItem {
  items: Array<{
    id: number;
    inventoryId: number;
    inventoryName: string;
    quantity: number;
  }>;
}

export interface VendorStockPurchaseLine {
  accountId: number;
  inventoryId: number;
  quantity: number;
}

export interface VendorStockActivityFilters {
  vendorAccountId: number;
  startDate: string;
  endDate: string;
}

export interface VendorStockActivityItem {
  inventoryId: number;
  inventoryName: string;
  opening: number;
  issued: number;
  purchased: number;
  purchaseReturned: number;
  adjusted: number;
  closing: number;
}

export interface VendorStockActivityResponse {
  vendorAccountId: number;
  vendorAccountName: string;
  startDate: string;
  endDate: string;
  items: VendorStockActivityItem[];
}

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
export type LedgerView = Prettify<
  Ledger & {
    linkedAccountName?: string;
    linkedAccountCode?: number | string | null;
    journalSummary?: JournalNarrationSummary | null;
  }
>;
export type JournalView = Prettify<Journal & { amount: number }>;
export type InvoicesView = Prettify<
  Omit<Invoice, 'invoiceItems'> & {
    accountName: string;
    accountCode?: number | string | null;
    /** journals linked by invoiceId; 0 means edit is unsafe (matches updateInvoice guard) */
    linkedJournalCount: number;
    /** sale quotation row; not a posted invoice until converted */
    isQuotation?: boolean;
    /** whole-invoice return voided posting; when true, invoice should not be edited */
    isReturned?: boolean;
    returnedAt?: string | null;
    returnReason?: string | null;
  }
>;
export type InvoiceItemView = {
  price: number;
  quantity: number;
  discount: number;
  itemTypeName?: string | null;
  inventoryItemName: string;
  inventoryId?: number;
  inventoryItemDescription?: string;
  /** live-joined inventory.descriptionUrdu; empty falls back on print */
  inventoryItemDescriptionUrdu?: string | null;
  discountedPrice?: number;
  accountName?: string;
  /** persisted line account when invoice uses per-row accounts */
  accountId?: number;
  /** line party Urdu name when invoice uses per-row accounts */
  accountNameUrdu?: string;
};
export type InvoiceView = Prettify<
  Omit<Invoice, 'invoiceItems'> & {
    accountName?: string;
    accountNameUrdu?: string | null;
    accountCode?: number | string | null;
    /** header party account id for edit hydration */
    invoiceHeaderAccountId?: number;
    /** persisted for edit round-trip when extra discount applies */
    extraDiscountAccountId?: number | null;
    accountAddress?: string | null;
    accountAddressUrdu?: string | null;
    accountGoodsName?: string | null;
    accountGoodsNameUrdu?: string | null;
    invoiceItems: Array<InvoiceItemView>;
    /** sale quotation until converted to a numbered invoice */
    isQuotation?: boolean;
    isReturned?: boolean;
    returnedAt?: string | null;
    returnReason?: string | null;
  }
>;

/** optional note stored when voiding a sale or purchase invoice via return */
export type ReturnSaleInvoicePayload = {
  returnReason?: string | null;
};
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
