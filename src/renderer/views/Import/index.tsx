import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ImportOutcome } from '@/core/db/import';
import { downloadDatabaseExport } from '@/renderer/lib/exportDatabase';
import { Alert, AlertDescription, AlertTitle } from 'renderer/shad/ui/alert';
import { Button } from 'renderer/shad/ui/button';
import { Input } from 'renderer/shad/ui/input';
import { Label } from 'renderer/shad/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from 'renderer/shad/ui/table';
import { toast } from 'renderer/shad/ui/use-toast';

/**
 * "Bring your database" importer — the web-only screen that lets a user
 * upload their desktop app's `database.db` file and replace this browser's
 * Easy Accounting database with its contents. Reachable from Login ("Import
 * from desktop app", for a brand-new browser install with no session yet)
 * and from Settings (for an already-signed-in install that wants to start
 * over from a desktop backup) — see routes.tsx and each of those views'
 * entry-point links, all three gated on `window.electron.supportsDbImport`
 * (see electronShim.ts's `ElectronEventBridge` doc comment for why: this
 * file itself is NOT gated — it lives in shared src/renderer and renders
 * fine on desktop too, it just has no way to reach it there since none of
 * the links appear).
 *
 * Flow, matching the two-call `import:database` RPC (db.worker.ts):
 *   1. `select` — choose a file. Read into bytes and validated immediately
 *      (`window.electron.importDatabase(bytes, false)`) — a read-only
 *      preview, nothing written yet.
 *   2. `preview` — show the row counts and any warnings the preview found,
 *      and the replace-semantics warning, behind an explicit confirmation
 *      button. Declining goes back to `select`.
 *   3. `importing` — the confirmed call
 *      (`window.electron.importDatabase(bytes, true)`) is in flight. Bytes
 *      are read fresh from the `File` a second time here: `bytes` is
 *      transferred (not cloned) to the worker on the first call and left
 *      detached afterward — see api/client.ts's `importDatabase` doc
 *      comment.
 *   4. `done` — the import summary (or a rejection, handled as `error`
 *      instead). A confirmed import also clears the local session (see
 *      electronShim.ts), so "Continue to Login" is the only way onward —
 *      whoever is signed in, if anyone, no longer necessarily exists in the
 *      just-replaced `users` table.
 */

type Step = 'select' | 'preview' | 'importing' | 'done' | 'error';

/** Mirrors src/core/db/import.ts's `SNAPSHOT_MIGRATION_VERSION` — bump together. */
const REQUIRED_MIGRATION_VERSION = 28;

const TableCountList = ({
  tables,
}: {
  tables: { name: string; rows: number }[];
}) => {
  const nonEmpty = tables.filter((t) => t.rows > 0);
  return (
    <div className="max-h-64 overflow-y-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Table</TableHead>
            <TableHead className="text-right">Rows</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nonEmpty.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={2}
                className="text-center text-muted-foreground"
              >
                No business data found in this file.
              </TableCell>
            </TableRow>
          ) : (
            nonEmpty.map((t) => (
              <TableRow key={t.name}>
                <TableCell>{t.name}</TableCell>
                <TableCell className="text-right">{t.rows}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

const ImportPage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('select');
  const [fileName, setFileName] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Extract<
    ImportOutcome,
    { ok: true }
  > | null>(null);
  const [summary, setSummary] = useState<Extract<
    ImportOutcome,
    { ok: true }
  > | null>(null);
  const [errorReason, setErrorReason] = useState<string>('');

  // Offer a "download a backup first" escape hatch on the `select` step, but
  // only when there is something in this browser actually worth backing up
  // — a fresh/empty install (nothing but the placeholder user + starter
  // chart, see db.worker.ts's `ensurePlaceholderDefaultUser`) has no
  // accounts yet, so the link would just be noise. `getAccounts` is part of
  // the full AppApi surface (unlike `exportDatabase`, always present), so
  // this check works even before `supportsDbExport` is known to be true.
  const [hasExistingData, setHasExistingData] = useState(false);
  useEffect(() => {
    if (!window.electron.supportsDbExport) return;
    window.electron
      .getAccounts()
      .then((accounts) => setHasExistingData(accounts.length > 0))
      .catch(() => setHasExistingData(false));
  }, []);

  const handleDownloadBackup = useCallback(async () => {
    try {
      await downloadDatabaseExport();
    } catch (error) {
      toast({
        title: 'Backup download failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }, []);

  const resetToSelect = useCallback(() => {
    setStep('select');
    setFile(null);
    setFileName('');
    setPreview(null);
    setErrorReason('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleFileChosen = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const chosen = event.target.files?.[0];
      if (!chosen) return;
      setFile(chosen);
      setFileName(chosen.name);
      setErrorReason('');

      if (!window.electron.importDatabase) {
        setErrorReason('Importing a database is not available in this build.');
        setStep('error');
        return;
      }

      // try/catch, not just `!result.ok`: a worker-side throw (as opposed to
      // a validation result) rejects the RPC promise, and an uncaught
      // rejection here would leave the screen stuck on this step forever —
      // seen in the field as an import frozen at "Importing…" when a capture
      // trigger aborted the import transaction. Same pattern in
      // handleConfirm below.
      try {
        const bytes = await chosen.arrayBuffer();
        const result = await window.electron.importDatabase(bytes, false);
        if (!result.ok) {
          setErrorReason(result.reason);
          setStep('error');
          return;
        }
        setPreview(result);
        setStep('preview');
      } catch (error) {
        setErrorReason(error instanceof Error ? error.message : String(error));
        setStep('error');
      }
    },
    [],
  );

  const handleConfirm = useCallback(async () => {
    if (!file || !window.electron.importDatabase) return;
    setStep('importing');
    try {
      // Fresh bytes: the ArrayBuffer used for the preview call above was
      // transferred to the worker and is now detached — see this file's doc
      // comment and api/client.ts's `importDatabase`.
      const bytes = await file.arrayBuffer();
      const result = await window.electron.importDatabase(bytes, true);
      if (!result.ok) {
        setErrorReason(result.reason);
        setStep('error');
        return;
      }
      setSummary(result);
      setStep('done');
    } catch (error) {
      // See handleFileChosen's matching catch: a rejected RPC must land on
      // the error step, never leave the UI stuck on "Importing…".
      setErrorReason(error instanceof Error ? error.message : String(error));
      setStep('error');
    }
  }, [file]);

  return (
    <div className="flex justify-center items-start min-h-screen py-16">
      <div className="w-full max-w-2xl p-6 rounded-xl shadow-md border-white border-dashed border-[1px] flex flex-col gap-4">
        <h1 className="title-new">Import from desktop app</h1>

        {step === 'select' && (
          <>
            <p className="text-sm text-muted-foreground">
              Upload your desktop app&apos;s <code>database.db</code> file to
              bring its accounts, journals, inventory and invoices into this
              browser.
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="desktopDbFile">Database file</Label>
              <Input
                id="desktopDbFile"
                ref={fileInputRef}
                type="file"
                accept=".db,.sqlite,.sqlite3"
                onChange={handleFileChosen}
              />
            </div>
            {window.electron.supportsDbExport && hasExistingData && (
              <p className="text-xs text-muted-foreground">
                This will replace what&apos;s already in this browser.{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={handleDownloadBackup}
                >
                  Download a backup first
                </button>
                .
              </p>
            )}
            <p className="text-sm">
              <Link to="/login" className="underline">
                Back to Login
              </Link>
            </p>
          </>
        )}

        {step === 'preview' && preview && (
          <>
            <Alert variant="warning">
              <AlertTitle>
                This will replace all data in this browser
              </AlertTitle>
              <AlertDescription>
                Importing <strong>{fileName}</strong> permanently replaces every
                account, chart, journal, inventory item and invoice currently in
                this browser&apos;s Easy Accounting database with the contents
                of this file. This cannot be undone.
              </AlertDescription>
            </Alert>

            {preview.sourceMigrationVersion < REQUIRED_MIGRATION_VERSION && (
              <Alert>
                <AlertTitle>Older database</AlertTitle>
                <AlertDescription>
                  This file is from an older version of the app (migration{' '}
                  {preview.sourceMigrationVersion}). Missing fields will be
                  filled in automatically.
                </AlertDescription>
              </Alert>
            )}

            {preview.warnings.map((warning) => (
              <Alert key={warning} variant="warning">
                <AlertDescription>{warning}</AlertDescription>
              </Alert>
            ))}

            <TableCountList tables={preview.tables} />

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetToSelect}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirm}>
                Replace and Import
              </Button>
            </div>
          </>
        )}

        {step === 'importing' && (
          <p className="text-sm text-muted-foreground" role="status">
            Importing&hellip; this may take a moment for a large database.
          </p>
        )}

        {step === 'done' && summary && (
          <>
            <Alert variant="default">
              <AlertTitle>Import complete</AlertTitle>
              <AlertDescription>
                Your desktop data has been imported. Sign in below as one of the
                imported users to continue.
              </AlertDescription>
            </Alert>

            {summary.warnings.map((warning) => (
              <Alert key={warning} variant="warning">
                <AlertDescription>{warning}</AlertDescription>
              </Alert>
            ))}

            <TableCountList tables={summary.tables} />

            <div className="flex justify-end">
              <Button variant="default" onClick={() => navigate('/login')}>
                Continue to Login
              </Button>
            </div>
          </>
        )}

        {step === 'error' && (
          <>
            <Alert variant="destructive">
              <AlertTitle>Import failed</AlertTitle>
              <AlertDescription>{errorReason}</AlertDescription>
            </Alert>
            <div className="flex justify-end">
              <Button variant="outline" onClick={resetToSelect}>
                Try another file
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ImportPage;
