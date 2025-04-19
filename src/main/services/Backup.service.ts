import fs from 'fs';
import path from 'path';
import { Notification, BrowserWindow } from 'electron';
import log from 'electron-log';
import Database from 'better-sqlite3';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { get, orderBy } from 'lodash';
import type {
  BackupCreateResult,
  BackupReadResult,
  BackupInfo,
  BackupMetadata,
  BackupType,
  BackupOperationProgressEvent,
  BackupOperationProgressStatus,
  BackupOperationTransferType,
} from '@/types';
import { DatabaseService } from './Database.service';
import { logErrors } from '../errorLogger';
import { store } from '../store';
import { getComputerName, isOnline } from '../utils/general';

// FUTURE sync local backups to cloud when internet is connected or expose a button
@logErrors
export class BackupService {
  private db: Database.Database;

  private readonly BACKUP_PREFIX = 'database-backup';

  private backupDir!: string;

  private supabase: SupabaseClient;

  private bucketName:
    | `${typeof this.BACKUP_PREFIX}_${typeof process.platform}_${string}_${string}`
    | undefined;

  private readonly logPrefix: string = 'BackupService';

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();

    this.supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_ANON_KEY || '',
    );
    this.setupBucketName();
  }

  // emit progress event to all open browser windows
  private emitProgress = (
    status: BackupOperationProgressStatus,
    message: string,
    type: BackupOperationTransferType = 'upload',
  ): void => {
    const progressEvent: BackupOperationProgressEvent = {
      status,
      message,
      type,
    };

    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('backup-operation-progress', progressEvent);
      }
    });
    log.info(`${this.logPrefix} progress: ${status} - ${message}`);
  };

  public async createBackup(): Promise<BackupCreateResult> {
    try {
      if (!this.bucketName) {
        const error = 'Supabase bucket is not set right now [UNREACHABLE]';
        log.info(error);
        return { success: false, error };
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(
        this.backupDir,
        `${this.BACKUP_PREFIX}_${timestamp}.db`,
      );

      const backupDb = new Database(backupPath);
      await this.db.backup(backupPath);
      backupDb.close();

      log.info(`Database backup created locally at ${backupPath}`);

      const isonline = await isOnline();
      log.info(`isOnline: ${isonline}`);
      if (!isonline) {
        new Notification({
          title: 'Backup Created',
          body: `Database backup created locally`,
          silent: false,
          icon:
            process.platform === 'win32'
              ? path.join(process.resourcesPath, 'assets/icon.png')
              : undefined,
        }).show();
        return { success: true, path: backupPath };
      }

      // emit progress for upload starting
      this.emitProgress('started', 'Uploading backup to cloud storage...');

      // ensure bucket exists
      const { error: bucketError } = await this.supabase.storage.createBucket(
        this.bucketName,
        { public: false },
      );

      if (
        bucketError &&
        bucketError?.message !== 'The resource already exists'
      ) {
        this.emitProgress(
          'failed',
          `Failed to create cloud bucket: ${bucketError.message}`,
        );
        log.error(`Supabase bucket creation failed: ${bucketError.message}`);
        return { success: false, error: bucketError.message };
      }

      // upload backup db
      this.emitProgress('processing', 'Reading local backup file...');
      const fileBuffer = fs.readFileSync(backupPath);
      const fileName = path.basename(backupPath);

      this.emitProgress(
        'uploading',
        `Uploading ${(fileBuffer.length / (1024 * 1024)).toFixed(
          2,
        )} MB to cloud...`,
      );
      const { error: uploadError } = await this.supabase.storage
        .from(this.bucketName)
        .upload(fileName, fileBuffer, {
          contentType: 'application/octet-stream',
          duplex: 'half',
        });

      if (uploadError) {
        this.emitProgress('failed', `Upload failed: ${uploadError.message}`);
        log.error(`Supabase file uploading failed: ${uploadError.message}`);
        return { success: false, error: uploadError.message };
      }

      this.emitProgress(
        'completed',
        'Backup successfully uploaded to cloud storage',
      );
      new Notification({
        title: 'Backup Created',
        body: `Database backup created locally and uploaded to cloud storage`,
        silent: false,
        icon:
          process.platform === 'win32'
            ? path.join(process.resourcesPath, 'assets/icon.png')
            : undefined,
      }).show();
      log.info(`Database backup created in cloud at ${this.bucketName}`);
      return { success: true, path: backupPath };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emitProgress('failed', `Backup failed: ${errorMessage}`);
      log.error('Backup creation failed:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  public async restoreFromDate(dateString: string): Promise<BackupReadResult> {
    try {
      if (!this.bucketName) {
        const error = 'Supabase bucket is not set right now [UNREACHABLE]';
        log.info(error);
        return { success: false, error };
      }

      // try local restore first
      const backups = await this.listBackups();
      const backup = backups.find((b) => b.filename.includes(dateString));

      if (!backup) {
        const error = `No backup found for date ${dateString}`;
        log.error(error);
        return { success: false, error };
      }

      if (backup.type === 'local')
        return this.restoreFromBackup(backup.filename);

      if (!isOnline())
        return {
          success: false,
          error: 'Please turn on internet to restore cloud backup.',
        };

      this.emitProgress(
        'started',
        `Downloading backup from cloud...`,
        'download',
      );
      const { data, error: downloadError } = await this.supabase.storage
        .from(this.bucketName)
        .download(backup.filename);

      if (downloadError) {
        this.emitProgress(
          'failed',
          `Download failed: ${downloadError.message}`,
          'download',
        );
        const error = `Supabase file ${backup.filename} downloading failed: ${downloadError.message}`;
        log.error(error);
        return { success: false, error };
      }

      this.emitProgress(
        'processing',
        'Saving downloaded backup to local storage...',
        'download',
      );
      const localPath = path.join(this.backupDir, backup.filename);
      fs.writeFileSync(localPath, Buffer.from(await data.arrayBuffer())); // failing here

      this.emitProgress(
        'completed',
        'Backup successfully downloaded from cloud',
        'download',
      );
      return this.restoreFromBackup(backup.filename);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emitProgress(
        'failed',
        `Restore failed: ${errorMessage}`,
        'download',
      );
      log.error('Restore failed:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  public async restoreLastBackup(): Promise<BackupReadResult> {
    const backups = await this.listBackups();
    if (backups.length === 0) {
      const errorMsg = 'No backups available';
      log.error(errorMsg);
      return { success: false, error: errorMsg };
    }

    const dateString = backups[0].filename
      .replace('database-backup-', '')
      .replace('.db', '');
    return this.restoreFromDate(dateString);
  }

  // FIXME: list backups only for logged-in user
  public async listBackups(): Promise<BackupInfo[]> {
    if (!this.backupDir || !this.bucketName) {
      log.info(
        `No backup directory or bucket available - user is logged out ${this.backupDir} ${this.bucketName}`,
      );
      return [];
    }

    // get local backups
    const localBackups: BackupMetadata[] = fs
      .readdirSync(this.backupDir)
      .filter((file) => file.startsWith(this.BACKUP_PREFIX))
      .map((filename) => ({
        filename,
        timestamp: BackupService.extractTimestamp(filename),
        size: fs.statSync(path.join(this.backupDir, filename)).size,
        local: true,
        cloud: false,
      }));

    // get cloud backups
    let cloudBackups: BackupMetadata[] = [];
    if (this.bucketName && (await isOnline())) {
      const { data: cloudFiles, error: listError } = await this.supabase.storage
        .from(this.bucketName)
        .list();

      if (!listError && cloudFiles?.length) {
        log.info(
          `Supabase files fetched: ${cloudFiles.length} from bucket: ${this.bucketName}`,
        );
        cloudBackups = cloudFiles
          .filter((file) => file.name.startsWith(this.BACKUP_PREFIX))
          .map((file) => ({
            filename: file.name,
            timestamp: BackupService.extractTimestamp(file.name),
            size: get(file.metadata, 'size', 0),
            local: false,
            cloud: true,
          }));
      } else if (listError) {
        log.error(`Supabase files listing failed: ${listError.message}`);
      }
    }

    // merge and convert to final format
    return orderBy(
      Object.values(
        [...localBackups, ...cloudBackups].reduce(
          (acc, backup) => {
            const existing = acc[backup.filename];
            if (existing) {
              existing.local ||= backup.local;
              existing.cloud ||= backup.cloud;
              existing.size = Math.max(existing.size, backup.size);
            } else {
              acc[backup.filename] = backup;
            }
            return acc;
          },
          {} as Record<string, BackupMetadata>,
        ),
      ).map(({ filename, timestamp, size, local, cloud }) => ({
        filename,
        timestamp,
        size,
        type: BackupService.determineBackupType(local, cloud),
      })),
      (b) => b.timestamp.getTime(),
      'desc',
    );
  }

  public setupAutoBackup(intervalHours: number = 24): void {
    setInterval(
      () => {
        this.createBackup().catch((error) => {
          log.error('Auto backup failed:', error);
        });
      },
      intervalHours * 60 * 60 * 1000,
    );
  }

  private async restoreFromBackup(filename: string): Promise<BackupReadResult> {
    try {
      const backupPath = path.join(this.backupDir, filename);
      if (!fs.existsSync(backupPath)) {
        const errorMsg = `Backup file ${backupPath} not found`;
        log.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Copy backup to main database location
      const dbPath = DatabaseService.getPath();
      fs.copyFileSync(backupPath, dbPath);

      // Reinitialize database
      this.db = DatabaseService.resetInstance().getDatabase();

      log.info('Database restored from:', filename);
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error('Restore failed:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  private static ensureBackupDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private setupBucketName = () => {
    const { platform } = process;
    const cn = getComputerName();
    const hostName = cn.replace(/[^a-zA-Z0-9]/g, '-');
    const username = store.get('username');

    if (username) {
      this.bucketName = `${this.BACKUP_PREFIX}_${platform}_${hostName}_${username}`;
      log.info(`Backup bucket set to: ${this.bucketName}`);

      const dbPath = DatabaseService.getPath();
      const baseBackupDir = path.join(
        dbPath.slice(0, dbPath.lastIndexOf('/') + 1),
        'backups',
      );
      this.backupDir = path.join(baseBackupDir, this.bucketName);
      BackupService.ensureBackupDirectory(this.backupDir);
      log.info(`Backup directory set to: ${this.backupDir}`);
    }

    // reset bucket name when new user logs in
    store.onDidChange('username', (newValue, oldValue) => {
      log.info(
        `store.onDidChange invoked for "username" key - newValue: ${newValue}, oldValue: ${oldValue}`,
      );
      if (newValue) {
        this.bucketName = `${this.BACKUP_PREFIX}_${platform}_${hostName}_${newValue}`;
        log.info(`Backup bucket reset to: ${this.bucketName}`);
      } else {
        this.bucketName = undefined;
        log.info('Backup bucket reset');
      }
    });
  };

  // e.g. "database-backup_2025-01-25T13-21-43-748Z.db"
  private static extractTimestamp = (filename: string): Date => {
    const dateStringWithDashes = filename.slice(
      filename.indexOf('_') + 1,
      filename.indexOf('.db'),
    ); // e.g. gives "2025-01-25T13-21-43-748Z"
    const dateStringWithMiliSeconds = dateStringWithDashes.replace(
      /-(\d{2})-(\d{2})-(\d{3})Z$/,
      ':$1:$2:$3Z',
    ); // e.g. gives "2025-01-25T13:21:43:748Z"
    const dateString = dateStringWithMiliSeconds.slice(
      0,
      dateStringWithMiliSeconds.lastIndexOf(':'),
    );
    return new Date(`${dateString}Z`);
  };

  private static determineBackupType(
    isLocal: boolean,
    isCloud: boolean,
  ): BackupType {
    if (isLocal && isCloud) return 'local + cloud';
    if (isLocal) return 'local';
    return 'cloud';
  }

  public getBackupDir(): string {
    return this.backupDir;
  }
}
