import { useCallback, useEffect, useState } from 'react';
import { DatabaseBackup, Loader2 } from 'lucide-react';
import type { FC } from 'react';
import type { BackupLastInfo } from 'main/services/Backup.service';
import type {
  BackupOperationProgressEvent,
  BackupOperationStatusEvent,
} from '@/types';
import { Button } from 'renderer/shad/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'renderer/shad/ui/popover';
import { cn } from 'renderer/lib/utils';

// slow lazy poll — staleness moves in hours, not seconds
const POLL_INTERVAL_MS = 10 * 60 * 1000;
// re-render tick so the relative label ("2h ago") does not go stale on screen
const CLOCK_TICK_MS = 60 * 1000;
const AMBER_AFTER_MS = 24 * 60 * 60 * 1000;
const RED_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type BackupStalenessLevel = 'ok' | 'stale' | 'critical';

/**
 * Compact relative time for the always-visible indicator.
 * @example formatRelativeTimeCompact(twoHoursAgoIso, Date.now()); // '2h ago'
 */
export const formatRelativeTimeCompact = (
  isoTimestamp: string,
  now: number,
): string => {
  const then = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(then)) return 'unknown';

  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
};

/**
 * Staleness policy: green under 24h, amber under 7d, red beyond that or when
 * there is no backup at all or the last attempt failed.
 */
export const getBackupStalenessLevel = (
  lastBackupAt: string | null,
  attemptFailed: boolean,
  now: number,
): BackupStalenessLevel => {
  if (attemptFailed || !lastBackupAt) return 'critical';

  const age = now - new Date(lastBackupAt).getTime();
  if (!Number.isFinite(age) || age >= RED_AFTER_MS) return 'critical';
  if (age >= AMBER_AFTER_MS) return 'stale';
  return 'ok';
};

const LEVEL_CLASSES: Record<
  BackupStalenessLevel,
  { dot: string; text: string }
> = {
  ok: { dot: 'bg-emerald-500', text: 'text-muted-foreground' },
  stale: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-500' },
  critical: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-500' },
};

interface BackupStatusProps {
  collapsed: boolean;
}

const BackupStatus: FC<BackupStatusProps> = ({
  collapsed,
}: BackupStatusProps) => {
  const [info, setInfo] = useState<BackupLastInfo | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // read-only metadata fetch; a failed fetch must never crash or toast — the
  // indicator just keeps whatever it last knew
  const refresh = useCallback(async () => {
    try {
      const lastInfo = await window.electron.getLastBackupInfo();
      setInfo(lastInfo);
      setNow(Date.now());
    } catch {
      // ignore — cloud/env problems already degrade inside the main process
    }
  }, []);

  // fetch on mount, then poll lazily; tick a clock so the label stays fresh
  useEffect(() => {
    refresh();
    const pollId = setInterval(refresh, POLL_INTERVAL_MS);
    const clockId = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => {
      clearInterval(pollId);
      clearInterval(clockId);
    };
  }, [refresh]);

  // reuse the existing broadcast channels so menu-triggered backups (and their
  // failures) update the indicator without an extra IPC
  useEffect(() => {
    const unsubscribeProgress = window.electron.ipcRenderer.on(
      'backup-operation-progress',
      (...args: unknown[]) => {
        const event = args[0] as BackupOperationProgressEvent;
        if (event.type !== 'upload') return;
        if (event.status === 'completed') {
          setAttemptError(null);
          refresh();
        } else if (event.status === 'failed') {
          setAttemptError(event.message);
        }
      },
    );

    const unsubscribeStatus = window.electron.ipcRenderer.on(
      'backup-operation-status',
      (...args: unknown[]) => {
        const event = args[0] as BackupOperationStatusEvent;
        if (event.type !== 'backup') return;
        if (event.status === 'success') {
          setAttemptError(null);
          refresh();
        } else if (event.status === 'error') {
          setAttemptError(event.message);
        }
      },
    );

    return () => {
      unsubscribeProgress();
      unsubscribeStatus();
    };
  }, [refresh]);

  const handleBackupNow = useCallback(async () => {
    setBackingUp(true);
    try {
      const result = await window.electron.createBackup();
      if (result.success) {
        setAttemptError(null);
        await refresh();
      } else {
        setAttemptError(result.error ?? 'Backup failed');
      }
    } catch (error) {
      setAttemptError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackingUp(false);
    }
  }, [refresh]);

  const lastBackupAt = info?.lastBackupAt ?? null;
  const level = getBackupStalenessLevel(lastBackupAt, !!attemptError, now);
  const { dot, text } = LEVEL_CLASSES[level];

  let label: string;
  if (backingUp) label = 'Backing up…';
  else if (attemptError) label = 'Backup failed';
  else if (!lastBackupAt) label = 'No backup yet';
  else label = `Backed up ${formatRelativeTimeCompact(lastBackupAt, now)}`;

  const statusDot = backingUp ? (
    <Loader2 size={12} className="animate-spin shrink-0" aria-hidden />
  ) : (
    <span
      className={cn('h-2 w-2 rounded-full shrink-0', dot)}
      data-testid="backup-status-dot"
      aria-hidden
    />
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          aria-label={`Backup status: ${label}`}
          className={cn(
            'gap-2 text-xs font-normal',
            text,
            collapsed
              ? 'justify-center px-0 w-10 h-8'
              : 'w-full justify-start px-3 h-8',
          )}
        >
          {statusDot}
          {!collapsed && <span className="truncate">{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent side={collapsed ? 'right' : 'top'} className="w-64 p-3">
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">Database backup</p>
          <p className={cn('text-xs', text)}>{label}</p>
          {lastBackupAt && (
            <p className="text-xs text-muted-foreground">
              {`Last backup: ${new Date(lastBackupAt).toLocaleString()}`}
              {info?.type ? ` (${info.type})` : ''}
            </p>
          )}
          {info?.lastError && (
            <p className="text-xs text-muted-foreground">
              Cloud unreachable — showing local backups only.
            </p>
          )}
          {attemptError && (
            <p className="text-xs text-red-600 dark:text-red-500 break-words">
              {attemptError}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            type="button"
            onClick={handleBackupNow}
            disabled={backingUp}
          >
            {backingUp ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <DatabaseBackup size={14} aria-hidden />
            )}
            {backingUp ? 'Backing up…' : 'Back Up Now'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default BackupStatus;
