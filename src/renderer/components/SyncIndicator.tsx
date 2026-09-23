import type { FC } from 'react';
import { useSyncStatus } from '../hooks';

function formatTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface SyncIndicatorProps {
  className?: string;
}

/**
 * Subtle, non-blocking "synced · N pending · HH:MM" pill — the BYOK sync
 * status at a glance from anywhere in the app. Renders nothing at all
 * unless sync is both supported (`window.electron.supportsSync` — web
 * build only, see electronShim.ts) AND currently connected: a device that
 * has never connected, or that just disconnected, shows no sync UI outside
 * Settings, exactly like the feature doesn't exist for it.
 *
 * A failed background sync attempt does not escalate to a toast or block
 * anything here — it dims the status dot to an amber warning color with the
 * error message in a `title` tooltip, since the loop itself is already
 * retrying with backoff (see syncManager.ts) and a small, persistent shell
 * indicator is the wrong place to demand attention for a condition that
 * may well resolve itself on the very next retry.
 *
 * Mounted from Sidebar.tsx: in the desktop-width sidebar footer, and in the
 * mobile top bar — never both at once for the same viewport, since a
 * mobile viewport only ever renders one of the two at a time (see
 * Sidebar.tsx's own responsive layout).
 */
const SyncIndicator: FC<SyncIndicatorProps> = ({
  className,
}: SyncIndicatorProps) => {
  const status = useSyncStatus();
  if (!window.electron.supportsSync || !status?.connected) return null;

  const time = formatTime(status.lastSyncAt);
  const syncingStale =
    status.syncing &&
    !!status.lastSyncAt &&
    Date.now() - new Date(status.lastSyncAt).getTime() > 45_000;
  const label =
    status.syncing && !syncingStale
      ? 'syncing…'
      : [
          'synced',
          status.pendingOutboxCount > 0
            ? `${status.pendingOutboxCount} pending`
            : null,
          time,
        ]
          .filter((part): part is string => !!part)
          .join(' · ');

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap ${
        className ?? ''
      }`}
      title={
        status.lastError
          ? `Last sync attempt failed: ${status.lastError.message}`
          : 'Synced with your Supabase project'
      }
      data-testid="sync-indicator"
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          status.lastError ? 'bg-amber-500' : 'bg-emerald-500'
        }`}
        aria-hidden
      />
      {label}
    </span>
  );
};

export default SyncIndicator;
