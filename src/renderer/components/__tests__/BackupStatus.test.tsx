/**
 * @jest-environment jsdom
 *
 * The indicator exists to make backup staleness visible without anyone asking,
 * which only holds if every staleness state renders distinctly, the data loads
 * lazily on mount, a completed backup refreshes it, and the click-to-backup
 * action goes through the read-only/create IPC pair.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BackupLastInfo } from 'main/services/Backup.service';
import BackupStatus, {
  formatRelativeTimeCompact,
  getBackupStalenessLevel,
} from '../BackupStatus';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

const info = (
  lastBackupAt: string | null,
  type?: BackupLastInfo['type'],
  lastError?: string,
): BackupLastInfo => ({
  lastBackupAt,
  type: type === undefined ? 'local + cloud' : type,
  lastError,
});

const getLastBackupInfo = jest.fn();
const createBackup = jest.fn();
// captures channel subscriptions so tests can emit backup events
let channelHandlers: Record<string, (...args: unknown[]) => void>;
const ipcOn = jest.fn(
  (channel: string, handler: (...args: unknown[]) => void) => {
    channelHandlers[channel] = handler;
    return () => {
      delete channelHandlers[channel];
    };
  },
);

const renderStatus = async (collapsed = false) => {
  const view = render(<BackupStatus collapsed={collapsed} />);
  await waitFor(() => expect(getLastBackupInfo).toHaveBeenCalled());
  return view;
};

const statusButton = () =>
  screen.getByRole('button', { name: /backup status/i });

const openPopover = async () => {
  fireEvent.click(statusButton());
  await screen.findByText('Database backup');
};

describe('formatRelativeTimeCompact', () => {
  const now = Date.now();

  it.each([
    [30 * 1000, 'just now'],
    [5 * 60 * 1000, '5m ago'],
    [2 * HOUR_MS, '2h ago'],
    [3 * DAY_MS, '3d ago'],
  ])('formats %ims as "%s"', (ageMs, expected) => {
    expect(
      formatRelativeTimeCompact(new Date(now - ageMs).toISOString(), now),
    ).toBe(expected);
  });

  it('handles unparsable timestamps', () => {
    expect(formatRelativeTimeCompact('garbage', now)).toBe('unknown');
  });
});

describe('getBackupStalenessLevel', () => {
  const now = Date.now();

  it('is ok under 24h, stale under 7d, critical beyond', () => {
    expect(getBackupStalenessLevel(isoAgo(2 * HOUR_MS), false, now)).toBe('ok');
    expect(getBackupStalenessLevel(isoAgo(25 * HOUR_MS), false, now)).toBe(
      'stale',
    );
    expect(getBackupStalenessLevel(isoAgo(8 * DAY_MS), false, now)).toBe(
      'critical',
    );
  });

  it('is critical with no backup or a failed attempt', () => {
    expect(getBackupStalenessLevel(null, false, now)).toBe('critical');
    expect(getBackupStalenessLevel(isoAgo(HOUR_MS), true, now)).toBe(
      'critical',
    );
  });
});

describe('BackupStatus', () => {
  beforeAll(() => {
    // jsdom implements no ResizeObserver; radix popper measures with one
    (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {} // eslint-disable-line class-methods-use-this

      unobserve() {} // eslint-disable-line class-methods-use-this

      disconnect() {} // eslint-disable-line class-methods-use-this
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    channelHandlers = {};
    getLastBackupInfo.mockResolvedValue(info(isoAgo(2 * HOUR_MS)));
    createBackup.mockResolvedValue({ success: true });
    window.electron = {
      getLastBackupInfo,
      createBackup,
      ipcRenderer: { on: ipcOn },
    } as unknown as Window['electron'];
  });

  it('fetches on mount and renders the fresh (ok) state', async () => {
    await renderStatus();

    expect(await screen.findByText('Backed up 2h ago')).toBeTruthy();
    expect(screen.getByTestId('backup-status-dot').className).toContain(
      'bg-emerald-500',
    );
    expect(createBackup).not.toHaveBeenCalled();
  });

  it('renders amber when older than 24h', async () => {
    getLastBackupInfo.mockResolvedValue(info(isoAgo(25 * HOUR_MS)));
    await renderStatus();

    expect(await screen.findByText('Backed up 1d ago')).toBeTruthy();
    expect(screen.getByTestId('backup-status-dot').className).toContain(
      'bg-amber-500',
    );
  });

  it('renders red when older than 7 days', async () => {
    getLastBackupInfo.mockResolvedValue(info(isoAgo(8 * DAY_MS)));
    await renderStatus();

    expect(await screen.findByText('Backed up 8d ago')).toBeTruthy();
    expect(screen.getByTestId('backup-status-dot').className).toContain(
      'bg-red-500',
    );
  });

  it('renders red "No backup yet" when none exists', async () => {
    getLastBackupInfo.mockResolvedValue(info(null, null));
    await renderStatus();

    expect(await screen.findByText('No backup yet')).toBeTruthy();
    expect(screen.getByTestId('backup-status-dot').className).toContain(
      'bg-red-500',
    );
  });

  it('shows the offline hint when cloud is unreachable', async () => {
    getLastBackupInfo.mockResolvedValue(
      info(isoAgo(HOUR_MS), 'local', 'fetch failed'),
    );
    await renderStatus();
    await openPopover();

    expect(
      screen.getByText('Cloud unreachable — showing local backups only.'),
    ).toBeTruthy();
  });

  it('survives a rejected metadata fetch without crashing', async () => {
    getLastBackupInfo.mockRejectedValue(new Error('ipc gone'));
    await renderStatus();

    expect(await screen.findByText('No backup yet')).toBeTruthy();
  });

  it('triggers the create-backup IPC from the popover and refreshes on success', async () => {
    await renderStatus();
    await openPopover();

    fireEvent.click(screen.getByRole('button', { name: /back up now/i }));

    await waitFor(() => expect(createBackup).toHaveBeenCalledTimes(1));
    // mount fetch + post-backup refresh
    await waitFor(() => expect(getLastBackupInfo).toHaveBeenCalledTimes(2));
  });

  it('shows the failed state when a triggered backup fails', async () => {
    createBackup.mockResolvedValue({ success: false, error: 'bucket not set' });
    await renderStatus();
    await openPopover();

    fireEvent.click(screen.getByRole('button', { name: /back up now/i }));

    expect(await screen.findByText('bucket not set')).toBeTruthy();
    // label shows in both the trigger and the popover status line
    expect(screen.getAllByText('Backup failed').length).toBeGreaterThan(0);
    expect(screen.getByTestId('backup-status-dot').className).toContain(
      'bg-red-500',
    );
  });

  it('refreshes when a menu-triggered backup broadcasts completion', async () => {
    await renderStatus();

    channelHandlers['backup-operation-progress']({
      status: 'completed',
      type: 'upload',
      message: 'done',
    });

    await waitFor(() => expect(getLastBackupInfo).toHaveBeenCalledTimes(2));
  });

  it('turns red when a broadcast backup attempt fails', async () => {
    await renderStatus();

    channelHandlers['backup-operation-status']({
      status: 'error',
      type: 'backup',
      message: 'upload exploded',
    });

    expect(await screen.findByText('Backup failed')).toBeTruthy();
    expect(screen.getByTestId('backup-status-dot').className).toContain(
      'bg-red-500',
    );
  });

  it('renders icon-only when collapsed', async () => {
    await renderStatus(true);

    expect(screen.queryByText(/Backed up/)).toBeNull();
    expect(statusButton()).toBeTruthy();
  });
});
