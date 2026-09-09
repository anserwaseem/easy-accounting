import { ElectronHandler } from 'main/preload';

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    /**
     * Optional web-only flags. Desktop preload never sets these, so they
     * are always undefined in Electron. The PWA shim sets
     * `supportsDbImport` so shared renderer code can hide catalog-publish
     * controls that have no web implementation yet.
     */
    electron: ElectronHandler & {
      supportsDbImport?: true;
      supportsDbExport?: true;
      supportsSync?: true;
    };
  }
}

export {};
