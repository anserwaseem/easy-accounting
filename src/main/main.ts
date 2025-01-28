/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import { app, BrowserWindow, shell, ipcMain } from 'electron';
import log from 'electron-log';
import type {
  UserCredentials,
  BalanceSheet,
  InsertAccount,
  UpdateAccount,
  Journal,
  InventoryItem,
  Invoice,
  UpdateInventoryItem,
  InsertInventoryItem,
} from 'types';
import { InvoiceType } from 'types';
import installer, { REACT_DEVELOPER_TOOLS } from 'electron-extension-installer';
import { isNil } from 'lodash';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './utils/general';
import { store } from './store';
import { AppUpdater } from './appUpdater';
import { MigrationRunner } from './migrations/index';
import {
  AuthService,
  AccountService,
  ChartService,
  JournalService,
  LedgerService,
  StatementService,
  InvoiceService,
  InventoryService,
  PrintService,
} from './services';
import { ErrorManager } from './errorManager';
import { DEFAULT_USER } from './utils/constants';

log.transports.file.level = 'info';
log.transports.console.level = 'info';
log.info('Main process started');

new ErrorManager().init();

let mainWindow: BrowserWindow | null = null;

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  console.log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

ipcMain.on('electron-store-get', async (event, val) => {
  event.returnValue = store.get(val);
});

ipcMain.on('electron-store-set', async (_, key, val) => {
  if (isNil(val)) {
    return; // so app doesn't throw `TypeError: Use `delete()` to clear values`
  }
  store.set(key, val);
});

ipcMain.on('electron-store-delete', async (_, key) => {
  store.delete(key);
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = [REACT_DEVELOPER_TOOLS];

  try {
    return await installer(extensions, {
      forceDownload,
      loadExtensionOptions: { allowFileAccess: true },
    });
  } catch (error) {
    console.log(error);
  }
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    height: 1024,
    width: 1440,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  // eslint-disable-next-line no-new
  new AppUpdater(mainWindow);
  // Check for updates immediately when the app starts
  AppUpdater.checkForUpdates();
  // Check for updates every hour
  setInterval(() => AppUpdater.checkForUpdates(), 60 * 60 * 1000);
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const setupUser = (
  migrationRunner: MigrationRunner,
  authService: AuthService,
) => {
  migrationRunner
    .waitForMigrations()
    .then(() => {
      const userExists = authService.login(DEFAULT_USER);
      if (!userExists) {
        authService.register(DEFAULT_USER);
      }
    })
    .catch((err) => log.error(err));
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(async () => {
    const migrationRunner = new MigrationRunner();
    await migrationRunner.waitForMigrations();
    // FIXME when a migration runs where for instance a new table is added, it's corresponding service throws error `SqliteError: no such table: table_name` so should we wait for migrations to finish? but if we do and there's some issue in executing migrations, would app pause/halt?

    const authService = new AuthService();
    const chartService = new ChartService();
    const accountService = new AccountService();
    const journalService = new JournalService();
    const ledgerService = new LedgerService();
    const statementService = new StatementService();
    const inventoryService = new InventoryService();
    const invoiceService = new InvoiceService();
    const printService = new PrintService();

    // setupUser(migrationRunner, authService);

    ipcMain.handle('auth:login', async (_, user: UserCredentials) => {
      return authService.login(user);
    });
    ipcMain.handle('auth:register', async (_, user: UserCredentials) => {
      return authService.register(user);
    });
    ipcMain.handle('auth:logout', async () => {
      return AuthService.logout();
    });
    ipcMain.handle(
      'balanceSheet:save',
      async (_, balanceSheet: BalanceSheet) => {
        try {
          return statementService.saveBalanceSheet(balanceSheet);
        } catch (error) {
          log.error('Error in saveBalanceSheet', error);
        }
      },
    );
    ipcMain.handle('account:getAll', async () => accountService.getAccounts());
    ipcMain.handle('account:insertAccount', async (_, account: InsertAccount) =>
      accountService.insertAccount(account),
    );
    ipcMain.handle('account:updateAccount', async (_, account: UpdateAccount) =>
      accountService.updateAccount(account),
    );
    ipcMain.handle('chart:getAll', async () => chartService.getCharts());
    ipcMain.handle('ledger:get', async (_, accountId: number) =>
      ledgerService.getLedger(accountId),
    );
    ipcMain.handle('journal:getNextId', async () =>
      journalService.getNextJournalId(),
    );
    ipcMain.handle('journal:insert', async (_, journal: Journal) =>
      journalService.insertJournal(journal),
    );
    ipcMain.handle('journal:getAll', async () => journalService.getJournals());
    ipcMain.handle('journal:get', async (_, journalId: number) =>
      journalService.getJorunal(journalId),
    );
    ipcMain.handle('inventory:save', (_, inventory: InventoryItem[]) =>
      inventoryService.saveInventory(inventory),
    );
    ipcMain.handle('inventory:get', () => inventoryService.getInventory());
    ipcMain.handle('inventory:exist', () =>
      inventoryService.doesInventoryExist(),
    );
    ipcMain.handle('inventory:insert', (_, item: InsertInventoryItem) =>
      inventoryService.insertItem(item),
    );
    ipcMain.handle('inventory:update', (_, item: UpdateInventoryItem) =>
      inventoryService.updateItem(item),
    );
    ipcMain.handle('invoice:getId', (_, invoiceType: InvoiceType) =>
      invoiceService.getNextInvoiceNumber(invoiceType),
    );
    ipcMain.handle(
      'invoice:insert',
      (_, invoiceType: InvoiceType, invoice: Invoice) =>
        invoiceService.insertInvoice(invoiceType, invoice),
    );
    ipcMain.handle('invoice:getAll', (_, invoiceType: InvoiceType) =>
      invoiceService.getInvoices(invoiceType),
    );
    ipcMain.handle('invoice:get', (_, invoiceId: number) =>
      invoiceService.getInvoice(invoiceId),
    );
    ipcMain.handle(
      'invoice:exportExcel',
      async (_, startDate?: string, endDate?: string) =>
        invoiceService.exportSaleInvoices(startDate, endDate),
    );
    ipcMain.handle(
      'invoice:exist',
      (_, invoiceId: number, invoiceType: InvoiceType) =>
        invoiceService.doesInvoiceExists(invoiceId, invoiceType),
    );
    ipcMain.handle('invoice:getLastNumber', (_, invoiceType: InvoiceType) =>
      invoiceService.getLastInvoiceNumber(invoiceType),
    );
    ipcMain.handle('print:toPDF', (_, invoiceNumber: number) =>
      printService.printPDF(invoiceNumber),
    );
    ipcMain.handle('print:outputDir', () => printService.outputDirectory);

    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
