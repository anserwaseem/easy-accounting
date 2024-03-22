// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { TODO } from './services/Database.service';

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

  insertTODO: (todo: TODO) => ipcRenderer.invoke('todo:insert', todo),
  deleteTODO: (id: number) => ipcRenderer.invoke('todo:delete', id),
  getAllTODO: () => ipcRenderer.invoke('todo:getAll'),
  getOneTODO: (id: number) => ipcRenderer.invoke('todo:getOne', id),
  updateTODO: (todo: TODO) => ipcRenderer.invoke('todo:update', todo),
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
   * @param token The token to use
   * @returns Boolean indicating if the balance sheet was saved
   * @example const balanceSheet = saveBalanceSheet({ ... });
   */
  saveBalanceSheet: (balanceSheet: BalanceSheet, token?: string | null) =>
    ipcRenderer.invoke('balanceSheet:save', balanceSheet, token),
  /**
   * Get all accounts
   * @returns All accounts
   * @example const accounts = getAccounts(token);
   */
  getAccounts: (token?: string | null) =>
    ipcRenderer.invoke('account:getAll', token),
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
