import fs from 'fs';
// import path from 'path';
import Database from 'better-sqlite3';
import { Notification } from 'electron';
import { createClient } from '@supabase/supabase-js';
import { hostname } from 'node:os';
import { BackupService } from '../Backup.service';
import { DatabaseService } from '../Database.service';
import { isOnline } from '../../utils/general';
import { store } from '../../store';

jest.mock('fs');
jest.mock('path', () => jest.requireActual('path'));
jest.mock('better-sqlite3');
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));
jest.mock('node:os', () => ({
  hostname: jest.fn(),
}));
jest.mock('../../utils/general', () => ({
  isOnline: jest.fn(),
  getComputerName: jest.fn(() => 'test-computer'),
}));
jest.mock('../../store', () => ({
  store: {
    get: jest.fn(),
    onDidChange: jest.fn(),
  },
}));
jest.mock('../Database.service', () => ({
  DatabaseService: {
    getInstance: jest.fn().mockReturnValue({
      getDatabase: jest.fn(),
    }),
    getPath: jest.fn().mockReturnValue('/mocked/path/to/database.db'),
    resetInstance: jest.fn().mockReturnValue({
      getDatabase: jest.fn().mockReturnValue({}),
    }),
  },
}));

describe('BackupService', () => {
  let backupService: BackupService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    (store.get as jest.Mock).mockImplementation((key) => {
      if (key === 'username') return 'test-user';
    });

    (hostname as jest.Mock).mockReturnValue('mocked-hostname');

    (Database as unknown as jest.Mock).mockImplementation(() => ({
      backup: jest.fn().mockResolvedValue(true),
      close: jest.fn(),
    }));

    // mock database service
    DatabaseService.getInstance = jest.fn().mockReturnValue({
      getDatabase: jest.fn().mockReturnValue({
        backup: jest.fn().mockResolvedValue(true),
        close: jest.fn(),
      }),
    });
    (DatabaseService.getPath as jest.Mock).mockReturnValue(
      '/mocked/path/to/database.db',
    );

    // mock Supabase client
    (createClient as jest.Mock).mockReturnValue({
      storage: {
        createBucket: jest.fn().mockResolvedValue({ error: null }),
        from: jest.fn().mockReturnValue({
          upload: jest.fn().mockResolvedValue({ error: null }),
          list: jest.fn().mockResolvedValue({
            data: [
              {
                name: 'database-backup_2025-01-25T15-21-43-748Z.db',
                metadata: { size: 1234 },
              },
            ],
            error: null,
          }),
          download: jest.fn().mockResolvedValue({
            data: {
              arrayBuffer: async () => Buffer.from('mocked backup data'),
            },
            error: null,
          }),
        }),
      },
    });

    backupService = new BackupService();
  });

  it('should set the backup directory correctly', () => {
    expect(backupService).toHaveProperty('backupDir');
    // bucket name embeds the runtime platform, so the expectation must too
    // eslint-disable-next-line dot-notation
    expect(backupService['backupDir']).toBe(
      `/mocked/path/to/backups/database-backup_${process.platform}_test-computer_test-user`,
    );
  });

  describe('createBackup', () => {
    it('should create a local backup successfully', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('test'));
      (isOnline as jest.Mock).mockReturnValue(false);

      const result = await backupService.createBackup();

      expect(result.success).toBe(true);
      expect(result.path).toContain('database-backup');
      expect(Notification).toHaveBeenCalledWith({
        title: 'Backup Created',
        body: 'Database backup created locally',
        silent: false,
      });
    });

    it('should upload a backup to the cloud if online', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('test'));
      (isOnline as jest.Mock).mockReturnValue(true);

      const result = await backupService.createBackup();

      expect(result.success).toBe(true);
      expect(result.path).toContain('database-backup');
      expect(Notification).toHaveBeenCalledWith({
        title: 'Backup Created',
        body: 'Database backup created locally and uploaded to cloud storage',
        silent: false,
      });
    });
  });

  describe('listBackups', () => {
    it('should list local backups', async () => {
      (isOnline as jest.Mock).mockReturnValue(false);
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'database-backup_2025-01-25T15-21-43-748Z.db',
        'database-backup_2025-01-26T16-21-43-748Z.db',
      ]);
      (fs.statSync as jest.Mock).mockReturnValue({ size: 1234 });

      const backups = await backupService.listBackups();

      expect(backups.length).toBe(2);
      expect(backups[0].filename).toBe(
        'database-backup_2025-01-26T16-21-43-748Z.db',
      );
    });

    it('should list cloud backups', async () => {
      (isOnline as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([]);

      const backups = await backupService.listBackups();

      expect(backups.length).toBe(1);
      expect(backups[0].filename).toBe(
        'database-backup_2025-01-25T15-21-43-748Z.db',
      );
      expect(backups[0].type).toBe('cloud');
    });
  });

  describe('restoreFromDate', () => {
    it('should restore a local backup successfully', async () => {
      (isOnline as jest.Mock).mockReturnValue(false);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'database-backup_2025-01-25T15-21-43-748Z.db',
        'database-backup_2025-01-26T16-21-43-748Z.db',
      ]);
      (fs.copyFileSync as jest.Mock).mockImplementation(() => {});

      const result = await backupService.restoreFromDate(
        '2025-01-25T15-21-43-748Z',
      );

      expect(result.success).toBe(true);
    });

    it('should restore a cloud backup if local backup is not found', async () => {
      (isOnline as jest.Mock).mockReturnValue(true);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([]);
      (fs.copyFileSync as jest.Mock).mockImplementation(() => {});
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

      const result = await backupService.restoreFromDate(
        '2025-01-25T15-21-43-748Z',
      );

      expect(result.success).toBe(true);
    });
  });

  describe('getLastBackupInfo', () => {
    // builds a valid backup filename for a given date, mimicking real names
    const backupFilename = (date: Date) =>
      `database-backup_${date.toISOString().replace(/[:.]/g, '-')}.db`;

    // extractTimestamp keeps second precision only
    const expectedIso = (date: Date) =>
      new Date(`${date.toISOString().slice(0, 19)}Z`).toISOString();

    it('returns the newest local backup when offline (fresh case)', async () => {
      const recent = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
      const older = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3d ago
      (isOnline as jest.Mock).mockReturnValue(false);
      (fs.readdirSync as jest.Mock).mockReturnValue([
        backupFilename(older),
        backupFilename(recent),
      ]);
      (fs.statSync as jest.Mock).mockReturnValue({ size: 1234 });

      const infoResult = await backupService.getLastBackupInfo();

      expect(infoResult.lastBackupAt).toBe(expectedIso(recent));
      expect(infoResult.type).toBe('local');
      expect(infoResult.lastError).toBeUndefined();
    });

    it('returns a stale cloud backup when it is the only one', async () => {
      (isOnline as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([]);

      const infoResult = await backupService.getLastBackupInfo();

      // beforeEach mocks the cloud listing with a 2025-01-25 backup
      expect(infoResult.lastBackupAt).toBe('2025-01-25T15:21:43.000Z');
      expect(infoResult.type).toBe('cloud');
      expect(infoResult.lastError).toBeUndefined();
    });

    it('returns nulls when no backups exist (empty case)', async () => {
      (isOnline as jest.Mock).mockReturnValue(false);
      (fs.readdirSync as jest.Mock).mockReturnValue([]);

      const infoResult = await backupService.getLastBackupInfo();

      expect(infoResult).toEqual({ lastBackupAt: null, type: null });
    });

    it('degrades to local metadata with lastError when cloud listing throws', async () => {
      const recent = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
      (isOnline as jest.Mock).mockReturnValue(true);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue([backupFilename(recent)]);
      (fs.statSync as jest.Mock).mockReturnValue({ size: 1234 });
      // e.g. dummy SUPABASE env vars / unreachable network reject the request
      (createClient as jest.Mock).mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            list: jest.fn().mockRejectedValue(new Error('fetch failed')),
          }),
        },
      });
      const failingService = new BackupService();

      const infoResult = await failingService.getLastBackupInfo();

      expect(infoResult.lastBackupAt).toBe(expectedIso(recent));
      expect(infoResult.type).toBe('local');
      expect(infoResult.lastError).toContain('fetch failed');
    });

    it('returns nulls when the user is logged out (no backup dir)', async () => {
      (store.get as jest.Mock).mockReturnValue(undefined);
      const loggedOutService = new BackupService();

      const infoResult = await loggedOutService.getLastBackupInfo();

      expect(infoResult).toEqual({ lastBackupAt: null, type: null });
    });
  });

  describe('setupAutoBackup', () => {
    jest.useFakeTimers();

    it('should auto schedule backup after every 1 day', () => {
      backupService.createBackup = jest.fn().mockResolvedValue({});

      backupService.setupAutoBackup(); // 1 day interval
      jest.advanceTimersByTime(24 * 60 * 60 * 1000); // Advance time by 1 day

      expect(backupService.createBackup).toHaveBeenCalledTimes(1);
    });

    it('should schedule backup at the given interval: 1 hour', () => {
      backupService.createBackup = jest.fn().mockResolvedValue({});

      backupService.setupAutoBackup(1); // 1 hour interval
      jest.advanceTimersByTime(60 * 60 * 1000); // Advance time by 1 hour

      expect(backupService.createBackup).toHaveBeenCalledTimes(1);
    });
  });
});
