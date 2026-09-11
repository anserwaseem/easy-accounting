/**
 * AppApi — the platform-independent request/response contract for the
 * "backend" surface the renderer talks to today as `window.electron`.
 *
 * This interface is lifted method-for-method from the implementation in
 * src/main/preload.ts (the runtime source of truth) — same names, same
 * parameter and return types, every `ipcRenderer.invoke(...)` call replaced
 * by its `Promise`-wrapped return type. It is a lift, not a redesign: where
 * preload.ts leaves a method's return type to `ipcRenderer.invoke`'s default
 * (`Promise<any>`) rather than casting it, this interface keeps that looser
 * type too, so it never claims more precision than the runtime code has.
 *
 * `window.electron` itself additionally carries a few genuinely event-based
 * members (`ipcRenderer.on/once/sendMessage`, the sync `store` helpers) that
 * don't fit a request/response contract — those stay locally typed in
 * src/renderer/preload.d.ts, layered on top of this interface.
 *
 * A future web build implements this same interface against HTTP/IndexedDB/
 * whatever instead of IPC. Methods that only make sense with a desktop shell
 * (e.g. writing a PDF to the local filesystem) are documented `@platform
 * electron` — the web implementation may stub them.
 */
import type {
  Account,
  UserCredentials,
  BalanceSheet,
  InsertAccount,
  UpdateAccount,
  Journal,
  JournalNarrationSummary,
  LedgerView,
  InventoryItem,
  Invoice,
  UpdateInventoryItem,
  InsertInventoryItem,
  InsertChart,
  UpdateJournalFields,
  SetOpeningStockItem,
  StockAdjustment,
  InventoryOpeningStock,
  ApplyStockAdjustmentPayload,
  ApiResponse,
  ReturnSaleInvoicePayload,
  ItemType,
  DiscountProfile,
  ProfileTypeDiscount,
  BalanceType,
  LedgerRangeResponse,
  ReportFilters,
  ReportResponse,
  StockAsOfReportFilters,
  StockAsOfReportResponse,
  ApplyListPositionsResult,
  BulkPriceListPositionPatch,
  BulkPriceListPositionResult,
  AttributeDefinition,
  UpsertAttributeDefinition,
  InvoiceType,
  AccountUrduFieldPatch,
  AccountUrduBulkUpdateResult,
  InventoryUrduFieldPatch,
  InventoryUrduBulkUpdateResult,
  PurchasesByVendorFilters,
  PurchasesByVendorResponse,
  SalesByCustomerFilters,
  SalesByCustomerResponse,
  VendorStockRow,
  VendorStockOpeningRow,
  CreateVendorIssuePayload,
  UpdateVendorIssuePayload,
  VendorIssueListItem,
  VendorIssueView,
  VendorStockActivityFilters,
  VendorStockActivityResponse,
} from 'types';

/*
 * Publish-domain support types.
 *
 * These mirror interfaces defined in src/main/utils/publishConfig.ts,
 * src/main/utils/priceSeeding.ts and src/main/services/Publish.service.ts.
 * They are duplicated here — rather than imported — because src/core may not
 * import from src/main (see the ESLint import-boundary rule for
 * `src/core/**`); the originals still hold the real logic and remain the
 * source of truth for their own modules. Keep these shapes in sync by hand
 * until publish/pricing config move into core.
 */

/** Mirrors `PublishConfig` (src/main/utils/publishConfig.ts). What the renderer may see — no secrets. */
export interface PublishConfig {
  endpoint: string;
  region: string;
  bucket: string;
  privateBucket: string;
  accessKeyId: string;
  publicBaseUrl: string;
  privatePrefix: string;
  publicPrefix: string;
  publicPriceList: string;
  reservedNameChars: string;
  requiredAttributeKeys: string;
  publishWithoutImages: boolean;
  imagesManifestUrl: string;
  webhookUrl: string;
  hasSecretAccessKey: boolean;
  hasWebhookToken: boolean;
  encryptionAvailable: boolean;
}

/** Mirrors `PublishConfigInput` (src/main/utils/publishConfig.ts). Secrets are write-only. */
export interface PublishConfigInput
  extends Partial<
    Omit<
      PublishConfig,
      'hasSecretAccessKey' | 'hasWebhookToken' | 'encryptionAvailable'
    >
  > {
  secretAccessKey?: string;
  webhookToken?: string;
}

/** Mirrors `PriceListSummary` (src/main/services/Publish.service.ts). */
export interface PriceListSummary {
  id: number;
  name: string;
  isActive: number;
  itemCount: number;
}

/** Mirrors `CatalogPreview` (src/main/services/Publish.service.ts). */
export interface CatalogPreview {
  candidateCount: number;
  publicCount: number;
  publishableCount: number;
  heldBack: number;
  missingImage: number;
  missingAttributes: number;
  missingPublicPrice: number;
  imagesManifestError?: string;
}

/** Mirrors `PublishResult` (src/main/services/Publish.service.ts). */
export interface PublishResult {
  ok: boolean;
  error?: string;
  generatedAt: string;
  fullCount: number;
  publicCount: number;
  publishableCount: number;
  uploaded: string[];
  webhook?: { called: boolean; ok: boolean; status?: number; error?: string };
  privateExposureWarning?: string;
  fingerprint?: string;
  skipped?: boolean;
}

/** Mirrors `SeedOptions` (src/main/utils/priceSeeding.ts). */
export interface SeedOptions {
  source: 'base' | 'list';
  multiplier: number;
  roundTo: number;
  overwriteExisting: boolean;
}

/** Mirrors `SeedChange` (src/main/utils/priceSeeding.ts). */
export interface SeedChange {
  inventoryId: number;
  name: string;
  from: number | null;
  to: number;
}

/** Mirrors `SeedPlan` (src/main/utils/priceSeeding.ts). */
export interface SeedPlan {
  changes: SeedChange[];
  skippedExisting: number;
  skippedNoSource: number;
  unchanged: number;
}

export interface AppApi {
  // ---------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------

  /**
   * Login a user
   * @param user The user to login
   * @returns Boolean indicating if the user was logged in
   * @example const token = login({ username: 'user', password: 'pass' });
   */
  login: (user: UserCredentials) => Promise<any>;
  /**
   * Register a user
   * @param user The user to register
   * @returns Boolean indicating if the user was registered
   * @example const token = register({ username: 'user', password: 'pass' });
   */
  register: (user: UserCredentials) => Promise<any>;
  /**
   * Logout a user
   * @example logout();
   */
  logout: () => Promise<any>;

  // ---------------------------------------------------------------------
  // Account
  // ---------------------------------------------------------------------

  /**
   * Get all accounts
   * @returns All accounts
   * @example const accounts = getAccounts();
   */
  getAccounts: () => Promise<any>;
  getAccountsByIds: (ids: number[]) => Promise<Account[]>;
  getAccountByName: (name: string) => Promise<any>;
  getAccountByNameAndCode: (name: string, code?: string) => Promise<any>;
  getAccountByNameAndChart: (chartId: number, name: string) => Promise<any>;
  /**
   * Insert an account
   * @param account The account to insert
   * @returns Boolean indicating if the account was inserted
   * @example const account = insertAccount({ ... });
   */
  insertAccount: (account: InsertAccount) => Promise<any>;
  /**
   * Update an account
   * @param account The account to update
   * @returns Boolean indicating if the account was updated
   * @example const account = updateAccount({ ... });
   */
  updateAccount: (account: UpdateAccount) => Promise<any>;
  bulkUpdateAccountUrduFields: (
    patches: AccountUrduFieldPatch[],
  ) => Promise<AccountUrduBulkUpdateResult>;
  updateAccountDiscountProfile: (
    accountId: number,
    discountProfileId: number | null,
  ) => Promise<boolean>;
  /**
   * Check if an account has any journal entries
   * @param accountId The account ID to check
   * @returns Boolean indicating if the account has journal entries
   * @example const hasJournals = hasJournalEntries(1);
   */
  hasJournalEntries: (accountId: number) => Promise<any>;
  /**
   * Delete an account if it has no journal entries
   * @param accountId The account ID to delete
   * @returns Boolean indicating if the account was deleted
   * @example const isDeleted = deleteAccount(1);
   */
  deleteAccount: (accountId: number) => Promise<any>;
  /**
   * Toggle the active status of an account
   * @param accountId The account ID to toggle
   * @param isActive The new active status
   * @returns Boolean indicating if the account status was updated
   * @example const isUpdated = toggleAccountActive(1, false);
   */
  toggleAccountActive: (accountId: number, isActive: boolean) => Promise<any>;

  // ---------------------------------------------------------------------
  // Chart
  // ---------------------------------------------------------------------

  /**
   * Get all charts
   * @returns All charts
   * @example const charts = getCharts();
   */
  getCharts: () => Promise<any>;
  /**
   * Insert a custom head
   * @param chart The chart to insert
   * @returns Boolean indicating if the chart was inserted
   * @example const isInserted = insertCustomHead({ ... });
   */
  insertCustomHead: (chart: InsertChart) => Promise<any>;
  updateCustomHeadName: (chartId: number, name: string) => Promise<any>;
  updateCustomHeadUrdu: (
    chartId: number,
    nameUrdu: string | null,
  ) => Promise<any>;

  // ---------------------------------------------------------------------
  // Journal
  // ---------------------------------------------------------------------

  /**
   * Get the next journal id
   * @returns The next journal id
   * @example const journalId = getNextJournalId();
   */
  getNextJournalId: () => Promise<any>;
  /**
   * Insert a journal
   * @param journal The journal to insert
   * @returns Boolean indicating if the journal was inserted
   * @example const isInserted = insertJournal({ ... });
   * @throws Error if any error occurs while inserting the journal
   */
  insertJournal: (journal: Journal) => Promise<any>;
  /**
   * Get all journals
   * @returns All journals
   * @example const journals = getJournals();
   */
  getJournals: () => Promise<any>;
  /**
   * Get a journal
   * @param journalId The journal id to get
   * @returns The journal if found, undefined otherwise
   * @example const journal = getJournal(1);
   */
  getJournal: (journalId: number) => Promise<any>;
  getJournalNarrationSummariesByIds: (
    journalIds: number[],
  ) => Promise<Record<number, JournalNarrationSummary>>;
  getJournalsByInvoiceId: (invoiceId: number) => Promise<any>;
  /**
   * Update a journal narration
   * @param journalId The journal id to update
   * @param narration The new narration
   * @returns Promise that resolves when the update is complete
   * @example await updateJournalNarration(1, 'New narration');
   * @throws Error if the journal is posted or not found
   */
  updateJournalNarration: (
    journalId: number,
    narration: string,
  ) => Promise<any>;
  /**
   * Update journal info (narration, bill number, discount percentage)
   */
  updateJournalInfo: (
    journalId: number,
    fields: UpdateJournalFields,
  ) => Promise<any>;

  // ---------------------------------------------------------------------
  // Ledger
  // ---------------------------------------------------------------------

  /**
   * Get a ledger
   * @param accountId The account id to get
   * @returns The ledger if found, undefined otherwise
   * @example const ledger = getLedger(1);
   */
  getLedger: (accountId: number) => Promise<LedgerView[]>;
  /**
   * Latest running balance for an account (same as last row on ledger screen), or null if no entries.
   */
  getLedgerBalance: (
    accountId: number,
  ) => Promise<{ balance: number; balanceType: BalanceType } | null>;
  getLedgerBalancesForAccountIds: (
    accountIds: number[],
  ) => Promise<Record<number, { balance: number; balanceType: BalanceType }>>;
  /** balances as of inclusive calendar day (yyyy-MM-dd), single round-trip */
  getLedgerBalancesForAccountIdsAsOfDate: (
    accountIds: number[],
    asOfDate: string,
  ) => Promise<Record<number, { balance: number; balanceType: BalanceType }>>;
  /** inclusive calendar range per account; rows enriched like getLedger */
  getLedgerRangeForAccountIds: (
    accountIds: number[],
    startDate: string,
    endDate: string,
  ) => Promise<Record<number, LedgerView[]>>;
  /** all rows through end date (yyyy-MM-dd), ascending; no journal enrichment */
  getLedgersUpToDateForAccountIds: (
    accountIds: number[],
    endDate: string,
  ) => Promise<Record<number, LedgerView[]>>;

  // ---------------------------------------------------------------------
  // Invoice
  // ---------------------------------------------------------------------

  getNextInvoiceNumber: (invoiceType: InvoiceType) => Promise<any>;
  insertInvoice: (invoiceType: InvoiceType, invoice: Invoice) => Promise<any>;
  insertQuotation: (
    invoiceType: InvoiceType,
    invoice: Invoice,
  ) => Promise<{ invoiceId: number }>;
  getQuotations: (invoiceType: InvoiceType) => Promise<any>;
  updateQuotation: (invoiceId: number, invoice: Invoice) => Promise<void>;
  convertQuotation: (invoiceId: number) => Promise<{ invoiceNumber: number }>;
  updateInvoice: (
    invoiceType: InvoiceType,
    invoiceId: number,
    invoice: Invoice,
  ) => Promise<any>;
  getInvoices: (invoiceType: InvoiceType) => Promise<any>;
  getInvoice: (invoiceId: number) => Promise<any>;
  returnSaleInvoice: (
    invoiceId: number,
    payload?: ReturnSaleInvoicePayload,
  ) => Promise<any>;
  returnPurchaseInvoice: (
    invoiceId: number,
    payload?: ReturnSaleInvoicePayload,
  ) => Promise<any>;
  getSaleInvoiceEditDateBounds: (
    invoiceId: number,
    accountId: number,
    invoiceNumber: number,
  ) => Promise<{ prevDate: string | null; nextDate: string | null }>;
  updateInvoiceBiltyAndCartons: (
    invoiceId: number,
    biltyNumber?: string,
    cartons?: number,
  ) => Promise<any>;
  exportInvoices: (startDate?: string, endDate?: string) => Promise<any>;
  doesInvoiceExists: (
    invoiceId: number,
    invoiceType: InvoiceType,
  ) => Promise<any>;
  getAdjacentInvoiceId: (
    invoiceId: number,
    invoiceType: InvoiceType,
    direction: 'next' | 'previous',
    scope?: 'posted' | 'quotation',
  ) => Promise<any>;
  getLastInvoiceNumber: (invoiceType: InvoiceType) => Promise<any>;
  getInvoiceIdsFromMinId: (
    invoiceType: InvoiceType,
    fromInvoiceId: number,
    scope?: 'posted' | 'quotation',
  ) => Promise<number[]>;
  getInvoicePdfOutputBaseName: (
    invoiceId: number,
    invoiceType: InvoiceType,
  ) => Promise<string | null>;
  getAutoDiscount: (accountId: number, inventoryId: number) => Promise<number>;

  // ---------------------------------------------------------------------
  // Inventory (items, opening stock, adjustments, attributes)
  // ---------------------------------------------------------------------

  saveInventory: (inventory: InventoryItem[]) => Promise<any>;
  getInventory: () => Promise<any>;
  doesInventoryExist: () => Promise<any>;
  insertInventoryItem: (item: InsertInventoryItem) => Promise<any>;
  updateInventoryItem: (item: UpdateInventoryItem) => Promise<any>;
  bulkUpdateInventoryUrduFields: (
    patches: InventoryUrduFieldPatch[],
  ) => Promise<InventoryUrduBulkUpdateResult>;
  setInventoryParentId: (
    inventoryId: number,
    parentId: number | null,
  ) => Promise<ApiResponse>;
  bulkUpdateInventoryPricesAndListPositions: (
    patches: BulkPriceListPositionPatch[],
  ) => Promise<BulkPriceListPositionResult>;
  applyInventoryListPositions: (
    rows: Array<{ name: string; listPosition: number }>,
  ) => Promise<ApplyListPositionsResult>;
  getOpeningStock: () => Promise<InventoryOpeningStock[]>;
  setOpeningStock: (
    items: SetOpeningStockItem[],
    asOfDate?: string,
    resetOthersToZero?: boolean,
  ) => Promise<ApiResponse>;
  applyStockAdjustment: (
    payload: ApplyStockAdjustmentPayload,
  ) => Promise<ApiResponse>;
  getStockAdjustments: (inventoryId?: number) => Promise<StockAdjustment[]>;
  getInventoryIdsWithHistory: () => Promise<number[]>;
  /** Custom attribute definitions, in display order. */
  getAttributeDefinitions: () => Promise<AttributeDefinition[]>;
  upsertAttributeDefinition: (
    input: UpsertAttributeDefinition,
  ) => Promise<boolean>;
  /**
   * Deletes an attribute definition. Without `force` an in-use attribute is
   * left alone and its usage reported, so the caller can confirm; with `force`
   * the values are stripped from every item too.
   */
  deleteAttributeDefinition: (
    id: number,
    force?: boolean,
  ) => Promise<{
    deleted: boolean;
    usageCount: number;
    valuesRemoved: number;
  }>;
  /** Rewrites attribute display order from the given id sequence. */
  reorderAttributeDefinitions: (ids: number[]) => Promise<boolean>;
  setItemExcludedFromCatalog: (
    id: number,
    excluded: boolean,
  ) => Promise<boolean>;
  setAttributeDefinitionPublic: (
    id: number,
    isPublic: boolean,
  ) => Promise<boolean>;
  setAttributeDefinitionActive: (
    id: number,
    isActive: boolean,
  ) => Promise<boolean>;
  /** Replaces an item's custom attributes. */
  updateInventoryAttributes: (
    id: number,
    attributes: Record<string, unknown>,
  ) => Promise<boolean>;

  // ---------------------------------------------------------------------
  // Pricing (item types, discount profiles)
  // ---------------------------------------------------------------------

  getItemTypes: () => Promise<ItemType[]>;
  insertItemType: (name: string) => Promise<boolean>;
  updateItemTypeName: (id: number, name: string) => Promise<boolean>;
  toggleItemTypeActive: (id: number, isActive: boolean) => Promise<boolean>;
  deleteItemType: (id: number) => Promise<boolean>;
  getPrimaryItemType: () => Promise<number | undefined>;
  setPrimaryItemType: (itemTypeId: number) => Promise<boolean>;
  clearPrimaryItemType: () => Promise<boolean>;
  getDiscountProfiles: () => Promise<DiscountProfile[]>;
  insertDiscountProfile: (name: string) => Promise<boolean>;
  updateDiscountProfileName: (id: number, name: string) => Promise<boolean>;
  toggleDiscountProfileActive: (
    id: number,
    isActive: boolean,
  ) => Promise<boolean>;
  deleteDiscountProfile: (id: number) => Promise<boolean>;
  deleteDiscountProfileFromAccount: (
    accountId: number,
    profileId: number,
  ) => Promise<boolean>;
  getDiscountProfileTypeDiscounts: (
    profileId: number,
  ) => Promise<ProfileTypeDiscount[]>;
  saveDiscountProfileTypeDiscounts: (
    profileId: number,
    discounts: Array<{ itemTypeId: number; discountPercent: number }>,
  ) => Promise<boolean>;

  // ---------------------------------------------------------------------
  // Statement / Balance Sheet / Reports
  // ---------------------------------------------------------------------

  /**
   * Save a balance sheet
   * @param balanceSheet The balance sheet to save
   * @returns Boolean indicating if the balance sheet was saved
   * @example const balanceSheet = saveBalanceSheet({ ... });
   */
  saveBalanceSheet: (balanceSheet: BalanceSheet) => Promise<any>;
  reportGetLedgerRange: (params: {
    accountId: number;
    startDate: string;
    endDate: string;
  }) => Promise<LedgerRangeResponse>;
  reportGetInventoryHealth: (filters: ReportFilters) => Promise<ReportResponse>;
  reportGetStockAsOf: (
    filters: StockAsOfReportFilters,
  ) => Promise<StockAsOfReportResponse>;
  reportGetSalesPerformance: (
    filters: ReportFilters,
  ) => Promise<ReportResponse>;
  reportGetPurchasesByVendor: (
    filters: PurchasesByVendorFilters,
  ) => Promise<PurchasesByVendorResponse>;
  reportGetSalesByCustomer: (
    filters: SalesByCustomerFilters,
  ) => Promise<SalesByCustomerResponse>;

  // ---------------------------------------------------------------------
  // Vendor stock (WIP at vendor)
  // ---------------------------------------------------------------------

  getVendorStockOnHand: (vendorAccountId?: number) => Promise<VendorStockRow[]>;
  getTrackedVendorAccounts: () => Promise<
    Array<{ id: number; name: string; code?: number | string | null }>
  >;
  setVendorOpeningStock: (
    vendorAccountId: number,
    items: Array<{ name: string; quantity: number }>,
    asOfDate: string,
    resetOthersToZero?: boolean,
  ) => Promise<ApiResponse>;
  importVendorOpeningStock: (
    rows: VendorStockOpeningRow[],
    asOfDate: string,
    resetOthersToZero?: boolean,
  ) => Promise<ApiResponse>;
  getNextVendorIssueNumber: () => Promise<number>;
  createVendorIssue: (
    payload: CreateVendorIssuePayload,
  ) => Promise<ApiResponse & { issueId?: number; issueNumber?: number }>;
  updateVendorIssue: (
    issueId: number,
    payload: UpdateVendorIssuePayload,
  ) => Promise<ApiResponse & { issueId?: number; issueNumber?: number }>;
  deleteVendorIssue: (issueId: number) => Promise<ApiResponse>;
  getVendorIssues: () => Promise<VendorIssueListItem[]>;
  getVendorIssue: (issueId: number) => Promise<VendorIssueView | null>;
  getVendorStockActivity: (
    filters: VendorStockActivityFilters,
  ) => Promise<VendorStockActivityResponse>;

  // ---------------------------------------------------------------------
  // Print
  // ---------------------------------------------------------------------

  /** @platform electron — writes a PDF to the local filesystem via Electron's print pipeline. */
  printToPdf: (outputBaseName: string | number) => Promise<any>;
  /** @platform electron — local filesystem output directory. */
  getOutputDir: () => Promise<any>;

  // ---------------------------------------------------------------------
  // Backup
  // ---------------------------------------------------------------------
  //
  // No request/response backup methods are exposed on window.electron today
  // (see src/main/preload.ts) — only the event channels
  // 'backup-operation-status' / 'backup-operation-progress', which are
  // consumed through the event-based `ipcRenderer.on` member kept locally in
  // preload.d.ts. Add methods here, marked `@platform electron`, if/when a
  // request/response backup API is added to preload.ts.

  // ---------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------

  /** Publish configuration (secrets are write-only; never returned here). */
  getPublishConfig: () => Promise<PublishConfig>;
  savePublishConfig: (input: PublishConfigInput) => Promise<PublishConfig>;
  /** Active price list names — drives the public price list picker. */
  getPriceListNames: () => Promise<string[]>;
  /** Dry-run summary of what a publish would produce. */
  getItemPublishStatuses: () => Promise<{
    statuses: { id: number; state: string; blockers: string[] }[];
    imagesManifestError?: string;
  }>;
  previewCatalog: () => Promise<CatalogPreview>;
  /** Generate, upload and notify. Resolves with the run outcome. */
  runPublish: (force?: boolean) => Promise<PublishResult>;
  /** All price lists with item counts, for management. */
  getPriceLists: () => Promise<PriceListSummary[]>;
  createPriceList: (name: string) => Promise<boolean>;
  renamePriceList: (id: number, name: string) => Promise<boolean>;
  setPriceListActive: (id: number, isActive: boolean) => Promise<boolean>;
  /** Preview a bulk seed/revision of a price list without writing. */
  previewPriceListSeed: (
    priceListId: number,
    options: SeedOptions,
    inventoryIds?: number[],
  ) => Promise<SeedPlan>;
  /** Apply a bulk seed/revision of a price list. */
  applyPriceListSeed: (
    priceListId: number,
    options: SeedOptions,
    inventoryIds?: number[],
  ) => Promise<{ applied: number; plan: SeedPlan }>;
  /** Outcome of the most recent publish, if any. */
  getLastPublishResult: () => Promise<PublishResult | null>;

  // ---------------------------------------------------------------------
  // Settings (src/core/services/SettingsService.ts, migration 028)
  // ---------------------------------------------------------------------
  //
  // Business settings — data about the business itself (company profile,
  // document print labels, catalog-publishing choices) rather than this
  // device's UI state — live in the database (the `settings` table) instead
  // of device-local storage, so they ride multi-device sync later and ship
  // in backups/exports today. Device/session-local preferences (theme,
  // sidebar collapsed state, table filters, last-viewed screen, session
  // username) are unaffected and stay on the synchronous `store`
  // (ElectronEventBridge, src/renderer/preload.d.ts) — these four methods
  // are for business settings only.

  /** Parsed value for `key`, or `undefined` if unset. */
  getSetting: <T = unknown>(key: string) => Promise<T | undefined>;
  setSetting: (key: string, value: unknown) => Promise<void>;
  deleteSetting: (key: string) => Promise<void>;
  /** Every stored business setting, parsed, keyed by name. */
  getAllSettings: () => Promise<Record<string, unknown>>;
}
