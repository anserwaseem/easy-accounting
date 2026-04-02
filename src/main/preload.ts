// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  UserCredentials,
  BalanceSheet,
  InsertAccount,
  UpdateAccount,
  Journal,
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
  ItemType,
  DiscountProfile,
  ProfileTypeDiscount,
} from 'types';
import { InvoiceType } from 'types';

export type Channels = 'backup-operation-status' | 'backup-operation-progress';

// eslint-disable-next-line no-console
console.log('Preload process started');

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },

  store: {
    get(key: string) {
      return ipcRenderer.sendSync('electron-store-get', key);
    },
    set(key: string, val: unknown) {
      ipcRenderer.send('electron-store-set', key, val);
    },
    delete(key: string) {
      ipcRenderer.send('electron-store-delete', key);
    },
    // Other method you want to add like has(), reset(), etc.
  },

  /**
   * Login a user
   * @param user The user to login
   * @returns Boolean indicating if the user was logged in
   * @example const token = login({ username: 'user', password: 'pass' });
   */
  login: (user: UserCredentials) => ipcRenderer.invoke('auth:login', user),
  /**
   * Register a user
   * @param user The user to register
   * @returns Boolean indicating if the user was registered
   * @example const token = register({ username: 'user', password: 'pass' });
   */
  register: (user: UserCredentials) =>
    ipcRenderer.invoke('auth:register', user),
  /**
   * Logout a user
   * @example logout();
   */
  logout: () => ipcRenderer.invoke('auth:logout'),
  /**
   * Save a balance sheet
   * @param balanceSheet The balance sheet to save
   * @returns Boolean indicating if the balance sheet was saved
   * @example const balanceSheet = saveBalanceSheet({ ... });
   */
  saveBalanceSheet: (balanceSheet: BalanceSheet) =>
    ipcRenderer.invoke('balanceSheet:save', balanceSheet),

  saveInventory: (inventory: InventoryItem[]) =>
    ipcRenderer.invoke('inventory:save', inventory),

  getInventory: () => ipcRenderer.invoke('inventory:get'),

  doesInventoryExist: () => ipcRenderer.invoke('inventory:exist'),

  insertInventoryItem: (item: InsertInventoryItem) =>
    ipcRenderer.invoke('inventory:insert', item),

  updateInventoryItem: (item: UpdateInventoryItem) =>
    ipcRenderer.invoke('inventory:update', item),

  getOpeningStock: () =>
    ipcRenderer.invoke('inventory:getOpeningStock') as Promise<
      InventoryOpeningStock[]
    >,

  setOpeningStock: (
    items: SetOpeningStockItem[],
    asOfDate?: string,
    resetOthersToZero?: boolean,
  ) =>
    ipcRenderer.invoke(
      'inventory:setOpeningStock',
      items,
      asOfDate,
      resetOthersToZero,
    ) as Promise<ApiResponse>,

  applyStockAdjustment: (payload: ApplyStockAdjustmentPayload) =>
    ipcRenderer.invoke(
      'inventory:applyStockAdjustment',
      payload,
    ) as Promise<ApiResponse>,

  getStockAdjustments: (inventoryId?: number) =>
    ipcRenderer.invoke('inventory:getStockAdjustments', inventoryId) as Promise<
      StockAdjustment[]
    >,

  getInventoryIdsWithHistory: () =>
    ipcRenderer.invoke('inventory:getInventoryIdsWithHistory') as Promise<
      number[]
    >,

  getItemTypes: () =>
    ipcRenderer.invoke('itemType:getAll') as Promise<ItemType[]>,

  insertItemType: (name: string) =>
    ipcRenderer.invoke('itemType:insert', name) as Promise<boolean>,

  updateItemTypeName: (id: number, name: string) =>
    ipcRenderer.invoke('itemType:updateName', id, name) as Promise<boolean>,

  toggleItemTypeActive: (id: number, isActive: boolean) =>
    ipcRenderer.invoke(
      'itemType:toggleActive',
      id,
      isActive,
    ) as Promise<boolean>,

  deleteItemType: (id: number) =>
    ipcRenderer.invoke('itemType:delete', id) as Promise<boolean>,

  getPrimaryItemType: () =>
    ipcRenderer.invoke('itemType:getPrimary') as Promise<number | undefined>,

  setPrimaryItemType: (itemTypeId: number) =>
    ipcRenderer.invoke('itemType:setPrimary', itemTypeId) as Promise<boolean>,

  clearPrimaryItemType: () =>
    ipcRenderer.invoke('itemType:clearPrimary') as Promise<boolean>,

  getDiscountProfiles: () =>
    ipcRenderer.invoke('discountProfile:getAll') as Promise<DiscountProfile[]>,

  insertDiscountProfile: (name: string) =>
    ipcRenderer.invoke('discountProfile:insert', name) as Promise<boolean>,

  updateDiscountProfileName: (id: number, name: string) =>
    ipcRenderer.invoke(
      'discountProfile:updateName',
      id,
      name,
    ) as Promise<boolean>,

  toggleDiscountProfileActive: (id: number, isActive: boolean) =>
    ipcRenderer.invoke(
      'discountProfile:toggleActive',
      id,
      isActive,
    ) as Promise<boolean>,

  deleteDiscountProfile: (id: number) =>
    ipcRenderer.invoke('discountProfile:delete', id) as Promise<boolean>,

  deleteDiscountProfileFromAccount: (accountId: number, profileId: number) =>
    ipcRenderer.invoke(
      'discountProfile:deleteFromAccount',
      accountId,
      profileId,
    ) as Promise<boolean>,

  getDiscountProfileTypeDiscounts: (profileId: number) =>
    ipcRenderer.invoke(
      'discountProfile:getTypeDiscounts',
      profileId,
    ) as Promise<ProfileTypeDiscount[]>,

  saveDiscountProfileTypeDiscounts: (
    profileId: number,
    discounts: Array<{ itemTypeId: number; discountPercent: number }>,
  ) =>
    ipcRenderer.invoke(
      'discountProfile:saveTypeDiscounts',
      profileId,
      discounts,
    ) as Promise<boolean>,

  getNextInvoiceNumber: (invoiceType: InvoiceType) =>
    ipcRenderer.invoke('invoice:getId', invoiceType),

  insertInvoice: (invoiceType: InvoiceType, invoice: Invoice) =>
    ipcRenderer.invoke('invoice:insert', invoiceType, invoice),

  getInvoices: (invoiceType: InvoiceType) =>
    ipcRenderer.invoke('invoice:getAll', invoiceType),

  getInvoice: (invoiceId: number) =>
    ipcRenderer.invoke('invoice:get', invoiceId),

  updateInvoiceBiltyAndCartons: (
    invoiceId: number,
    biltyNumber?: string,
    cartons?: number,
  ) =>
    ipcRenderer.invoke(
      'invoice:updateBiltyAndCartons',
      invoiceId,
      biltyNumber,
      cartons,
    ),

  exportInvoices: (startDate?: string, endDate?: string) =>
    ipcRenderer.invoke('invoice:exportExcel', startDate, endDate),

  doesInvoiceExists: (invoiceId: number, invoiceType: InvoiceType) =>
    ipcRenderer.invoke('invoice:exist', invoiceId, invoiceType),

  getAdjacentInvoiceId: (
    invoiceId: number,
    invoiceType: InvoiceType,
    direction: 'next' | 'previous',
  ) =>
    ipcRenderer.invoke(
      'invoice:getAdjacentId',
      invoiceId,
      invoiceType,
      direction,
    ),

  getLastInvoiceNumber: (invoiceType: InvoiceType) =>
    ipcRenderer.invoke('invoice:getLastNumber', invoiceType),

  getInvoiceIdsFromMinId: (invoiceType: InvoiceType, fromInvoiceId: number) =>
    ipcRenderer.invoke(
      'invoice:getIdsFromMinId',
      invoiceType,
      fromInvoiceId,
    ) as Promise<number[]>,

  getAutoDiscount: (accountId: number, inventoryId: number) =>
    ipcRenderer.invoke(
      'invoice:getAutoDiscount',
      accountId,
      inventoryId,
    ) as Promise<number>,

  printToPdf: (invoiceNumber: number) =>
    ipcRenderer.invoke('print:toPDF', invoiceNumber),

  getOutputDir: () => ipcRenderer.invoke('print:outputDir'),

  /**
   * Get all accounts
   * @returns All accounts
   * @example const accounts = getAccounts();
   */
  getAccounts: () => ipcRenderer.invoke('account:getAll'),
  getAccountByName: (name: string) =>
    ipcRenderer.invoke('account:getByName', name),
  getAccountByNameAndCode: (name: string, code?: string) =>
    ipcRenderer.invoke('account:getByNameAndCode', name, code),
  getAccountByNameAndChart: (chartId: number, name: string) =>
    ipcRenderer.invoke('account:getByNameAndChart', chartId, name),
  /**
   * Get all charts
   * @returns All charts
   * @example const charts = getCharts();
   */
  getCharts: () => ipcRenderer.invoke('chart:getAll'),
  /**
   * Insert a custom head
   * @param chart The chart to insert
   * @returns Boolean indicating if the chart was inserted
   * @example const isInserted = insertCustomHead({ ... });
   */
  insertCustomHead: (chart: InsertChart) =>
    ipcRenderer.invoke('chart:insertCustomHead', chart),
  /**
   * Insert an account
   * @param account The account to insert
   * @returns Boolean indicating if the account was inserted
   * @example const account = insertAccount({ ... });
   */
  insertAccount: (account: InsertAccount) =>
    ipcRenderer.invoke('account:insertAccount', account),
  /**
   * Update an account
   * @param account The account to update
   * @returns Boolean indicating if the account was updated
   * @example const account = updateAccount({ ... });
   */
  updateAccount: (account: UpdateAccount) =>
    ipcRenderer.invoke('account:updateAccount', account),

  updateAccountDiscountProfile: (
    accountId: number,
    discountProfileId: number | null,
  ) =>
    ipcRenderer.invoke(
      'account:updateDiscountProfile',
      accountId,
      discountProfileId,
    ) as Promise<boolean>,
  /**
   * Check if an account has any journal entries
   * @param accountId The account ID to check
   * @returns Boolean indicating if the account has journal entries
   * @example const hasJournals = hasJournalEntries(1);
   */
  hasJournalEntries: (accountId: number) =>
    ipcRenderer.invoke('account:hasJournalEntries', accountId),
  /**
   * Delete an account if it has no journal entries
   * @param accountId The account ID to delete
   * @returns Boolean indicating if the account was deleted
   * @example const isDeleted = deleteAccount(1);
   */
  deleteAccount: (accountId: number) =>
    ipcRenderer.invoke('account:deleteAccount', accountId),
  /**
   * Toggle the active status of an account
   * @param accountId The account ID to toggle
   * @param isActive The new active status
   * @returns Boolean indicating if the account status was updated
   * @example const isUpdated = toggleAccountActive(1, false);
   */
  toggleAccountActive: (accountId: number, isActive: boolean) =>
    ipcRenderer.invoke('account:toggleActive', accountId, isActive),
  /**
   * Get a ledger
   * @param accountId The account id to get
   * @returns The ledger if found, undefined otherwise
   * @example const ledger = getLedger(1);
   */
  getLedger: (accountId: number) =>
    ipcRenderer.invoke('ledger:get', accountId) as Promise<LedgerView[]>,
  /**
   * Get the next journal id
   * @returns The next journal id
   * @example const journalId = getNextJournalId();
   */
  getNextJournalId: () => ipcRenderer.invoke('journal:getNextId'),
  /**
   * Insert a journal
   * @param journal The journal to insert
   * @returns Boolean indicating if the journal was inserted
   * @example const isInserted = insertJournal({ ... });
   * @throws Error if any error occurs while inserting the journal
   */
  insertJournal: (journal: Journal) =>
    ipcRenderer.invoke('journal:insert', journal),
  /**
   * Get all journals
   * @returns All journals
   * @example const journals = getJournals();
   */
  getJournals: () => ipcRenderer.invoke('journal:getAll'),
  /**
   * Get a journal
   * @param journalId The journal id to get
   * @returns The journal if found, undefined otherwise
   * @example const journal = getJournal(1);
   */
  getJournal: (journalId: number) =>
    ipcRenderer.invoke('journal:get', journalId),
  /**
   * Update a journal narration
   * @param journalId The journal id to update
   * @param narration The new narration
   * @returns Promise that resolves when the update is complete
   * @example await updateJournalNarration(1, 'New narration');
   * @throws Error if the journal is posted or not found
   */
  updateJournalNarration: (journalId: number, narration: string) =>
    ipcRenderer.invoke('journal:updateNarration', journalId, narration),
  /**
   * Update journal info (narration, bill number, discount percentage)
   */
  updateJournalInfo: (journalId: number, fields: UpdateJournalFields) =>
    ipcRenderer.invoke('journal:updateInfo', journalId, fields),
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
