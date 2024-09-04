import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { logErrors } from '../errorLogger';

@logErrors
export class DatabaseService {
  // eslint-disable-next-line no-use-before-define
  private static instance: DatabaseService;

  private db: Database.Database;

  private constructor() {
    this.db = DatabaseService.connect();
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  public getDatabase(): Database.Database {
    return this.db;
  }

  private static isDevelopment(): boolean {
    return (
      process.env.NODE_ENV === 'development' ||
      process.env.DEBUG_PROD === 'true'
    );
  }

  private static connect(): Database.Database {
    const userDataPath = app.getPath('userData');
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
      databasePath = path.join(userDataPath, databaseFileName);

      if (!fs.existsSync(databasePath)) {
        const sourceDbPath = path.join(process.resourcesPath, databaseFileName);
        fs.copyFileSync(sourceDbPath, databasePath);
      }
    }

    return new Database(databasePath, {
      verbose: console.log,
    });
  }
}
