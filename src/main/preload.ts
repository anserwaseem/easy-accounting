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

  getNextInvoiceNumber: (invoiceType: InvoiceType) =>
    ipcRenderer.invoke('invoice:getId', invoiceType),

  insertInvoice: (invoiceType: InvoiceType, invoice: Invoice) =>
    ipcRenderer.invoke('invoice:insert', invoiceType, invoice),

  getInvoices: (invoiceType: InvoiceType) =>
    ipcRenderer.invoke('invoice:getAll', invoiceType),

  getInvoice: (invoiceId: number) =>
    ipcRenderer.invoke('invoice:get', invoiceId),

  exportInvoices: (startDate?: string, endDate?: string) =>
    ipcRenderer.invoke('invoice:exportExcel', startDate, endDate),

  doesInvoiceExists: (invoiceId: number, invoiceType: InvoiceType) =>
    ipcRenderer.invoke('invoice:exist', invoiceId, invoiceType),

  getLastInvoiceNumber: (invoiceType: InvoiceType) =>
    ipcRenderer.invoke('invoice:getLastNumber', invoiceType),

  printToPdf: (invoiceNumber: number) =>
    ipcRenderer.invoke('print:toPDF', invoiceNumber),

  getOutputDir: () => ipcRenderer.invoke('print:outputDir'),

  /**
   * Get all accounts
   * @returns All accounts
   * @example const accounts = getAccounts();
   */
  getAccounts: () => ipcRenderer.invoke('account:getAll'),
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
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
