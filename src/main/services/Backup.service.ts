import fs from 'fs';
import path from 'path';
import { Notification } from 'electron';
import log from 'electron-log';
import Database from 'better-sqlite3';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { hostname } from 'node:os';
import { compact, get, orderBy, uniqBy } from 'lodash';
import type { BackupCreateResult, BackupReadResult } from '@/types';
import { DatabaseService } from './Database.service';
import { logErrors } from '../errorLogger';
import { store } from '../store';
import { isOnline } from '../utils/general';

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

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();

    this.supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_ANON_KEY || '',
    );
    this.setupBucketName();
  }

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
        }).show();
        return { success: true, path: backupPath };
      }

      // ensure bucket exists
      const { error: bucketError } = await this.supabase.storage.createBucket(
        this.bucketName,
        { public: false },
      );

      if (
        bucketError &&
        bucketError?.message !== 'The resource already exists'
      ) {
        log.error(`Supabase bucket creation failed: ${bucketError.message}`);
        return { success: false, error: bucketError.message };
      }

      // upload backup db
      const fileBuffer = fs.readFileSync(backupPath);
      const fileName = path.basename(backupPath);

      const { error: uploadError } = await this.supabase.storage
        .from(this.bucketName)
        .upload(fileName, fileBuffer, {
          contentType: 'application/octet-stream',
          duplex: 'half',
        });

      if (uploadError) {
        log.error(`Supabase file uploading failed: ${uploadError.message}`);
        return { success: false, error: uploadError.message };
      }

      new Notification({
        title: 'Backup Created',
        body: `Database backup created locally and uploaded to cloud storage`,
        silent: false,
      }).show();
      log.info(`Database backup created in cloud at ${this.bucketName}`);
      return { success: true, path: backupPath };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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

      const { data, error: downloadError } = await this.supabase.storage
        .from(this.bucketName)
        .download(backup.filename);

      if (downloadError) {
        const error = `Supabase file ${backup.filename} downloading failed: ${downloadError.message}`;
        log.error(error);
        return { success: false, error };
      }

      const localPath = path.join(this.backupDir, backup.filename);
      fs.writeFileSync(localPath, Buffer.from(await data.arrayBuffer())); // failing here

      return this.restoreFromBackup(backup.filename);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
  public async listBackups(): Promise<
    Array<{
      filename: string;
      timestamp: Date;
      size: number;
      type: 'local' | 'cloud';
    }>
  > {
    if (!this.backupDir || !this.bucketName) {
      log.info(
        `No backup directory or bucket available - user is logged out ${this.backupDir} ${this.bucketName}`,
      );
      return [];
    }

    const localBackups = fs
      .readdirSync(this.backupDir)
      .filter((file) => file.startsWith(this.BACKUP_PREFIX))
      .map((filename) => ({
        filename,
        timestamp: BackupService.extractTimestamp(filename),
        size: fs.statSync(path.join(this.backupDir, filename)).size,
        type: 'local' as const,
      }));

    let cloudBackups: Awaited<ReturnType<typeof this.listBackups>> = [];
    const isonline = await isOnline();
    if (this.bucketName && isonline) {
      const { data: cloudFiles, error: listError } = await this.supabase.storage
        .from(this.bucketName)
        .list();

      if (listError) {
        log.error(
          `Supabase files listing from bucket: ${this.bucketName} failed: ${listError.message}`,
        );
        return localBackups;
      }
      log.info(
        `Supabase files fetched: ${cloudFiles?.length} from bucket: ${this.bucketName}`,
      );

      cloudBackups = cloudFiles
        .filter((file) => file.name.startsWith(this.BACKUP_PREFIX))
        .map((file) => ({
          filename: file.name, // e.g. "database-backup_2025-01-25T13-21-43-748Z.db"
          timestamp: BackupService.extractTimestamp(file.name),
          size: get(file.metadata, 'size', 0),
          type: 'cloud' as const,
        }));
    }

    return orderBy(
      uniqBy(compact([...localBackups, ...cloudBackups]), 'filename'),
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
    const hostName = hostname().replace(/[^a-zA-Z0-9]/g, '-');
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
}
