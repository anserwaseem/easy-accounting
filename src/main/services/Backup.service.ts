import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import Database from 'better-sqlite3';
import type { BackupCreateResult, BackupReadResult } from '@/types';
import { DatabaseService } from './Database.service';
import { logErrors } from '../errorLogger';

// TODO upload backup db to cloud
@logErrors
export class BackupService {
  private db: Database.Database;

  private backupDir: string;

  private readonly backupPrefix = 'database-backup-';

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    const dbPath = DatabaseService.getPath();
    this.backupDir = dbPath.slice(0, dbPath.lastIndexOf('/') + 1);
    log.info(`Backup directory set to: ${this.backupDir}`);
    this.ensureBackupDirectory();
  }

  public async createBackup(): Promise<BackupCreateResult> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(
        this.backupDir,
        `${this.backupPrefix}${timestamp}.db`,
      );

      const backupDb = new Database(backupPath);

      await this.db.backup(backupPath);
      backupDb.close();

      log.info(`Database backup created at ${backupPath}`);
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
      const backups = this.listBackups();
      const backup = backups.find((b) => b.filename.includes(dateString));

      if (!backup) {
        throw new Error(`No backup found for date ${dateString}`);
      }

      return this.restoreFromBackup(backup.filename);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error('Restore failed:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  public async restoreLastBackup(): Promise<BackupReadResult> {
    const backups = this.listBackups();
    if (backups.length === 0) {
      const errorMsg = 'No backups available';
      log.error(errorMsg);
      return { success: false, error: errorMsg };
    }

    return this.restoreFromBackup(backups[0].filename);
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

  public listBackups(): Array<{
    filename: string;
    timestamp: Date;
    size: number;
  }> {
    return fs
      .readdirSync(this.backupDir)
      .filter((file) => file.startsWith(this.backupPrefix))
      .map((filename) => ({
        filename,
        timestamp: fs.statSync(path.join(this.backupDir, filename)).mtime,
        size: fs.statSync(path.join(this.backupDir, filename)).size,
      }))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
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

  private ensureBackupDirectory(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }
}
