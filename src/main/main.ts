/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import { app, BrowserWindow, dialog, shell, ipcMain } from 'electron';
import log from 'electron-log';
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
  ApplyStockAdjustmentPayload,
  ReturnSaleInvoicePayload,
  BulkPriceListPositionPatch,
  UpsertAttributeDefinition,
  PurchasesByVendorFilters,
  CreateVendorIssuePayload,
  UpdateVendorIssuePayload,
  VendorStockOpeningRow,
  VendorStockActivityFilters,
} from 'types';
import { InvoiceType } from 'types';
import installer, { REACT_DEVELOPER_TOOLS } from 'electron-extension-installer';
import { isNil } from 'lodash';
import { addDays, format, parse } from 'date-fns';
import { parseAttributeKeyList } from './utils/catalog';
import MenuBuilder from './menu';
import { formatString, resolveHtmlPath, raise } from './utils/general';
import { enrichLedgerRowsWithJournalSummaries } from './utils/ledgerJournalEnrichment';
import { store } from './store';
import { AppUpdater } from './appUpdater';
import { MigrationRunner } from './migrations/index';
import {
  AuthService,
  AccountService,
  BackupService,
  ChartService,
  JournalService,
  LedgerService,
  StatementService,
  InvoiceService,
  InventoryService,
  PrintService,
  PricingService,
  PublishService,
  VendorStockService,
} from './services';
import {
  getPublishConfig,
  savePublishConfig,
  type PublishConfigInput,
} from './utils/publishConfig';
import type { SeedOptions } from './utils/priceSeeding';
import { ErrorManager } from './errorManager';
import { DEFAULT_USER } from './utils/constants';

// set proper app name for Windows notifications
if (process.platform === 'win32') {
  app.setAppUserModelId(formatString(app.name));
}

log.transports.file.level = 'info';
log.transports.console.level = 'info';
log.info('Main process started');

new ErrorManager().init();

let mainWindow: BrowserWindow | null = null;

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

  const htmlPath = resolveHtmlPath('index.html');

  // A window that cannot load its own UI is indistinguishable from a window
  // that is still loading: `ready-to-show` never fires, so nothing is ever
  // shown and the app sits there as a dock icon. In development that means the
  // renderer dev server is not up; in a packaged build it means the bundled
  // renderer is missing or unreadable. Neither is guessable from the outside,
  // so name it rather than leaving a blank rectangle.
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;

      log.error(
        `Failed to load renderer at ${validatedURL}: ${errorDescription} (${errorCode})`,
      );

      dialog.showErrorBox(
        'Easy Accounting could not load its interface',
        isDebug
          ? `The renderer dev server did not respond at ${validatedURL}.\n\nStart it with "npm start" and check that nothing else is using the port.\n\n${errorDescription} (${errorCode})`
          : `The application interface could not be loaded.\n\nPlease reinstall Easy Accounting.\n\n${errorDescription} (${errorCode})`,
      );
    },
  );

  mainWindow.loadURL(htmlPath);

  mainWindow.on('ready-to-show', () => {
    const validMainWindow = mainWindow ?? raise('"mainWindow" is not defined');
    if (process.env.START_MINIMIZED) {
      validMainWindow.minimize();
    } else {
      validMainWindow.show();
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

/**
 * Startup is all-or-nothing, and the window is the last thing it does.
 *
 * Migrations run first, then every service is constructed — and each service
 * prepares its statements in its constructor, against tables a migration was
 * supposed to have created. So anything that throws up there skips
 * `createWindow()` entirely: the process starts, no window appears, and the
 * user is looking at a dock icon with no way to tell what went wrong. Logging
 * is not enough, because in a packaged build nobody is watching a console.
 *
 * Say it out loud in a dialog, name the log file so the report is useful, and
 * exit rather than leaving a running process with no window to close.
 */
const reportFatalStartupError = (error: unknown) => {
  log.error('Fatal error during startup:', error);

  const message = error instanceof Error ? error.message : String(error);
  let logPath = '';
  try {
    logPath = log.transports.file.getFile().path;
  } catch {
    logPath = '';
  }

  dialog.showErrorBox(
    'Easy Accounting could not start',
    [
      message,
      '',
      'Your existing data has not been changed by the step that failed.',
      logPath && `Please send this log file to support:\n${logPath}`,
    ]
      .filter(Boolean)
      .join('\n'),
  );

  app.exit(1);
};

app
  .whenReady()
  .then(async () => {
    // Migrations must finish before any service is constructed: services
    // prepare their statements eagerly, so a service built against a
    // not-yet-migrated schema throws `SqliteError: no such table`. A migration
    // that fails now stops the run and rejects, which lands in
    // reportFatalStartupError below instead of half-starting the app.
    const migrationRunner = new MigrationRunner();
    await migrationRunner.waitForMigrations();

    const authService = new AuthService();
    const chartService = new ChartService();
    const accountService = new AccountService();
    const journalService = new JournalService();
    const ledgerService = new LedgerService();
    const statementService = new StatementService();
    const inventoryService = new InventoryService();
    const invoiceService = new InvoiceService();
    const printService = new PrintService();
    const pricingService = new PricingService();
    const publishService = new PublishService();
    const backupService = new BackupService();
    const vendorStockService = new VendorStockService();

    // setupUser(migrationRunner, authService);

    ipcMain.handle('publish:getConfig', async () => getPublishConfig());
    ipcMain.handle('publish:saveConfig', async (_, input: PublishConfigInput) =>
      savePublishConfig(input),
    );
    ipcMain.handle('publish:getPriceListNames', async () =>
      publishService.getPriceListNames(),
    );
    ipcMain.handle('publish:preview', async () => {
      const config = getPublishConfig();
      return publishService.previewCatalog({
        publicAttributeKeys: publishService.getPublicAttributeKeys(),
        publicPriceList: config.publicPriceList,
        imagesManifestUrl: config.imagesManifestUrl,
        requireImage: !config.publishWithoutImages,
        requiredAttributeKeys: parseAttributeKeyList(
          config.requiredAttributeKeys,
        ),
      });
    });
    ipcMain.handle('publish:itemStatuses', async () => {
      const config = getPublishConfig();
      return publishService.getItemPublishStatuses({
        publicPriceList: config.publicPriceList,
        publicAttributeKeys: publishService.getPublicAttributeKeys(),
        imagesManifestUrl: config.imagesManifestUrl,
        requireImage: !config.publishWithoutImages,
        requiredAttributeKeys: parseAttributeKeyList(
          config.requiredAttributeKeys,
        ),
      });
    });
    ipcMain.handle('publish:run', async (_, force?: boolean) =>
      publishService.publish(force ?? false),
    );
    ipcMain.handle('priceList:getAll', async () =>
      publishService.getPriceLists(),
    );
    ipcMain.handle('priceList:create', async (_, name: string) =>
      publishService.createPriceList(name),
    );
    ipcMain.handle('priceList:rename', async (_, id: number, name: string) =>
      publishService.renamePriceList(id, name),
    );
    ipcMain.handle(
      'priceList:previewSeed',
      async (_, priceListId: number, options: SeedOptions, ids?: number[]) =>
        publishService.previewSeed(priceListId, options, ids),
    );
    ipcMain.handle(
      'priceList:applySeed',
      async (_, priceListId: number, options: SeedOptions, ids?: number[]) =>
        publishService.applySeed(priceListId, options, ids),
    );
    ipcMain.handle(
      'priceList:setActive',
      async (_, id: number, isActive: boolean) =>
        publishService.setPriceListActive(id, isActive),
    );
    ipcMain.handle('publish:getLastResult', async () =>
      PublishService.getLastResult(),
    );

    ipcMain.handle('auth:login', async (_, user: UserCredentials) => {
      return authService.login(user);
    });
    ipcMain.handle('auth:register', async (_, user: UserCredentials) => {
      return authService.register(user);
    });
    ipcMain.handle('auth:logout', async () => {
      return AuthService.logout();
    });
    // read-only metadata for the sidebar staleness indicator; takes no
    // renderer input and returns no file paths or credentials
    ipcMain.handle('backup:lastInfo', async () =>
      backupService.getLastBackupInfo(),
    );
    // same operation as the native Backup menu's "Create Backup"; the local
    // backup path is stripped so the renderer only sees success/error
    ipcMain.handle('backup:create', async () => {
      const { success, error } = await backupService.createBackup();
      return { success, error };
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
    ipcMain.handle('account:getByIds', (_, ids: number[]) =>
      accountService.getAccountsByIds(ids),
    );
    ipcMain.handle('account:getByName', (_, name: string) =>
      accountService.getAccountByName(name),
    );
    ipcMain.handle(
      'account:getByNameAndCode',
      (_, name: string, code?: string) =>
        accountService.getAccountByNameAndCode(name, code),
    );
    ipcMain.handle(
      'account:getByNameAndChart',
      (_, chartId: number, name: string) =>
        accountService.getAccountByNameAndChart(chartId, name),
    );
    ipcMain.handle('account:insertAccount', async (_, account: InsertAccount) =>
      accountService.insertAccount(account),
    );
    ipcMain.handle('account:updateAccount', async (_, account: UpdateAccount) =>
      accountService.updateAccount(account),
    );
    ipcMain.handle(
      'account:updateDiscountProfile',
      async (_, accountId: number, discountProfileId: number | null) =>
        accountService.updateAccountDiscountProfile(
          accountId,
          discountProfileId,
        ),
    );
    ipcMain.handle('account:hasJournalEntries', (_, accountId: number) =>
      accountService.hasJournalEntries(accountId),
    );
    ipcMain.handle('account:deleteAccount', (_, accountId: number) =>
      accountService.deleteAccount(accountId),
    );
    ipcMain.handle(
      'account:toggleActive',
      (_, accountId: number, isActive: boolean) =>
        accountService.toggleAccountActive(accountId, isActive),
    );
    ipcMain.handle('chart:getAll', async () => chartService.getCharts());
    ipcMain.handle('ledger:get', async (_, accountId: number) => {
      const rows = ledgerService.getLedger(accountId);
      return enrichLedgerRowsWithJournalSummaries(rows, journalService);
    });
    ipcMain.handle(
      'ledger:getBalance',
      async (_, accountId: number) =>
        ledgerService.getBalance(accountId) ?? null,
    );
    ipcMain.handle(
      'ledger:getBalancesForAccountIds',
      async (_, accountIds: number[]) =>
        ledgerService.getBalancesForAccountIds(accountIds),
    );
    ipcMain.handle(
      'ledger:getBalancesForAccountIdsAsOfDate',
      async (_, accountIds: number[], asOfDate: string) =>
        ledgerService.getBalancesForAccountIdsAsOfDate(accountIds, asOfDate),
    );
    ipcMain.handle(
      'ledger:getLedgerRangeForAccountIds',
      async (_, accountIds: number[], startDate: string, endDate: string) => {
        const map = ledgerService.getLedgerRangeForAccountIds(
          accountIds,
          startDate,
          endDate,
        );
        const unique = [
          ...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0)),
        ].sort((a, b) => a - b);
        const flat = unique.flatMap((id) => map[id] ?? []);
        const enriched = enrichLedgerRowsWithJournalSummaries(
          flat,
          journalService,
        );
        const result: Record<number, LedgerView[]> = {};
        for (const id of unique) {
          result[id] = [];
        }
        for (const row of enriched) {
          result[row.accountId].push(row);
        }
        return result;
      },
    );
    ipcMain.handle(
      'ledger:getLedgersUpToDateForAccountIds',
      async (_, accountIds: number[], endDate: string) =>
        ledgerService.getLedgersUpToDateForAccountIds(accountIds, endDate),
    );
    ipcMain.handle('journal:getNextId', async () =>
      journalService.getNextJournalId(),
    );
    ipcMain.handle('journal:insert', async (_, journal: Journal) =>
      journalService.insertJournal(journal),
    );
    ipcMain.handle('journal:getAll', async () => journalService.getJournals());
    ipcMain.handle('journal:get', async (_, journalId: number) =>
      journalService.getJournal(journalId),
    );
    ipcMain.handle(
      'journal:getNarrationSummariesByIds',
      async (_, journalIds: number[]) =>
        journalService.getJournalNarrationSummariesByIds(journalIds),
    );
    ipcMain.handle('journal:getByInvoiceId', async (_, invoiceId: number) =>
      journalService.getJournalsByInvoiceId(invoiceId),
    );
    ipcMain.handle(
      'journal:updateNarration',
      async (_, journalId: number, narration: string) =>
        journalService.updateJournalNarration(journalId, narration),
    );
    ipcMain.handle(
      'journal:updateInfo',
      async (_, journalId: number, fields: UpdateJournalFields) =>
        journalService.updateJournalInfo(journalId, fields),
    );
    ipcMain.handle('inventory:save', (_, inventory: InventoryItem[]) =>
      inventoryService.saveInventory(inventory),
    );
    ipcMain.handle('inventory:get', () => inventoryService.getInventory());
    ipcMain.handle('attributeDefinition:getAll', () =>
      inventoryService.getAttributeDefinitions(),
    );
    ipcMain.handle(
      'attributeDefinition:upsert',
      (_, input: UpsertAttributeDefinition) =>
        inventoryService.upsertAttributeDefinition(input),
    );
    ipcMain.handle(
      'attributeDefinition:delete',
      (_, id: number, force?: boolean) =>
        inventoryService.deleteAttributeDefinition(id, force ?? false),
    );
    ipcMain.handle('attributeDefinition:reorder', (_, ids: number[]) =>
      inventoryService.reorderAttributeDefinitions(ids),
    );
    ipcMain.handle(
      'attributeDefinition:setActive',
      (_, id: number, isActive: boolean) =>
        inventoryService.setAttributeDefinitionActive(id, isActive),
    );
    ipcMain.handle(
      'attributeDefinition:setPublic',
      (_, id: number, isPublic: boolean) =>
        inventoryService.setAttributeDefinitionPublic(id, isPublic),
    );
    ipcMain.handle(
      'inventory:setExcludedFromCatalog',
      (_, id: number, excluded: boolean) =>
        inventoryService.setItemExcludedFromCatalog(id, excluded),
    );
    ipcMain.handle(
      'inventory:updateAttributes',
      (_, id: number, attributes: Record<string, unknown>) =>
        inventoryService.updateInventoryAttributes(id, attributes),
    );
    ipcMain.handle('inventory:exist', () =>
      inventoryService.doesInventoryExist(),
    );
    ipcMain.handle('inventory:insert', (_, item: InsertInventoryItem) =>
      inventoryService.insertItem(item),
    );
    ipcMain.handle('inventory:update', (_, item: UpdateInventoryItem) =>
      inventoryService.updateItem(item),
    );
    ipcMain.handle(
      'inventory:bulkUpdatePricesAndListPositions',
      (_, patches: BulkPriceListPositionPatch[]) =>
        inventoryService.bulkUpdatePricesAndListPositions(patches),
    );
    ipcMain.handle(
      'inventory:applyListPositions',
      (_, rows: Array<{ name: string; listPosition: number }>) =>
        inventoryService.applyListPositions(rows),
    );
    ipcMain.handle('inventory:getOpeningStock', () =>
      inventoryService.getOpeningStock(),
    );
    ipcMain.handle(
      'inventory:setOpeningStock',
      (
        _,
        items: SetOpeningStockItem[],
        asOfDate?: string,
        resetOthersToZero?: boolean,
      ) => inventoryService.setOpeningStock(items, asOfDate, resetOthersToZero),
    );
    ipcMain.handle(
      'inventory:applyStockAdjustment',
      (_, payload: ApplyStockAdjustmentPayload) =>
        inventoryService.applyStockAdjustment(payload),
    );
    ipcMain.handle('inventory:getStockAdjustments', (_, inventoryId?: number) =>
      inventoryService.getStockAdjustments(inventoryId),
    );
    ipcMain.handle('inventory:getInventoryIdsWithHistory', () =>
      inventoryService.getInventoryIdsWithHistory(),
    );
    ipcMain.handle('itemType:getAll', () => pricingService.getItemTypes());
    ipcMain.handle('itemType:insert', (_, name: string) =>
      pricingService.insertItemType(name),
    );
    ipcMain.handle('itemType:updateName', (_, id: number, name: string) =>
      pricingService.updateItemTypeName(id, name),
    );
    ipcMain.handle(
      'itemType:toggleActive',
      (_, id: number, isActive: boolean) =>
        pricingService.toggleItemType(id, isActive),
    );
    ipcMain.handle('itemType:delete', (_, id: number) =>
      pricingService.deleteItemType(id),
    );
    ipcMain.handle('itemType:getPrimary', () =>
      pricingService.getPrimaryItemType(),
    );
    ipcMain.handle('itemType:setPrimary', (_, itemTypeId: number) =>
      pricingService.setPrimaryItemType(itemTypeId),
    );
    ipcMain.handle('itemType:clearPrimary', () =>
      pricingService.clearPrimaryItemType(),
    );
    ipcMain.handle('discountProfile:getAll', () =>
      pricingService.getDiscountProfiles(),
    );
    ipcMain.handle('discountProfile:insert', (_, name: string) =>
      pricingService.insertDiscountProfile(name),
    );
    ipcMain.handle(
      'discountProfile:updateName',
      (_, id: number, name: string) =>
        pricingService.updateDiscountProfileName(id, name),
    );
    ipcMain.handle(
      'discountProfile:toggleActive',
      (_, id: number, isActive: boolean) =>
        pricingService.toggleDiscountProfile(id, isActive),
    );
    ipcMain.handle('discountProfile:delete', (_, id: number) =>
      pricingService.deleteDiscountProfile(id),
    );
    ipcMain.handle(
      'discountProfile:deleteFromAccount',
      (_, accountId: number, profileId: number) =>
        pricingService.deleteDiscountProfileFromAccount(accountId, profileId),
    );
    ipcMain.handle('discountProfile:getTypeDiscounts', (_, profileId: number) =>
      pricingService.getProfileTypeDiscounts(profileId),
    );
    ipcMain.handle(
      'discountProfile:saveTypeDiscounts',
      (
        _,
        profileId: number,
        discounts: Array<{ itemTypeId: number; discountPercent: number }>,
      ) => pricingService.saveProfileTypeDiscounts(profileId, discounts),
    );
    ipcMain.handle('invoice:getId', (_, invoiceType: InvoiceType) =>
      invoiceService.getNextInvoiceNumber(invoiceType),
    );
    ipcMain.handle(
      'invoice:insert',
      (_, invoiceType: InvoiceType, invoice: Invoice) =>
        invoiceService.insertInvoice(invoiceType, invoice),
    );
    ipcMain.handle(
      'invoice:update',
      (_, invoiceType: InvoiceType, invoiceId: number, invoice: Invoice) =>
        invoiceService.updateInvoice(invoiceType, invoiceId, invoice),
    );
    ipcMain.handle('invoice:getAll', (_, invoiceType: InvoiceType) =>
      invoiceService.getInvoices(invoiceType),
    );
    ipcMain.handle('invoice:get', (_, invoiceId: number) =>
      invoiceService.getInvoice(invoiceId),
    );
    ipcMain.handle(
      'invoice:insertQuotation',
      (_, invoiceType: InvoiceType, invoice: Invoice) =>
        invoiceService.insertQuotationInvoice(invoiceType, invoice),
    );
    ipcMain.handle('invoice:getQuotations', (_, invoiceType: InvoiceType) =>
      invoiceService.getQuotationInvoices(invoiceType),
    );
    ipcMain.handle(
      'invoice:updateQuotation',
      (_, invoiceId: number, invoice: Invoice) =>
        invoiceService.updateQuotationInvoice(invoiceId, invoice),
    );
    ipcMain.handle('invoice:convertQuotation', (_, invoiceId: number) =>
      invoiceService.convertQuotationInvoice(invoiceId),
    );
    ipcMain.handle(
      'invoice:returnSale',
      (_, invoiceId: number, payload?: ReturnSaleInvoicePayload) =>
        invoiceService.returnSaleInvoice(invoiceId, payload),
    );
    ipcMain.handle(
      'invoice:returnPurchase',
      (_, invoiceId: number, payload?: ReturnSaleInvoicePayload) =>
        invoiceService.returnPurchaseInvoice(invoiceId, payload),
    );
    ipcMain.handle(
      'invoice:getSaleEditDateBounds',
      (_, invoiceId: number, accountId: number, invoiceNumber: number) =>
        invoiceService.getSaleInvoiceEditDateBounds(
          invoiceId,
          accountId,
          invoiceNumber,
        ),
    );
    ipcMain.handle(
      'invoice:updateBiltyAndCartons',
      (
        _,
        invoiceId: number,
        biltyNumber: string | undefined,
        cartons: number | undefined,
      ) =>
        invoiceService.updateInvoiceBiltyAndCartons(
          invoiceId,
          biltyNumber,
          cartons,
        ),
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
    ipcMain.handle(
      'invoice:getAdjacentId',
      (
        _,
        invoiceId: number,
        invoiceType: InvoiceType,
        direction: 'next' | 'previous',
        scope?: 'posted' | 'quotation',
      ) =>
        invoiceService.getAdjacentInvoiceId(
          invoiceId,
          invoiceType,
          direction,
          scope ?? 'posted',
        ),
    );
    ipcMain.handle('invoice:getLastNumber', (_, invoiceType: InvoiceType) =>
      invoiceService.getLastInvoiceNumber(invoiceType),
    );
    ipcMain.handle(
      'invoice:getIdsFromMinId',
      (
        _,
        invoiceType: InvoiceType,
        fromInvoiceId: number,
        scope?: 'posted' | 'quotation',
      ) =>
        invoiceService.getInvoiceIdsFromMinId(
          invoiceType,
          fromInvoiceId,
          scope ?? 'posted',
        ),
    );
    ipcMain.handle(
      'invoice:getPdfOutputBaseName',
      (_, invoiceId: number, invoiceType: InvoiceType) =>
        invoiceService.getInvoicePdfOutputBaseName(invoiceId, invoiceType),
    );
    ipcMain.handle(
      'invoice:getAutoDiscount',
      (_, accountId: number, inventoryId: number) =>
        pricingService.getAutoDiscount(accountId, inventoryId),
    );
    ipcMain.handle('print:toPDF', (_, outputBaseName: string | number) =>
      printService.printPDF(String(outputBaseName)),
    );
    ipcMain.handle('print:outputDir', () => printService.outputDirectory);
    ipcMain.handle('chart:insertCustomHead', (_, chart: InsertChart) =>
      chartService.insertCustomHead(chart),
    );

    ipcMain.handle(
      'report:getLedgerRange',
      async (
        _,
        params: { accountId: number; startDate: string; endDate: string },
      ) => {
        // opening balance should be "as of before startDate"
        // closing balance should include endDate (use endDate + 1 day with the existing "< date" query)
        const closingExclusiveDate = format(
          addDays(parse(params.endDate, 'yyyy-MM-dd', new Date()), 1),
          'yyyy-MM-dd',
        );
        const [open, entries, close] = await Promise.all([
          ledgerService.getBalanceAtDate(params.accountId, params.startDate),
          ledgerService.getLedgerRange(
            params.accountId,
            params.startDate,
            params.endDate,
          ),
          ledgerService.getBalanceAtDate(
            params.accountId,
            closingExclusiveDate,
          ),
        ]);
        const enrichedEntries = enrichLedgerRowsWithJournalSummaries(
          entries,
          journalService,
        );
        return {
          openingBalance: open,
          entries: enrichedEntries,
          closingBalance: close,
        };
      },
    );

    ipcMain.handle(
      'report:getInventoryHealth',
      async (
        _,
        filters: { startDate: string; endDate: string; itemTypeIds?: number[] },
      ) => inventoryService.getInventoryHealth(filters),
    );

    ipcMain.handle(
      'report:getStockAsOf',
      async (_, filters: { asOfDate: string; itemTypeIds?: number[] }) =>
        inventoryService.getStockAsOf(filters),
    );

    ipcMain.handle(
      'report:getSalesPerformance',
      async (_, filters: { startDate: string; endDate: string }) =>
        invoiceService.getSalesPerformance(filters),
    );

    ipcMain.handle(
      'report:getPurchasesByVendor',
      async (_, filters: PurchasesByVendorFilters) =>
        invoiceService.getPurchasesByVendor(filters),
    );

    ipcMain.handle(
      'vendorStock:getOnHand',
      async (_, vendorAccountId?: number) =>
        vendorStockService.getOnHand(vendorAccountId),
    );

    ipcMain.handle('vendorStock:getTrackedVendors', () =>
      vendorStockService.getTrackedVendorAccounts(),
    );

    ipcMain.handle(
      'vendorStock:setOpeningStock',
      async (
        _,
        vendorAccountId: number,
        items: Array<{ name: string; quantity: number }>,
        asOfDate: string,
        resetOthersToZero?: boolean,
      ) =>
        vendorStockService.setOpeningStock(
          vendorAccountId,
          items,
          asOfDate,
          resetOthersToZero,
        ),
    );

    ipcMain.handle(
      'vendorStock:importOpeningStock',
      async (
        _,
        rows: VendorStockOpeningRow[],
        asOfDate: string,
        resetOthersToZero?: boolean,
      ) =>
        vendorStockService.importOpeningStock(
          rows,
          asOfDate,
          resetOthersToZero,
        ),
    );

    ipcMain.handle('vendorStock:getNextIssueNumber', () =>
      vendorStockService.getNextIssueNumber(),
    );

    ipcMain.handle(
      'vendorStock:createIssue',
      async (_, payload: CreateVendorIssuePayload) =>
        vendorStockService.createIssue(payload),
    );

    ipcMain.handle(
      'vendorStock:updateIssue',
      async (_, issueId: number, payload: UpdateVendorIssuePayload) =>
        vendorStockService.updateIssue(issueId, payload),
    );

    ipcMain.handle('vendorStock:deleteIssue', async (_, issueId: number) =>
      vendorStockService.deleteIssue(issueId),
    );

    ipcMain.handle('vendorStock:getIssues', () =>
      vendorStockService.getIssues(),
    );

    ipcMain.handle('vendorStock:getIssue', async (_, issueId: number) =>
      vendorStockService.getIssue(issueId),
    );

    ipcMain.handle(
      'vendorStock:getActivity',
      async (_, filters: VendorStockActivityFilters) =>
        vendorStockService.getActivity(filters),
    );

    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(reportFatalStartupError);
