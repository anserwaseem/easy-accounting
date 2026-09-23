import fs from 'fs';
import path from 'path';
import { Notification, BrowserWindow } from 'electron';
import log from 'electron-log';
import Database from 'better-sqlite3';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { get, orderBy } from 'lodash';
import type {
  BackupCreateResult,
  ApiResponse,
  BackupInfo,
  BackupMetadata,
  BackupType,
  BackupOperationProgressEvent,
  BackupOperationProgressStatus,
  BackupOperationTransferType,
} from '@/types';
import { DatabaseService } from './Database.service';
import { logErrors } from '../errorLogger';
import { raise, getComputerName, isOnline } from '../utils/general';
import { store } from '../store';
import { getBackupCredentials } from '../utils/backupConfig';

/**
 * shared BYOK bucket from supabase/setup.sql. new uploads prefer this.
 * the client never createBucket — older desktops already created a
 * per-machine bucket (`database-backup_{platform}_{host}_{user}`) and
 * upgrades still list/restore from that one.
 */
export const CLOUD_BACKUP_BUCKET = 'easy-accounting-backups';

/** read-only metadata about the most recent backup, for the sidebar indicator */
export type BackupLastInfo = {
  /** ISO timestamp of the newest known backup, or null when none exists */
  lastBackupAt: string | null;
  type: BackupType | null;
  /** set when deriving the info hit an error (e.g. cloud storage unreachable) */
  lastError?: string;
};

// FUTURE sync local backups to cloud when internet is connected or expose a button
@logErrors
export class BackupService {
  private db: Database.Database;

  private readonly BACKUP_PREFIX = 'database-backup';

  private backupDir!: string;

  private supabase: SupabaseClient | null = null;

  private supabaseFingerprint = '';

  /** local folder + legacy per-machine cloud bucket from pre-BYOK desktops */
  private bucketName:
    | `${typeof this.BACKUP_PREFIX}_${typeof process.platform}_${string}_${string}`
    | undefined;

  /** filename → supabase storage bucket last seen during list/upload */
  private cloudObjectBuckets = new Map<string, string>();

  private readonly logPrefix: string = 'BackupService';

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.setupBucketName();
  }

  /**
   * rebuilds the supabase client when Settings credentials change. local
   * backups still run when this returns null — only cloud upload/list/restore
   * are skipped.
   */
  private getSupabase(): SupabaseClient | null {
    const creds = getBackupCredentials();
    if (!creds) {
      this.supabase = null;
      this.supabaseFingerprint = '';
      return null;
    }

    const fingerprint = `${creds.url}\0${creds.anonKey}`;
    if (this.supabase && this.supabaseFingerprint === fingerprint) {
      return this.supabase;
    }

    try {
      this.supabase = createClient(creds.url, creds.anonKey);
      this.supabaseFingerprint = fingerprint;
      return this.supabase;
    } catch (err) {
      log.error(`${this.logPrefix}: Failed to initialize Supabase client`, err);
      this.supabase = null;
      this.supabaseFingerprint = '';
      return null;
    }
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

      const supabase = this.getSupabase();
      if (!supabase) {
        log.warn(
          `${this.logPrefix}: Skipping cloud backup upload (Supabase credentials not configured).`,
        );
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
      const uploadError = await this.uploadCloudBackup(
        supabase,
        fileName,
        fileBuffer,
      );

      if (uploadError) {
        this.emitProgress('failed', `Upload failed: ${uploadError}`);
        log.error(`Supabase file uploading failed: ${uploadError}`);
        return { success: false, error: uploadError };
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
      log.info(
        `Database backup created in cloud at ${
          this.cloudObjectBuckets.get(fileName) ?? CLOUD_BACKUP_BUCKET
        }`,
      );
      return { success: true, path: backupPath };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emitProgress('failed', `Backup failed: ${errorMessage}`);
      log.error('Backup creation failed:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  public async restoreFromDate(dateString: string): Promise<ApiResponse> {
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

      const supabase = this.getSupabase();
      if (!supabase) {
        return {
          success: false,
          error: 'Cloud backup storage is not configured.',
        };
      }

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
      const downloaded = await this.downloadCloudBackup(
        supabase,
        backup.filename,
      );

      if (!downloaded.ok) {
        this.emitProgress(
          'failed',
          `Download failed: ${downloaded.error}`,
          'download',
        );
        const error = `Supabase file ${backup.filename} downloading failed: ${downloaded.error}`;
        log.error(error);
        return { success: false, error };
      }

      this.emitProgress(
        'processing',
        'Saving downloaded backup to local storage...',
        'download',
      );
      const localPath = path.join(this.backupDir, backup.filename);
      fs.writeFileSync(
        localPath,
        new Uint8Array(await downloaded.data.arrayBuffer()),
      );

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

  public async restoreLastBackup(): Promise<ApiResponse> {
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

    const supabase = this.getSupabase();
    const cloudBackups =
      supabase && this.bucketName && (await isOnline())
        ? await this.listCloudBackups(supabase)
        : [];

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

  private async restoreFromBackup(filename: string): Promise<ApiResponse> {
    try {
      const backupPath = path.join(this.backupDir, filename);
      if (!fs.existsSync(backupPath)) {
        const errorMsg = `Backup file ${backupPath} not found`;
        log.error(errorMsg);
        raise(errorMsg);
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

  /** shared BYOK bucket first, then this machine's pre-upgrade cloud bucket */
  private cloudBuckets(): string[] {
    const buckets = [CLOUD_BACKUP_BUCKET];
    if (this.bucketName) {
      buckets.push(this.bucketName);
    }
    return buckets;
  }

  private static isMissingBucketError(message: string): boolean {
    return /bucket|not found|does not exist/i.test(message);
  }

  /** try the shared bucket, then the legacy per-machine bucket. never createBucket. */
  private async uploadCloudBackup(
    supabase: SupabaseClient,
    fileName: string,
    fileBuffer: Buffer,
  ): Promise<string | null> {
    let lastMessage = '';
    let lastWasMissing = false;
    // sequential: shared bucket first, then the old per-machine one
    for (const bucket of this.cloudBuckets()) {
      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabase.storage
        .from(bucket)
        .upload(fileName, fileBuffer, {
          contentType: 'application/octet-stream',
          duplex: 'half',
        });
      if (!error) {
        this.cloudObjectBuckets.set(fileName, bucket);
        log.info(`${this.logPrefix}: uploaded ${fileName} to ${bucket}`);
        return null;
      }
      lastMessage = error.message;
      lastWasMissing = BackupService.isMissingBucketError(error.message);
      log.warn(
        `${this.logPrefix}: upload to ${bucket} failed: ${error.message}`,
      );
    }
    const hint = lastWasMissing
      ? ' If this is a new project, re-run supabase/setup.sql so easy-accounting-backups exists. Upgraded desktops keep using the old per-machine bucket when that still exists.'
      : '';
    return `${lastMessage}.${hint}`;
  }

  private async downloadCloudBackup(
    supabase: SupabaseClient,
    filename: string,
  ): Promise<
    | { ok: true; data: { arrayBuffer: () => Promise<ArrayBuffer> } }
    | { ok: false; error: string }
  > {
    const ordered: string[] = [];
    const known = this.cloudObjectBuckets.get(filename);
    if (known) ordered.push(known);
    this.cloudBuckets().forEach((bucket) => {
      if (!ordered.includes(bucket)) ordered.push(bucket);
    });

    let lastMessage = 'not found';
    for (const bucket of ordered) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase.storage
        .from(bucket)
        .download(filename);
      if (!error && data) {
        this.cloudObjectBuckets.set(filename, bucket);
        return { ok: true, data };
      }
      if (error) lastMessage = error.message;
    }
    return { ok: false, error: lastMessage };
  }

  private async listCloudBackups(
    supabase: SupabaseClient,
  ): Promise<BackupMetadata[]> {
    this.cloudObjectBuckets.clear();
    const byName: Record<string, BackupMetadata> = {};
    const buckets = this.cloudBuckets();
    const listings = await Promise.all(
      buckets.map(async (bucket) => {
        const { data: cloudFiles, error: listError } = await supabase.storage
          .from(bucket)
          .list();
        return { bucket, cloudFiles, listError };
      }),
    );

    // shared bucket is first in `buckets`, so it wins on duplicate filenames
    listings.forEach(({ bucket, cloudFiles, listError }) => {
      if (listError) {
        log.error(
          `Supabase files listing failed for ${bucket}: ${listError.message}`,
        );
        return;
      }
      if (!cloudFiles?.length) return;
      log.info(
        `Supabase files fetched: ${cloudFiles.length} from bucket: ${bucket}`,
      );
      cloudFiles
        .filter((file) => file.name.startsWith(this.BACKUP_PREFIX))
        .forEach((file) => {
          if (byName[file.name]) return;
          byName[file.name] = {
            filename: file.name,
            timestamp: BackupService.extractTimestamp(file.name),
            size: get(file.metadata, 'size', 0),
            local: false,
            cloud: true,
          };
          this.cloudObjectBuckets.set(file.name, bucket);
        });
    });

    return Object.values(byName);
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
      const dbDir = path.dirname(dbPath);
      const baseBackupDir = path.join(dbDir, 'backups');
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
    return this.backupDir || '';
  }

  /**
   * Metadata about the most recent backup for the sidebar staleness indicator.
   * Never rejects: when cloud listing throws (e.g. unreachable or dummy
   * credentials) it degrades to local backup directory metadata so the
   * indicator can always render something meaningful.
   */
  public async getLastBackupInfo(): Promise<BackupLastInfo> {
    try {
      const backups = await this.listBackups();
      const latest = backups[0];
      if (!latest) return { lastBackupAt: null, type: null };

      return {
        // an unparsable filename yields an invalid Date whose toISOString
        // throws; the catch below then falls back to local metadata
        lastBackupAt: latest.timestamp.toISOString(),
        type: latest.type,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error(`${this.logPrefix} getLastBackupInfo failed:`, errorMessage);
      return { ...this.getLocalLastBackupInfo(), lastError: errorMessage };
    }
  }

  // local-only fallback used when the merged listing cannot be derived
  private getLocalLastBackupInfo(): Pick<
    BackupLastInfo,
    'lastBackupAt' | 'type'
  > {
    try {
      if (!this.backupDir || !fs.existsSync(this.backupDir)) {
        return { lastBackupAt: null, type: null };
      }

      const timestamps = fs
        .readdirSync(this.backupDir)
        .filter((file) => file.startsWith(this.BACKUP_PREFIX))
        .map((file) => BackupService.extractTimestamp(file).getTime())
        .filter((time) => Number.isFinite(time));

      if (timestamps.length === 0) return { lastBackupAt: null, type: null };

      return {
        lastBackupAt: new Date(Math.max(...timestamps)).toISOString(),
        type: 'local',
      };
    } catch {
      return { lastBackupAt: null, type: null };
    }
  }
}
