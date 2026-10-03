import { useCallback, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from 'renderer/shad/ui/alert';
import { Button } from 'renderer/shad/ui/button';
import { Input } from 'renderer/shad/ui/input';
import { Label } from 'renderer/shad/ui/label';
import { toast } from 'renderer/shad/ui/use-toast';
import { useAuth, useSyncStatus, type SyncStatus } from '@/renderer/hooks';
import { ConfirmDialog } from '@/renderer/components/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from 'renderer/shad/ui/dialog';
import {
  buildJoinLink,
  isLoopbackOrigin,
  parsePublicOrigin,
  resolveJoinOrigin,
} from 'renderer/lib/joinLink';

/** Device-local: last https origin a phone should open for Add-a-device. */
const PUBLIC_ORIGIN_STORE_KEY = 'sync.publicOrigin';

/** A hung Safari fetch used to leave `syncing` true forever. After this long, prefer the last successful time. */
const STALE_SYNCING_MS = 45_000;

function isStaleSyncing(status: SyncStatus): boolean {
  if (!status.syncing || !status.lastSyncAt) return false;
  return Date.now() - new Date(status.lastSyncAt).getTime() > STALE_SYNCING_MS;
}

/** "Syncing…" while a cycle is in flight, else the last-sync time (or "Not synced yet" before the first one ever completes). Split out of the JSX below only to keep that ternary from nesting. */
function syncStatusLine(status: SyncStatus | null): string {
  if (status?.syncing && !isStaleSyncing(status)) {
    return status.lastSyncAt
      ? `Syncing… · last ${new Date(status.lastSyncAt).toLocaleString()}`
      : 'Syncing…';
  }
  if (status?.lastSyncAt)
    return `Last synced ${new Date(status.lastSyncAt).toLocaleString()}`;
  return 'Not synced yet';
}

/**
 * BYOK ("bring your own key/backend") multi-device sync settings — connect
 * wizard + live status + controls. Web-only this increment: rendered by
 * Settings/index.tsx only behind `window.electron.supportsSync` (see
 * electronShim.ts's `ElectronEventBridge` doc comment); on desktop the flag
 * is `undefined` and this component is never mounted at all.
 *
 * Connect flow: paste a Supabase project's URL and its "anon"/"public" API
 * key (Project Settings → API in the Supabase dashboard), then Connect.
 * `window.electron.syncConnect` (apps/web/src/worker/syncManager.ts,
 * reached via db.worker.ts's `sync:connect` RPC) validates both by probing
 * the project before ever persisting anything, and returns a typed error
 * with exact guidance — including where to find and how to apply
 * `supabase/setup.sql` — when the probe fails; that guidance is rendered
 * verbatim below the form rather than a generic "connection failed".
 *
 * Once connected, this same card switches to a live status view (host,
 * last sync time, pending outbox count, last error if any) plus "Sync now"
 * and "Disconnect" — the same status a small persistent pill in the app
 * shell also shows (src/renderer/components/SyncIndicator.tsx), both
 * driven by the same `useSyncStatus` poll. An "Advanced" row below that
 * offers "Re-download everything from sync" — a device REPAIR action
 * (`window.electron.syncRebuild`, `SyncEngine.rebuildFromServer`'s doc
 * comment) for a device whose local data is already broken in a way no
 * ordinary sync can heal — gated behind a confirm dialog since it discards
 * anything local that never made it to the server, and signs this device
 * out to Login on success (the just-rebuilt `users` table may no longer
 * contain whoever was signed in).
 */
const SyncSettings: React.FC = () => {
  const status = useSyncStatus();
  const { logout } = useAuth();

  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<{
    message: string;
    guidance: string;
  } | null>(null);
  // Set only when `syncConnect` comes back with `error.kind ===
  // 'duplicate_seed_risk'` — a distinct render (amber "needs a decision"
  // card, not the red "could not connect" one) from `connectError` above.
  // See SyncManager.connect's doc comment for the guard this surfaces.
  const [duplicateSeedWarning, setDuplicateSeedWarning] = useState<{
    message: string;
    guidance: string;
  } | null>(null);

  const [syncingNow, setSyncingNow] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [rebuildConfirmOpen, setRebuildConfirmOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [joinLink, setJoinLink] = useState('');
  const [joinQr, setJoinQr] = useState('');
  const [addDeviceLoading, setAddDeviceLoading] = useState(false);
  const [publicOriginDraft, setPublicOriginDraft] = useState('');
  const [joinOnLoopback, setJoinOnLoopback] = useState(false);

  const handleConnect = useCallback(
    async (force = false) => {
      if (!window.electron.syncConnect) return;
      setConnecting(true);
      setConnectError(null);
      if (!force) setDuplicateSeedWarning(null);
      try {
        const result = await window.electron.syncConnect({
          url: url.trim(),
          anonKey: anonKey.trim(),
          force,
        });
        if (!result.ok) {
          const error = result.error ?? {
            kind: 'unknown' as const,
            message: 'Connection failed for an unknown reason.',
            guidance:
              'Double-check the Project URL and anon key, then try again.',
          };
          if (error.kind === 'duplicate_seed_risk') {
            setDuplicateSeedWarning(error);
          } else {
            setConnectError(error);
          }
          return;
        }
        setUrl('');
        setAnonKey('');
        setDuplicateSeedWarning(null);
        toast({
          description:
            'Connected — this device will keep syncing in the background.',
          variant: 'success',
        });
      } catch (error) {
        setConnectError({
          message: error instanceof Error ? error.message : String(error),
          guidance: '',
        });
      } finally {
        setConnecting(false);
      }
    },
    [url, anonKey],
  );

  const handleConnectAnyway = useCallback(async () => {
    await handleConnect(true);
  }, [handleConnect]);

  const handleCancelDuplicateSeedWarning = useCallback(() => {
    setDuplicateSeedWarning(null);
  }, []);

  const handleSyncNow = useCallback(async () => {
    if (!window.electron.syncNow) return;
    setSyncingNow(true);
    try {
      const next = await window.electron.syncNow();
      if (next.lastError) {
        toast({
          title: 'Sync attempt failed',
          description: `${next.lastError.message} ${next.lastError.guidance}`,
          variant: 'destructive',
        });
      } else {
        toast({ description: 'Sync complete.', variant: 'success' });
      }
    } catch (error) {
      toast({
        title: 'Sync now failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setSyncingNow(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!window.electron.syncDisconnect) return;
    setDisconnecting(true);
    try {
      await window.electron.syncDisconnect();
      toast({
        description:
          'Disconnected. This device stops syncing until you reconnect.',
      });
    } catch (error) {
      toast({
        title: 'Disconnect failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setDisconnecting(false);
    }
  }, []);

  /**
   * "Re-download everything from sync" — a device repair action for a
   * device whose local database is already broken (rows quarantined into
   * `sync_apply_conflicts` with the cursor advanced past them — see
   * `SyncEngine.rebuildFromServer`'s doc comment for the full incident).
   * Confirmed via the dialog below, then: wipe this device's local
   * replicated state and re-apply the server's entire log from scratch
   * (`window.electron.syncRebuild`), then sign out to Login — the just-
   * rebuilt `users` table may no longer contain whoever was previously
   * signed in on this browser (its worker-side session is already cleared
   * by the RPC handler itself; `logout()` here clears the OTHER,
   * main-thread half and updates `AuthContext` so `AuthCheck` actually
   * redirects, exactly like every other sign-out in this app).
   */
  const handleRebuild = useCallback(async () => {
    if (!window.electron.syncRebuild) return;
    setRebuilding(true);
    try {
      const result = await window.electron.syncRebuild();
      if (!result.ok) {
        const error = result.error ?? {
          kind: 'unknown' as const,
          message: 'Re-download failed for an unknown reason.',
          guidance: 'Try again in a moment.',
        };
        toast({
          title: 'Could not re-download from sync',
          description: `${error.message} ${error.guidance}`,
          variant: 'destructive',
        });
        return;
      }
      const applied = result.applied ?? 0;
      toast({
        description: `Re-downloaded ${applied} row${
          applied === 1 ? '' : 's'
        } from the server. Sign in again to continue.`,
        variant: 'success',
      });
      await logout();
    } catch (error) {
      toast({
        title: 'Could not re-download from sync',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setRebuilding(false);
    }
  }, [logout]);

  /**
   * "Add a device" — encode this project's URL + anon key into a `#join=`
   * fragment. The origin in that link is what a phone will open, so a
   * localhost PWA must not encode `http://127.0.0.1` — a camera cannot
   * reach it. Non-loopback origins (the Cloudflare host) are used as-is
   * and remembered; on loopback we reuse a stored origin the user typed,
   * and ask for one if none is saved.
   */
  const handleAddDevice = useCallback(async () => {
    if (!window.electron.syncGetJoinInvite) return;
    setAddDeviceLoading(true);
    try {
      const invite = await window.electron.syncGetJoinInvite();
      if (!invite) {
        toast({
          title: 'Could not build an invite',
          description:
            'This device is not connected to a real sync project yet (or is using the local mock). Connect first, then try again.',
          variant: 'destructive',
        });
        return;
      }
      const here = window.location.origin;
      const stored = window.electron.store.get(PUBLIC_ORIGIN_STORE_KEY) as
        | string
        | undefined;
      const origin = resolveJoinOrigin(here, stored);
      if (origin && !isLoopbackOrigin(here)) {
        window.electron.store.set(PUBLIC_ORIGIN_STORE_KEY, origin);
      }
      setJoinOnLoopback(isLoopbackOrigin(here));
      setPublicOriginDraft(origin ?? stored ?? '');
      if (origin) {
        const link = buildJoinLink(origin, invite);
        setJoinLink(link);
        const qr = window.electron.renderJoinQr
          ? await window.electron.renderJoinQr(link)
          : '';
        setJoinQr(qr);
      } else {
        setJoinLink('');
        setJoinQr('');
      }
      setAddDeviceOpen(true);
    } catch (error) {
      toast({
        title: 'Could not build an invite',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setAddDeviceLoading(false);
    }
  }, []);

  const handleApplyPublicOrigin = useCallback(async () => {
    if (!window.electron.syncGetJoinInvite) return;
    const origin = parsePublicOrigin(publicOriginDraft);
    if (!origin) {
      toast({
        title: 'Need an https URL a phone can open',
        description:
          'localhost and http:// are not reachable from the camera. Use the hosted app URL.',
        variant: 'destructive',
      });
      return;
    }
    const invite = await window.electron.syncGetJoinInvite();
    if (!invite) return;
    window.electron.store.set(PUBLIC_ORIGIN_STORE_KEY, origin);
    const link = buildJoinLink(origin, invite);
    setJoinLink(link);
    setPublicOriginDraft(origin);
    const qr = window.electron.renderJoinQr
      ? await window.electron.renderJoinQr(link)
      : '';
    setJoinQr(qr);
  }, [publicOriginDraft]);

  const handleCopyJoinLink = useCallback(async () => {
    if (!joinLink) return;
    try {
      await navigator.clipboard.writeText(joinLink);
      toast({ description: 'Invite link copied.', variant: 'success' });
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Select the link and copy it manually.',
        variant: 'destructive',
      });
    }
  }, [joinLink]);

  const connected = status?.connected ?? false;

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <p className="text-sm text-muted-foreground">
        Bring your own Supabase project to sync this business&apos;s data across
        every device connected to it — every device sharing the same Project URL
        and anon key stays up to date automatically, in the background.
      </p>

      {connected ? (
        <div
          className="flex flex-col gap-3 rounded-md border p-4"
          data-testid="sync-connected-card"
        >
          <div className="text-sm">
            <p>
              <span className="font-medium">Connected</span> to{' '}
              <code className="text-xs">{status?.projectHost}</code>
            </p>
            {status?.projectUrl ? (
              <p className="text-muted-foreground break-all">
                Project URL:{' '}
                <code className="text-xs">{status.projectUrl}</code>
              </p>
            ) : null}
            <p className="text-muted-foreground">
              {syncStatusLine(status)}
              {' · '}
              {status?.pendingOutboxCount ?? 0} pending change
              {status?.pendingOutboxCount === 1 ? '' : 's'}
            </p>
          </div>

          {status?.lastError && (
            <Alert variant="destructive">
              <AlertTitle>Last sync attempt failed</AlertTitle>
              <AlertDescription>
                {status.lastError.message} {status.lastError.guidance}
              </AlertDescription>
            </Alert>
          )}

          {!!status?.conflictCount && status.conflictCount > 0 && (
            <Alert variant="warning">
              <AlertTitle>Some rows need review</AlertTitle>
              <AlertDescription>
                {status.conflictCount} row
                {status.conflictCount === 1 ? '' : 's'} could not be applied.
                This is usually a second copy of the same business in the sync
                log (two imports). This device kept the first copy. Tap Sync now
                after updating the app — leftover review rows are cleared
                automatically.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleSyncNow}
              disabled={syncingNow}
            >
              {syncingNow ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button
              variant="outline"
              onClick={handleAddDevice}
              disabled={addDeviceLoading}
            >
              {addDeviceLoading ? 'Preparing…' : 'Add a device'}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>

          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              Advanced
            </p>
            <Button
              variant="outline"
              className="self-start"
              onClick={() => setRebuildConfirmOpen(true)}
              disabled={rebuilding}
            >
              {rebuilding
                ? 'Re-downloading…'
                : 'Re-download everything from sync'}
            </Button>
            <span className="text-xs text-muted-foreground">
              If this device&apos;s data looks broken or a row was skipped
              during sync, this replaces it with a fresh copy from the server.
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="syncProjectUrl">Project URL</Label>
            <Input
              id="syncProjectUrl"
              placeholder="https://xxxxxxxxxxxx.supabase.co"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="syncAnonKey">Anon public API key</Label>
            <Input
              id="syncAnonKey"
              type="password"
              placeholder="eyJhbGciOi..."
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="text-xs text-muted-foreground">
              From Supabase → Project Settings → API. Use the &quot;anon&quot; /
              &quot;public&quot; key — never the service_role key.
            </span>
          </div>

          {connectError && (
            <Alert variant="destructive">
              <AlertTitle>Could not connect</AlertTitle>
              <AlertDescription>
                {connectError.message} {connectError.guidance}
              </AlertDescription>
            </Alert>
          )}

          {duplicateSeedWarning && (
            <Alert variant="warning" data-testid="duplicate-seed-warning">
              <AlertTitle>This project already has data</AlertTitle>
              <AlertDescription>
                {duplicateSeedWarning.message} {duplicateSeedWarning.guidance}
              </AlertDescription>
            </Alert>
          )}

          {duplicateSeedWarning ? (
            <div className="flex gap-2 self-start">
              <Button
                variant="outline"
                onClick={handleCancelDuplicateSeedWarning}
                disabled={connecting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConnectAnyway}
                disabled={connecting}
              >
                {connecting ? 'Connecting…' : 'Connect anyway'}
              </Button>
            </div>
          ) : (
            <Button
              className="self-start"
              onClick={() => handleConnect()}
              disabled={connecting || !url.trim() || !anonKey.trim()}
            >
              {connecting ? 'Connecting…' : 'Connect'}
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={rebuildConfirmOpen}
        onOpenChange={setRebuildConfirmOpen}
        title="Re-download everything from sync?"
        description="This replaces this device's local data with the server's copy. Anything on this device that never made it to the server will be lost, and you'll need to sign in again afterward."
        confirmLabel="Re-download"
        confirmVariant="destructive"
        onConfirm={handleRebuild}
      />

      <Dialog open={addDeviceOpen} onOpenChange={setAddDeviceOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add a device</DialogTitle>
            <DialogDescription>
              {joinOnLoopback
                ? 'This device is localhost — a phone cannot open that. Paste the https URL of the hosted app phones should open, then scan the QR. Treat the link like a password: anyone with it can join this project.'
                : 'Scan this QR with a phone, or copy the link. It opens this app and prefills Join — the key stays in the link fragment, never sent to the host. Treat it like a password: anyone with it can join this project.'}
            </DialogDescription>
          </DialogHeader>
          {joinOnLoopback ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="joinPublicOrigin">URL phones should open</Label>
              <Input
                id="joinPublicOrigin"
                placeholder="https://"
                value={publicOriginDraft}
                onChange={(e) => setPublicOriginDraft(e.target.value)}
                onBlur={() => {
                  handleApplyPublicOrigin().catch(() => undefined);
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ) : null}
          {joinQr ? (
            <img
              src={joinQr}
              alt="QR code to join this sync project"
              className="mx-auto h-60 w-60 bg-white p-2"
            />
          ) : null}
          <Button
            variant="outline"
            onClick={handleCopyJoinLink}
            disabled={!joinLink}
          >
            Copy invite link
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SyncSettings;
