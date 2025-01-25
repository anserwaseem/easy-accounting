import fs from 'fs';
import path from 'path';
import { Notification } from 'electron';
import log from 'electron-log';
import Database from 'better-sqlite3';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { hostname } from 'node:os';
import { get, orderBy, uniqBy } from 'lodash';
import type { BackupCreateResult, BackupReadResult } from '@/types';
import { DatabaseService } from './Database.service';
import { logErrors } from '../errorLogger';
import { store } from '../store';

@logErrors
export class BackupService {
  private db: Database.Database;

  private backupDir: string;

  private readonly BACKUP_PREFIX = 'database-backup';

  private supabase: SupabaseClient;

  private bucketName:
    | `${typeof this.BACKUP_PREFIX}_${typeof process.platform}_${string}_${string}`
    | undefined;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    const dbPath = DatabaseService.getPath();
    this.backupDir = dbPath.slice(0, dbPath.lastIndexOf('/') + 1);
    this.ensureBackupDirectory();
    log.info(`Backup directory set to: ${this.backupDir}`);

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

      // show confirmation notification
      new Notification({
        title: 'Backup Created',
        body: `Database backup created locally and uploaded to cloud storage`,
        silent: false,
      }).show();

      log.info(
        `Database backup created locally at ${backupPath} and uploaded to Supabase storage at ${this.bucketName}`,
      );
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
      const localBackup = backups.find((b) => b.filename.includes(dateString));

      if (localBackup) return this.restoreFromBackup(localBackup.filename);

      const { data: files, error: listError } = await this.supabase.storage
        .from(this.bucketName)
        .list();

      if (listError) {
        log.error(`Supabase files listing failed: ${listError.message}`);
        return { success: false, error: listError.message };
      }

      const cloudBackup = files.find((f) => f.name.includes(dateString));
      if (!cloudBackup) {
        const error = `No backup found for date ${dateString}`;
        log.error(error);
        return { success: false, error };
      }

      const { data, error: downloadError } = await this.supabase.storage
        .from(this.bucketName)
        .download(cloudBackup.name);

      if (downloadError) {
        log.error(
          `Supabase file ${cloudBackup.name} downloading failed: ${downloadError.message}`,
        );
        return { success: false, error: downloadError.message };
      }

      const localPath = path.join(this.backupDir, cloudBackup.name);
      fs.writeFileSync(localPath, Buffer.from(await data.arrayBuffer()));

      return this.restoreFromBackup(cloudBackup.name);
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

    return this.restoreFromBackup(backups[0].filename);
  }

  public async listBackups(): Promise<
    Array<{
      filename: string;
      timestamp: Date;
      size: number;
      type: 'local' | 'cloud';
    }>
  > {
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
    if (this.bucketName) {
      const { data: cloudFiles, error: listError } = await this.supabase.storage
        .from(this.bucketName)
        .list();

      if (listError) {
        log.error(`Supabase files listing failed: ${listError.message}`);
        return localBackups;
      }

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
      uniqBy([...localBackups, ...cloudBackups], 'filename'),
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

  private ensureBackupDirectory(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  private setupBucketName = () => {
    const { platform } = process;
    const hostName = hostname().replace(/[^a-zA-Z0-9]/g, '-');
    const username = store.get('username');

    if (username) {
      this.bucketName = `${this.BACKUP_PREFIX}_${platform}_${hostName}_${username}`;
      log.info(`Backup bucket set to: ${this.bucketName}`);
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

  // "database-backup_2025-01-25T13-21-43-748Z.db"
  private static extractTimestamp = (filename: string): Date => {
    const dateStringWithDashes = filename.slice(
      filename.indexOf('_') + 1,
      filename.indexOf('.db'),
    ); // e,g. gives "2025-01-25T13-21-43-748Z"
    const dateStringWithMiliSeconds = dateStringWithDashes.replace(
      /-(\d{2})-(\d{2})-(\d{3})Z$/,
      ':$1:$2:$3Z',
    ); // e,g. gives "2025-01-25T13:21:43:748Z"
    const dateString = dateStringWithMiliSeconds.slice(
      0,
      dateStringWithMiliSeconds.lastIndexOf(':'),
    );
    return new Date(`${dateString}Z`);
  };
}
