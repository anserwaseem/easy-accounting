import { ElectronHandler } from 'main/preload';
import type { ImportOutcome } from 'core/db/import';

/**
 * Duplicated from apps/web/src/worker/syncManager.ts so this (root) TS
 * program can type the optional web methods without importing apps/web.
 */
interface SyncErrorInfo {
  kind:
    | 'unreachable'
    | 'bad_key'
    | 'setup_missing'
    | 'unknown'
    | 'duplicate_seed_risk';
  message: string;
  guidance: string;
}

interface SyncStatusPayload {
  connected: boolean;
  projectHost?: string;
  lastSyncAt?: string;
  pendingOutboxCount: number;
  lastError?: SyncErrorInfo | null;
  syncing: boolean;
  conflictCount: number;
  projectUrl?: string;
}

interface SyncConnectResult {
  ok: boolean;
  status?: SyncStatusPayload;
  error?: SyncErrorInfo;
}

interface SyncJoinResult {
  ok: boolean;
  pulled?: number;
  applied?: number;
  status?: SyncStatusPayload;
  error?: SyncErrorInfo;
}

interface SyncRebuildResult {
  ok: boolean;
  pulled?: number;
  applied?: number;
  status?: SyncStatusPayload;
  error?: SyncErrorInfo;
}

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    /**
     * Optional web-only flags and RPCs. Desktop preload never sets these,
     * so they are always undefined in Electron and the shared UI hides.
     */
    electron: ElectronHandler & {
      supportsDbImport?: true;
      importDatabase?: (
        bytes: ArrayBuffer,
        confirm: boolean,
      ) => Promise<ImportOutcome>;
      supportsDbExport?: true;
      exportDatabase?: () => Promise<ArrayBuffer>;
      supportsSync?: true;
      syncGetStatus?: () => Promise<SyncStatusPayload>;
      syncConnect?: (config: {
        url: string;
        anonKey: string;
        mock?: boolean;
        force?: boolean;
      }) => Promise<SyncConnectResult>;
      syncDisconnect?: () => Promise<SyncStatusPayload>;
      syncNow?: () => Promise<SyncStatusPayload>;
      syncJoin?: (config: {
        url: string;
        anonKey: string;
        mock?: boolean;
      }) => Promise<SyncJoinResult>;
      syncRebuild?: () => Promise<SyncRebuildResult>;
      syncGetJoinInvite?: () => Promise<{
        url: string;
        anonKey: string;
      } | null>;
      renderJoinQr?: (text: string) => Promise<string>;
    };
  }
}

export {};
