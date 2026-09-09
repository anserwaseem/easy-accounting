import type { AppApi } from '@core/api/AppApi';
import type { ImportOutcome } from '@core/db/import';
import type {
  SyncConnectResult,
  SyncJoinResult,
  SyncRebuildResult,
  SyncStatusPayload,
} from '../worker/syncManager';
import type { RpcCall, WorkerMessage } from './rpc';

export type {
  ImportOutcome,
  SyncConnectResult,
  SyncJoinResult,
  SyncRebuildResult,
  SyncStatusPayload,
};

/**
 * Methods backed by a real handler in the db worker (src/worker/db.worker.ts)
 * — every AppApi member except the Electron-only/not-yet-portable group
 * below. Kept as an explicit list (rather than deriving it by exclusion) so
 * adding a new AppApi method is a compile error here until it's either
 * wired into the worker or added to UNSUPPORTED_METHODS — there is no
 * third, silently-broken state.
 */
const METHODS = [
  'login',
  'register',
  'logout',
  'getAccounts',
  'getAccountsByIds',
  'getAccountByName',
  'getAccountByNameAndCode',
  'getAccountByNameAndChart',
  'insertAccount',
  'updateAccount',
  'bulkUpdateAccountUrduFields',
  'updateAccountDiscountProfile',
  'hasJournalEntries',
  'deleteAccount',
  'toggleAccountActive',
  'getCharts',
  'insertCustomHead',
  'getNextJournalId',
  'insertJournal',
  'getJournals',
  'getJournal',
  'getJournalNarrationSummariesByIds',
  'getJournalsByInvoiceId',
  'updateJournalNarration',
  'updateJournalInfo',
  'getLedger',
  'getLedgerBalance',
  'getLedgerBalancesForAccountIds',
  'getLedgerBalancesForAccountIdsAsOfDate',
  'getLedgerRangeForAccountIds',
  'getLedgersUpToDateForAccountIds',
  'getNextInvoiceNumber',
  'insertInvoice',
  'insertQuotation',
  'getQuotations',
  'updateQuotation',
  'convertQuotation',
  'updateInvoice',
  'getInvoices',
  'getInvoice',
  'returnSaleInvoice',
  'returnPurchaseInvoice',
  'getSaleInvoiceEditDateBounds',
  'updateInvoiceBiltyAndCartons',
  'exportInvoices',
  'doesInvoiceExists',
  'getAdjacentInvoiceId',
  'getLastInvoiceNumber',
  'getInvoiceIdsFromMinId',
  'getInvoicePdfOutputBaseName',
  'getAutoDiscount',
  'saveInventory',
  'getInventory',
  'doesInventoryExist',
  'insertInventoryItem',
  'updateInventoryItem',
  'bulkUpdateInventoryUrduFields',
  'setInventoryParentId',
  'bulkUpdateInventoryPricesAndListPositions',
  'applyInventoryListPositions',
  'getOpeningStock',
  'setOpeningStock',
  'applyStockAdjustment',
  'getStockAdjustments',
  'getInventoryIdsWithHistory',
  'getAttributeDefinitions',
  'upsertAttributeDefinition',
  'deleteAttributeDefinition',
  'reorderAttributeDefinitions',
  'setItemExcludedFromCatalog',
  'setAttributeDefinitionPublic',
  'setAttributeDefinitionActive',
  'updateInventoryAttributes',
  'getItemTypes',
  'insertItemType',
  'updateItemTypeName',
  'toggleItemTypeActive',
  'deleteItemType',
  'getPrimaryItemType',
  'setPrimaryItemType',
  'clearPrimaryItemType',
  'getDiscountProfiles',
  'insertDiscountProfile',
  'updateDiscountProfileName',
  'toggleDiscountProfileActive',
  'deleteDiscountProfile',
  'deleteDiscountProfileFromAccount',
  'getDiscountProfileTypeDiscounts',
  'saveDiscountProfileTypeDiscounts',
  'saveBalanceSheet',
  'reportGetLedgerRange',
  'reportGetInventoryHealth',
  'reportGetStockAsOf',
  'reportGetSalesPerformance',
  'reportGetPurchasesByVendor',
  'reportGetSalesByCustomer',
  'getVendorStockOnHand',
  'getTrackedVendorAccounts',
  'setVendorOpeningStock',
  'importVendorOpeningStock',
  'getNextVendorIssueNumber',
  'createVendorIssue',
  'updateVendorIssue',
  'deleteVendorIssue',
  'getVendorIssues',
  'getVendorIssue',
  'getVendorStockActivity',
  'getSetting',
  'setSetting',
  'deleteSetting',
  'getAllSettings',
  // Publish config: only the two real secrets stay in web_kv, device-local;
  // every other field (connection + business) goes through SettingsService
  // and syncs (see ../worker/publishConfig.ts). Price lists, catalog preview,
  // and the SigV4 run live in ../worker/publishService.ts.
  'getPublishConfig',
  'savePublishConfig',
  'getPriceListNames',
  'getItemPublishStatuses',
  'previewCatalog',
  'runPublish',
  'getPriceLists',
  'createPriceList',
  'renamePriceList',
  'setPriceListActive',
  'previewPriceListSeed',
  'applyPriceListSeed',
  'getLastPublishResult',
] as const satisfies readonly (keyof AppApi)[];

/**
 * AppApi members with no web implementation yet: `print:*` writes a PDF to
 * the local filesystem via Electron's print pipeline (wave B maps this UI
 * action to `window.print()` instead — see printToPdf's doc comment in
 * AppApi.ts); `backup:*` (`getOutputDir`) is folder backups. Catalog publish
 * runs in the worker (SigV4 PUT). These never reach the worker at all —
 * calling one rejects immediately on the main thread, with a message that
 * names the method, so a renderer built against the full AppApi can mount
 * and run today without crashing the moment it touches one of these, and
 * fails loudly (not silently/hangs) if it actually invokes one.
 */
const UNSUPPORTED_METHODS = [
  'printToPdf',
  'getOutputDir',
] as const satisfies readonly (keyof AppApi)[];

const worker = new Worker(new URL('../worker/db.worker.ts', import.meta.url), {
  type: 'module',
});

let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: unknown) => void }
>();

let resolveReady: () => void;
let rejectReady: (error: Error) => void;
/** Resolves once the worker has bootstrapped the database and is ready for calls. */
export const ready: Promise<void> = new Promise((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

/**
 * Subscribers to the worker's one-way `sync-applied` notification (see
 * rpc.ts's `WorkerMessage` doc comment) — `onSyncApplied` below is the only
 * way to register one. `electronShim.ts` is the sole subscriber today,
 * turning each notification into the `easyaccounting:sync-applied` DOM
 * event shared renderer code listens for; kept as a generic pub/sub here
 * (rather than a single fixed callback) so this transport-layer file stays
 * free of DOM/window concerns, which belong in electronShim.ts.
 */
const syncAppliedListeners = new Set<() => void>();

/** Registers `listener` to run every time the background sync loop applies pulled remote rows. Returns an unsubscribe function. */
export function onSyncApplied(listener: () => void): () => void {
  syncAppliedListeners.add(listener);
  return () => syncAppliedListeners.delete(listener);
}

/**
 * Subscribers to the worker's one-way `publish-progress` notification (see
 * rpc.ts). electronShim is the sole subscriber, turning each event into
 * `ipcRenderer.on('publish-progress')` so shared Settings code is unchanged.
 */
const publishProgressListeners = new Set<
  (event: {
    status: 'generating' | 'uploading' | 'notifying' | 'success' | 'error';
    message: string;
  }) => void
>();

export function onPublishProgress(
  listener: (event: {
    status: 'generating' | 'uploading' | 'notifying' | 'success' | 'error';
    message: string;
  }) => void,
): () => void {
  publishProgressListeners.add(listener);
  return () => publishProgressListeners.delete(listener);
}

worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  if (msg.type === 'ready') {
    resolveReady();
    return;
  }
  if (msg.type === 'init-error') {
    rejectReady(new Error(msg.error));
    return;
  }
  if (msg.type === 'sync-applied') {
    syncAppliedListeners.forEach((listener) => listener());
    return;
  }
  if (msg.type === 'publish-progress') {
    publishProgressListeners.forEach((listener) => listener(msg.event));
    return;
  }
  const entry = pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);
  if (msg.ok) {
    entry.resolve(msg.result);
  } else {
    entry.reject(new Error(msg.error));
  }
};

worker.onerror = (event: ErrorEvent) => {
  rejectReady(new Error(event.message));
};

function call(
  method: string,
  args: unknown[],
  transfer?: Transferable[],
): Promise<unknown> {
  const id = nextId;
  nextId += 1;
  return ready.then(
    () =>
      new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const message: RpcCall = { type: 'call', id, method, args };
        if (transfer && transfer.length > 0) {
          worker.postMessage(message, transfer);
        } else {
          worker.postMessage(message);
        }
      }),
  );
}

/**
 * The "bring your database" importer's RPC call — outside `AppApi` (see
 * db.worker.ts's `import:database` handler doc comment for why) and so not
 * part of `METHODS`/`buildApi` above. Exported directly for
 * electronShim.ts's `importDatabase` wrapper, the only caller.
 *
 * `bytes` is transferred (not cloned) to the worker — the second argument
 * to `postMessage` — since an uploaded database can be tens of megabytes
 * and this worker/main-thread boundary is the only place those bytes need
 * to exist twice at all. Transferring detaches `bytes` on the caller's
 * side, so a caller that needs to call this twice (the validate-then-
 * confirm flow — see the Import view) must re-derive a fresh ArrayBuffer
 * each time (e.g. a fresh `file.arrayBuffer()`), not reuse the same one.
 */
export function importDatabase(
  bytes: ArrayBuffer,
  confirm: boolean,
): Promise<ImportOutcome> {
  return call(
    'import:database',
    [bytes, confirm],
    [bytes],
  ) as Promise<ImportOutcome>;
}

/**
 * "Export my data"'s RPC call — the inverse of `importDatabase` above, and
 * likewise outside `AppApi` (see db.worker.ts's `export:database` handler
 * doc comment for why) and so not part of `METHODS`/`buildApi`. Exported
 * directly for electronShim.ts's `exportDatabase` wrapper, the only caller.
 *
 * No arguments, no outgoing transfer list needed. The worker transfers
 * (rather than clones) the returned ArrayBuffer back to this thread — see
 * db.worker.ts's `onmessage` handler — so this call is cheap even for a
 * large database.
 */
export function exportDatabase(): Promise<ArrayBuffer> {
  return call('export:database', []) as Promise<ArrayBuffer>;
}

/**
 * BYOK sync's seven RPC calls (see db.worker.ts's `sync:*` handlers and
 * ./worker/syncManager.ts's `SyncManager`, the only real implementation).
 * Like `importDatabase`/`exportDatabase` above, these live outside `AppApi`
 * (no desktop counterpart this increment) and are exported directly for
 * electronShim.ts's `supportsSync`-gated wrappers, their only callers.
 */
export function syncGetStatus(): Promise<SyncStatusPayload> {
  return call('sync:getStatus', []) as Promise<SyncStatusPayload>;
}

export function syncConnect(config: {
  url: string;
  anonKey: string;
  mock?: boolean;
  /** Proceed past a `duplicate_seed_risk` result — see SyncManager.connect's doc comment. */
  force?: boolean;
}): Promise<SyncConnectResult> {
  return call('sync:connect', [config]) as Promise<SyncConnectResult>;
}

export function syncDisconnect(): Promise<SyncStatusPayload> {
  return call('sync:disconnect', []) as Promise<SyncStatusPayload>;
}

export function syncNow(): Promise<SyncStatusPayload> {
  return call('sync:syncNow', []) as Promise<SyncStatusPayload>;
}

/**
 * "Join existing sync" — the second-device flow (see
 * ./worker/syncManager.ts's `SyncManager.join` and
 * src/renderer/views/JoinSync, the only caller). Resolves only once the
 * initial full pull has completed — this call is expected to take longer
 * than `syncConnect` for a project with real history in it.
 */
export function syncJoin(config: {
  url: string;
  anonKey: string;
  mock?: boolean;
}): Promise<SyncJoinResult> {
  return call('sync:join', [config]) as Promise<SyncJoinResult>;
}

/**
 * "Re-download everything from sync" — the device-repair action (see
 * ./worker/syncManager.ts's `SyncManager.rebuild` and
 * @core/sync/SyncEngine's `rebuildFromServer` for the full incident and
 * mechanism). Requires an already-connected transport, unlike `syncConnect`/
 * `syncJoin` — see src/renderer/views/Settings/SyncSettings.tsx, the only
 * caller, which offers this only from the connected card's "Advanced" row.
 */
export function syncRebuild(): Promise<SyncRebuildResult> {
  return call('sync:rebuild', []) as Promise<SyncRebuildResult>;
}

export type SyncJoinInvite = { url: string; anonKey: string };

/**
 * Project URL + anon key of the currently-connected sync project, for the
 * Settings "Add a device" QR / copy-link. Null when disconnected or when
 * connected via the e2e-only mock transport (see SyncManager.getJoinInvite).
 */
export function syncGetJoinInvite(): Promise<SyncJoinInvite | null> {
  return call('sync:getJoinInvite', []) as Promise<SyncJoinInvite | null>;
}

function buildApi(): AppApi {
  const api = {} as Record<string, unknown>;
  METHODS.forEach((method) => {
    api[method] = (...args: unknown[]) => call(method, args);
  });
  UNSUPPORTED_METHODS.forEach((method) => {
    api[method] = () =>
      Promise.reject(
        new Error(
          `'${method}' is not available in the web build yet (Electron-only feature).`,
        ),
      );
  });
  return api as unknown as AppApi;
}

/**
 * RPC-backed implementation of the full AppApi contract (src/core/api/AppApi.ts).
 * Every member backed by a real handler in the db worker (METHODS above)
 * rejects/resolves per that handler's result; the Electron-only remainder
 * (UNSUPPORTED_METHODS) rejects locally with a clear message and never
 * touches the worker.
 */
export const api: AppApi = buildApi();
