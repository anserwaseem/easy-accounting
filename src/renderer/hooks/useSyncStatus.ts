import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The shape `window.electron.syncGetStatus` resolves to — derived via
 * `ReturnType`/`Awaited`/`NonNullable` from the ambient `window.electron`
 * typing itself (see electronShim.ts's `ElectronEventBridge` on the web
 * build, src/renderer/preload.d.ts's duplicate of the same shape on
 * desktop) rather than imported from either. Both declare the identical
 * shape under their own TS program, so this alias resolves correctly and
 * stays in sync automatically under whichever program compiles this file —
 * no cross-package import needed (apps/web and the root Electron build are
 * separate TS programs; see preload.d.ts's doc comment on why importing
 * across that boundary doesn't work).
 */
export type SyncStatus = NonNullable<
  Awaited<ReturnType<NonNullable<(typeof window)['electron']['syncGetStatus']>>>
>;

const POLL_INTERVAL_MS = 5_000;
/** If the worker never answers, drop the guard so later ticks can try again. */
const STATUS_RPC_TIMEOUT_MS = 15_000;

/**
 * Polls `window.electron.syncGetStatus` (web-only — see electronShim.ts's
 * `supportsSync` capability flag) on an interval, and refreshes immediately
 * whenever the background sync loop applies pulled remote rows (the
 * `easyaccounting:sync-applied` window event — see rpc.ts's `sync-applied`
 * `WorkerMessage` doc comment for the full chain). Returns `null` on
 * desktop (`supportsSync` absent, so nothing here ever calls the worker)
 * and before the very first read resolves.
 *
 * Deliberately just polling rather than a push-based status stream: the
 * worker already pushes the one event that actually matters immediately
 * (rows applied), and everything else `SyncStatusPayload` carries — pending
 * count, last error, `syncing` — changes slowly enough (seconds, driven by
 * the loop's own 30s/backoff cadence) that a 5s poll is indistinguishable
 * from "live" to a human looking at a status pill, for a fraction of the
 * plumbing a dedicated push channel would need.
 */
export function useSyncStatus(): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const supported = !!window.electron.supportsSync;
  // Guards against overlapping `syncGetStatus` calls if a refresh is still
  // in flight when the next poll tick (or the sync-applied event) fires.
  const inFlight = useRef(false);

  const refresh = useCallback(() => {
    const getStatus = window.electron.syncGetStatus;
    if (!supported || !getStatus || inFlight.current) {
      return;
    }
    inFlight.current = true;
    const timer = window.setTimeout(() => {
      inFlight.current = false;
    }, STATUS_RPC_TIMEOUT_MS);
    getStatus()
      .then((next) => {
        window.clearTimeout(timer);
        inFlight.current = false;
        setStatus(next as SyncStatus);
        return next;
      })
      .catch(() => {
        // Transient worker hiccup — leave the last known status displayed
        // rather than flashing to null; the next poll tick tries again.
        window.clearTimeout(timer);
        inFlight.current = false;
      });
  }, [supported]);

  useEffect(() => {
    if (!supported) return undefined;
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    window.addEventListener('easyaccounting:sync-applied', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('easyaccounting:sync-applied', refresh);
    };
  }, [supported, refresh]);

  return status;
}
