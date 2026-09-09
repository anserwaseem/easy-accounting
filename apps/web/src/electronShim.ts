import type { AppApi } from '@core/api/AppApi';
import type { ImportOutcome } from '@core/db/import';
import {
  api,
  exportDatabase as workerExportDatabase,
  importDatabase as workerImportDatabase,
  onPublishProgress,
  onSyncApplied,
  syncConnect as workerSyncConnect,
  syncDisconnect as workerSyncDisconnect,
  syncGetJoinInvite as workerSyncGetJoinInvite,
  syncGetStatus as workerSyncGetStatus,
  syncJoin as workerSyncJoin,
  syncNow as workerSyncNow,
  syncRebuild as workerSyncRebuild,
  type SyncConnectResult,
  type SyncJoinInvite,
  type SyncJoinResult,
  type SyncRebuildResult,
  type SyncStatusPayload,
} from './api/client';
import QRCode from 'qrcode';

/**
 * Mirrors src/renderer/preload.d.ts's private `Channels`/`ElectronEventBridge`
 * types. Not imported from there directly: preload.d.ts is an ambient .d.ts
 * with no exports, and pulling it into this program would double-declare the
 * global `Window.electron` augmentation. Kept structurally identical on
 * purpose so anything that type-checks against the Electron build's
 * `window.electron` also type-checks here.
 */
type Channels =
  | 'backup-operation-status'
  | 'backup-operation-progress'
  | 'publish-progress';

interface ElectronEventBridge {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]): void;
    on(channel: Channels, func: (...args: unknown[]) => void): () => void;
    once(channel: Channels, func: (...args: unknown[]) => void): void;
  };
  store: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(key: string): any;
    set(key: string, val: unknown): void;
    delete(key: string): void;
  };
  /**
   * Capability flag for the "bring your database" importer (see
   * apps/web/src/worker/db.worker.ts's `import:database` handler and
   * src/core/db/import.ts). `true` here, always, and ONLY here — desktop's
   * own preload.ts never sets it, so `window.electron.supportsDbImport` on
   * desktop is `undefined` (falsy). src/renderer/views/Import (and its
   * entry points on the Login and Settings views) all gate their visibility
   * on this one flag rather than on any platform check, which is the
   * general pattern for a web-only feature living in the *shared*
   * src/renderer tree: declare an optional capability on `window.electron`
   * (typed in both this file AND src/renderer/preload.d.ts, so shared
   * renderer code type-checks under both apps/web's and the root Electron
   * build's separate TS programs — see that file's matching comment), set
   * it `true` only in the platform whose shim actually implements the
   * feature, and read it at render time rather than importing anything
   * platform-specific into src/renderer itself. Desktop's UI and bundle are
   * completely unaffected: the flag it reads is simply never present.
   */
  supportsDbImport?: true;
  importDatabase?: (
    bytes: ArrayBuffer,
    confirm: boolean,
  ) => Promise<ImportOutcome>;

  /**
   * Capability flag for "Export my data" (see db.worker.ts's
   * `export:database` handler and src/renderer/lib/exportDatabase.ts). Same
   * pattern as `supportsDbImport` right above: `true` here, always, and
   * ONLY here — desktop's own preload.ts never sets it, so it reads
   * `undefined` (falsy) there, which is what src/renderer's Settings and
   * Import views gate their "Export my data" UI on.
   */
  supportsDbExport?: true;
  exportDatabase?: () => Promise<ArrayBuffer>;

  /**
   * Capability flag for BYOK multi-device sync (see
   * apps/web/src/worker/syncManager.ts's `SyncManager` and its four
   * `sync:*` RPC handlers in db.worker.ts). Same pattern as
   * `supportsDbImport`/`supportsDbExport` above: `true` here, always, and
   * ONLY here — desktop's own preload.ts never sets it (sync isn't wired
   * into the Electron build this increment — see SyncManager's doc
   * comment), so it reads `undefined` (falsy) there, which is what the
   * Settings screen's Sync card and the app shell's sync status pill
   * (src/renderer/components/SyncIndicator.tsx) both gate their visibility
   * on.
   */
  supportsSync?: true;
  syncGetStatus?: () => Promise<SyncStatusPayload>;
  syncConnect?: (config: {
    url: string;
    anonKey: string;
    mock?: boolean;
    /** Proceed past a `duplicate_seed_risk` result — set only after the user explicitly clicks "Connect anyway" on the warning card SyncSettings.tsx renders for it. */
    force?: boolean;
  }) => Promise<SyncConnectResult>;
  syncDisconnect?: () => Promise<SyncStatusPayload>;
  syncNow?: () => Promise<SyncStatusPayload>;
  /**
   * "Join existing sync" — the second-device flow (see
   * apps/web/src/worker/syncManager.ts's `SyncManager.join` and
   * src/renderer/views/JoinSync, its only caller). Same `supportsSync`
   * gate as the four calls above — desktop's `window.electron` never sets
   * this either.
   */
  syncJoin?: (config: {
    url: string;
    anonKey: string;
    mock?: boolean;
  }) => Promise<SyncJoinResult>;
  /**
   * "Re-download everything from sync" — a device repair action (see
   * apps/web/src/worker/syncManager.ts's `SyncManager.rebuild` and
   * src/renderer/views/Settings/SyncSettings.tsx, its only caller, which
   * offers this only from the connected card's "Advanced" row). Same
   * `supportsSync` gate as the calls above — desktop's `window.electron`
   * never sets this either. Unlike `syncConnect`/`syncJoin`, requires an
   * already-connected transport — see `SyncManager.rebuild`'s doc comment.
   */
  syncRebuild?: () => Promise<SyncRebuildResult>;
  /**
   * Project URL + anon key of the currently-connected project, for the
   * Settings "Add a device" QR / copy-link. Null when disconnected or mock.
   * Same `supportsSync` gate — desktop never sets this.
   */
  syncGetJoinInvite?: () => Promise<SyncJoinInvite | null>;
  /**
   * Renders a join URL as a PNG data-URL QR (web-only — `qrcode` lives in
   * apps/web, not the Electron bundle). Settings calls this only when
   * present, so the desktop build never has to resolve that package.
   */
  renderJoinQr?: (text: string) => Promise<string>;
}

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    electron: AppApi & ElectronEventBridge;
  }
}

/**
 * localStorage-backed key/value store standing in for Electron's
 * `electron-store` (see src/main/main.ts's `electron-store-*` IPC handlers
 * and src/main/store.ts). Renderer code calls `store.get`/`set`/`delete`
 * synchronously (it's `ipcRenderer.sendSync` on desktop), so this has to be
 * synchronous too — localStorage already is. Values are JSON-serialized,
 * same as electron-store persists them to disk.
 */
const STORAGE_PREFIX = 'easyAccounting.store.';

const store: ElectronEventBridge['store'] = {
  get(key: string): unknown {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      if (raw === null) return undefined;
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  },
  set(key: string, val: unknown): void {
    // Mirrors main.ts's `electron-store-set` handler, which silently no-ops
    // on null/undefined ("so app doesn't throw `TypeError: Use \`delete()\`
    // to clear values`") rather than persisting a null.
    if (val === null || val === undefined) return;
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(val));
    } catch {
      // Storage full/unavailable (e.g. private browsing) — the desktop
      // store has no equivalent failure mode worth surfacing here; settings
      // just won't persist for this session.
    }
  },
  delete(key: string): void {
    localStorage.removeItem(STORAGE_PREFIX + key);
  },
};

/**
 * `ipcRenderer.sendMessage`/`on`/`once` push progress/status events
 * (backup-operation-*, publish-progress) from Electron's main process.
 * Backup channels never fire here. `publish-progress` is forwarded from
 * the db worker (see onPublishProgress in ./api/client.ts) so Settings
 * streams the same events as desktop.
 */
const publishProgressHandlers = new Set<(...args: unknown[]) => void>();

onPublishProgress((event) => {
  publishProgressHandlers.forEach((handler) => handler(event));
});

const ipcRenderer: ElectronEventBridge['ipcRenderer'] = {
  sendMessage(): void {
    // No main process to send to.
  },
  on(channel, func): () => void {
    if (channel !== 'publish-progress') return () => {};
    publishProgressHandlers.add(func);
    return () => {
      publishProgressHandlers.delete(func);
    };
  },
  once(channel, func): void {
    if (channel !== 'publish-progress') return;
    const wrap = (...args: unknown[]) => {
      publishProgressHandlers.delete(wrap);
      func(...args);
    };
    publishProgressHandlers.add(wrap);
  },
};

/**
 * `printToPdf` on desktop renders the current page to a PDF file on the
 * local filesystem via Electron's main-process print pipeline (see
 * src/main/main.ts's `print:*` handler) and is used two ways in the
 * renderer:
 *  - PrintableInvoiceScreen's single-invoice "Print" button calls
 *    `window.print()` directly (browser print dialog) and never touches
 *    this method at all — nothing to shim there.
 *  - PrintableInvoiceScreen's "batch print to folder" flow calls this to
 *    save a PDF per invoice into a chosen output directory — a
 *    filesystem-writing batch job with no browser equivalent (no directory
 *    picker + repeated silent writes without a save dialog per file). It
 *    already has full success/failure handling (per-file try/catch, an
 *    outer try/catch, and a toast on failure) around this call, so
 *    rejecting here surfaces as an honest "not available" toast instead of
 *    crashing or hanging.
 */
const printToPdf: AppApi['printToPdf'] = () => {
  // Do not import src/renderer here — apps/web's tsc program is the worker
  // shell only until the renderer merge. PrintableInvoiceScreen already
  // toasts a failure from this rejection.
  console.warn(
    'Saving PDFs to a folder needs the desktop app. Use the browser print dialog (Ctrl/Cmd+P) instead.',
  );
  return Promise.reject(
    new Error(
      "'printToPdf' is not available in the web build — batch PDF export needs the desktop app.",
    ),
  );
};

/**
 * `useAuth`'s initial `authed` state (src/renderer/hooks/useAuth.tsx) reads
 * `window.electron.store.get('username')` synchronously — session
 * persistence across a reload depends entirely on that key being set, not
 * on anything the worker itself remembers. On desktop this is a side effect
 * of `login()` itself (src/main/services/Auth.service.ts calls
 * `store.set('username', ...)` from inside the same handler that verifies
 * the password) — one store, written from the one place that checks the
 * password. Here `login` is a plain RPC call to the worker (see
 * ./api/client.ts), which runs in a separate global scope with no access to
 * this main-thread `store` at all, so nothing would ever write that key —
 * `authed` would reset to false on every reload regardless of a successful
 * login. Wrapping `login`/`logout` to also write/clear it here reproduces
 * the desktop side effect at the only place on this platform that can.
 */
const login: AppApi['login'] = async (user) => {
  const result = await api.login(user);
  if (result) store.set('username', user.username);
  return result;
};

const logout: AppApi['logout'] = async () => {
  const result = await api.logout();
  store.delete('username');
  return result;
};

/**
 * `import:database`'s confirmed (`confirm: true`) call replaces the entire
 * `users` table, so any session recorded before the import may now name a
 * user who no longer exists. The worker already clears its own side of the
 * session (`currentUsername`/web_kv — see db.worker.ts's `import:database`
 * handler); this wrapper clears the OTHER half — the main-thread
 * `store`-backed mirror `login`/`logout` above maintain — for the same
 * reason `login`/`logout` need to touch both: `useAuth`'s initial `authed`
 * state reads `store` synchronously and has no way to know the worker's
 * session changed underneath it otherwise. Left alone on a `confirm: false`
 * preview call (nothing was written, nothing to invalidate) and on a
 * rejected/failed import (`ok: false` — the existing database, and
 * whoever's signed into it, is untouched).
 */
const importDatabase = async (
  bytes: ArrayBuffer,
  confirm: boolean,
): Promise<ImportOutcome> => {
  const result = await workerImportDatabase(bytes, confirm);
  if (confirm && result.ok) store.delete('username');
  return result;
};

/**
 * "Your local data may have changed underneath you" — see rpc.ts's
 * `sync-applied` `WorkerMessage` doc comment and syncManager.ts's own
 * top-level doc comment for the full chain this is the browser-event half
 * of. Turns each worker notification into a plain DOM `CustomEvent` on
 * `window`, named `easyaccounting:sync-applied`, that any shared
 * src/renderer code can subscribe to with a normal
 * `window.addEventListener` — no import of anything web-specific needed
 * from a shared view/hook to react to it. Subscribed once, at shim-install
 * time, for the lifetime of the page (installElectronShim itself runs
 * exactly once — see main.tsx).
 */
const SYNC_APPLIED_EVENT = 'easyaccounting:sync-applied';
onSyncApplied(() => {
  window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
});

/**
 * Full `window.electron` shim: the real RPC-backed AppApi client (`api`,
 * from ./api/client — every method either runs for real against the worker
 * or rejects with a clear "not available in the web build yet" message; see
 * that file's UNSUPPORTED_METHODS) plus the Electron-only event/store
 * plumbing above. `printToPdf` overrides the generic UNSUPPORTED_METHODS
 * rejection from `api` with one that also raises a toast, since it's the
 * one unsupported call a user can trigger from a visible, enabled button
 * (PrintableInvoiceScreen's batch print) rather than a feature that's
 * already hidden/disabled in the UI (backup — see getOutputDir).
 * `login`/`logout` add the session-persistence side effect described above.
 * `supportsDbImport`/`importDatabase` are the web-only capability the
 * Import view (src/renderer/views/Import) gates on — see
 * `ElectronEventBridge`'s doc comment above for the general pattern.
 * `supportsDbExport`/`exportDatabase` are the same pattern for "Export my
 * data" (src/renderer/lib/exportDatabase.ts and its Settings/Import entry
 * points) — `workerExportDatabase` needs no wrapping (no session/store side
 * effect to reproduce, unlike `login`/`logout`/`importDatabase` above), so
 * it's exposed directly. `supportsSync`/`syncGetStatus`/`syncConnect`/
 * `syncDisconnect`/`syncNow`/`syncJoin`/`syncRebuild`/`syncGetJoinInvite`
 * are the same pattern again for BYOK sync (see ElectronEventBridge's doc
 * comment above) — none of the seven need wrapping either, so `workerSync*`
 * are exposed directly under their public names. `syncRebuild` in particular does NOT need the
 * same store-clearing wrapper `importDatabase` gets just above: the worker
 * already clears its own session half on a successful rebuild (see
 * db.worker.ts's `sync:rebuild` handler), and SyncSettings.tsx's own
 * success handler calls the shared `useAuth().logout()` afterward — the
 * same real sign-out action every other "you're no longer signed in"
 * moment in this app already uses — which clears the OTHER (main-thread
 * `store`) half AND updates `AuthContext`'s `authed` state so `AuthCheck`
 * actually redirects to `/login`; a bare `store.delete('username')` here
 * would clear the key but leave `authed` stale in memory.
 */
export const installElectronShim = (): void => {
  window.electron = {
    ...api,
    login,
    logout,
    printToPdf,
    ipcRenderer,
    store,
    supportsDbImport: true,
    importDatabase,
    supportsDbExport: true,
    exportDatabase: workerExportDatabase,
    supportsSync: true,
    syncGetStatus: workerSyncGetStatus,
    syncConnect: workerSyncConnect,
    syncDisconnect: workerSyncDisconnect,
    syncNow: workerSyncNow,
    syncJoin: workerSyncJoin,
    syncRebuild: workerSyncRebuild,
    syncGetJoinInvite: workerSyncGetJoinInvite,
    renderJoinQr: (text: string) =>
      QRCode.toDataURL(text, {
        width: 240,
        margin: 1,
        errorCorrectionLevel: 'M',
      }),
  };
};
