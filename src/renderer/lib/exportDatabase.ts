import { format } from 'date-fns';

/**
 * "Export my data": downloads the live database as a standard SQLite file,
 * openable by the desktop app or any SQLite tool. Web-only — callers must
 * check `window.electron.supportsDbExport` before calling this (see
 * apps/web/src/electronShim.ts's `ElectronEventBridge` doc comment for the
 * capability-flag pattern; desktop's `window.electron.exportDatabase` is
 * always `undefined`).
 *
 * The RPC call (`window.electron.exportDatabase()`) resolves with the raw
 * bytes of a consistent point-in-time snapshot (see
 * apps/web/src/worker/db.worker.ts's `export:database` handler doc comment
 * for why no write can land mid-export); this function's only job is
 * turning those bytes into a browser download, the same Blob + object-URL +
 * anchor-click pattern already used for Excel report exports (see
 * ./reportExport.ts's `exportReportToExcel`).
 */
export async function downloadDatabaseExport(): Promise<void> {
  if (!window.electron.exportDatabase) {
    throw new Error('Exporting your data is not available in this build.');
  }

  const bytes = await window.electron.exportDatabase();
  const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `easy-accounting-${format(new Date(), 'yyyy-MM-dd')}.db`;
  link.click();
  URL.revokeObjectURL(url);
}
