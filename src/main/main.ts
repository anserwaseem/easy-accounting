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
} from 'types';
import installer, { REACT_DEVELOPER_TOOLS } from 'electron-extension-installer';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './utils/general';
import { store } from './store';
import { AppUpdater } from './appUpdater';
import { MigrationRunner } from './migrations/index';
import {
  AuthService,
  AccountService,
  JournalService,
  LedgerService,
  StatementService,
} from './services';
import { ChartService } from './services/Chart.service';

log.transports.file.level = 'info';
log.transports.console.level = 'info';
log.info('Main process started');

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
    return await installer(extensions, { forceDownload });
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
    // eslint-disable-next-line no-new
    new MigrationRunner();

    const authService = new AuthService();
    const chartService = new ChartService();
    const accountService = new AccountService();
    const journalService = new JournalService();
    const ledgerService = new LedgerService();
    const statementService = new StatementService();

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

    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
