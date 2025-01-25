import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import log from 'electron-log';
import { logErrors } from '../errorLogger';

@logErrors
export class DatabaseService {
  // eslint-disable-next-line no-use-before-define
  private static instance: DatabaseService | null;

  private db: Database.Database;

  private static _path: string;

  private constructor() {
    this.db = DatabaseService.connect();
  }

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  static resetInstance(): DatabaseService {
    DatabaseService.instance = null;
    return DatabaseService.getInstance();
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  private static get path(): string {
    if (!this._path) {
      this._path = this.getPath();
    }
    return this._path;
  }

  static getPath(): string {
    const databaseFileName = 'database.db';
    let databasePath: string;

    if (DatabaseService.isDevelopment()) {
      databasePath = path.join(
        __dirname,
        '../../../',
        'release/app',
        databaseFileName,
      );
    } else {
      const userDataPath = app.getPath('userData');
      databasePath = path.join(userDataPath, databaseFileName);

      if (!fs.existsSync(databasePath)) {
        const sourceDbPath = path.join(process.resourcesPath, databaseFileName);
        fs.copyFileSync(sourceDbPath, databasePath);
      }
    }

    return databasePath;
  }

  private static isDevelopment(): boolean {
    return (
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'test' ||
      process.env.DEBUG_PROD === 'true'
    );
  }

  private static connect(): Database.Database {
    log.info('Database connected');
    return new Database(this.path, {
      verbose: console.log,
    });
  }
}
