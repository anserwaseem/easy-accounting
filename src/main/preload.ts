// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels = 'ipc-example';

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
  login: (user: Auth) => ipcRenderer.invoke('auth:login', user),
  /**
   * Register a user
   * @param user The user to register
   * @returns Boolean indicating if the user was registered
   * @example const token = register({ username: 'user', password: 'pass' });
   */
  register: (user: Auth) => ipcRenderer.invoke('auth:register', user),
  /**
   * Logout a user
   * @example logout();
   */
  logout: () => ipcRenderer.invoke('auth:logout'),
  /**
   * Get a user
   * @param username The username to get
   * @returns The user if found, undefined otherwise
   * @example const user = getUser('user');
   */
  getUser: (username: string) => ipcRenderer.invoke('auth:getUser', username),
  /**
   * Save a balance sheet
   * @param balanceSheet The balance sheet to save
   * @returns Boolean indicating if the balance sheet was saved
   * @example const balanceSheet = saveBalanceSheet({ ... });
   */
  saveBalanceSheet: (balanceSheet: BalanceSheet) =>
    ipcRenderer.invoke('balanceSheet:save', balanceSheet),
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
  getLedger: (accountId: number) => ipcRenderer.invoke('ledger:get', accountId),
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
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
