import type { Database } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { get } from 'lodash';
import log from 'electron-log';
import { DatabaseService } from '../services';
import { logErrors } from '../errorLogger';

/**
 * Represents a database migration.
 *
 * @param name - The name of the migration.
 * @param up - Function to apply the migration.
 */
export interface Migration {
  name: string;
  up: (db: Database) => void;
}

/**
 * Class to handle database migrations.
 *
 * This class manages the process of applying database migrations. It reads migration
 * files from a specified directory, checks which migrations have already been applied,
 * and runs any pending migrations.
 *
 * To add a new migration:
 * 1. Create a new file in the 'migrations' directory.
 * 2. The file should export an object that implements the {@link Migration} interface.
 * 3. The object should have a unique 'name' property and an 'up' function that performs the migration.
 *
 * Example of a migration file:
 * ```
 * export const migration = {
 *   name: '001_create_users_table',
 *   up: (db: Database) => {
 *     db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`);
 *   }
 * };
 * ```
 *
 * The MigrationRunner will automatically detect and run new migrations in alphabetical order.
 */
@logErrors
export class MigrationRunner {
  private db: Database;

  private migrationsDir: string = __dirname;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.migrateUp();
    log.transports.file.level = 'info';
    log.transports.console.level = 'info';
  }

  private async ensureMigrationTable(): Promise<void> {
    const doesTableExist = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name='migrations';`,
      )
      .get();

    if (!get(doesTableExist, 1)) {
      log.info('Creating migrations table...');
      this.db
        .prepare(
          `CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'localtime'))
          )`,
        )
        .run();
    }
  }

  private async getAppliedMigrations(): Promise<string[]> {
    return this.db
      .prepare('SELECT name FROM migrations ORDER BY id')
      .all()
      .map((row: any) => String(row.name));
  }

  private async getMigrationFiles(): Promise<Record<string, Migration>[]> {
    const fileNames = fs
      .readdirSync(this.migrationsDir)
      .filter(
        (fileName) =>
          !fileName.includes('index') &&
          (fileName.endsWith('.ts') || fileName.endsWith('.js')),
      )
      .sort();
    const migrations = await Promise.all(
      fileNames.map((fileName) => {
        const filePath = path.join(this.migrationsDir, fileName);
        return import(filePath);
      }),
    );
    return migrations as Record<string, Migration>[];
  }

  private async migrateUp(): Promise<void> {
    await this.ensureMigrationTable();
    const appliedMigrations = await this.getAppliedMigrations();
    const migrationFiles = await this.getMigrationFiles();
    let migrationsApplied = false;

    for (const file of migrationFiles) {
      const migrationObj = Object.values(file)[0];
      if (!appliedMigrations.includes(migrationObj.name)) {
        log.info(`Applying migration: ${migrationObj.name}`);

        this.db.transaction(() => {
          migrationObj.up(this.db);
          this.db
            .prepare('INSERT INTO migrations (name) VALUES (?)')
            .run(migrationObj.name);
        })();

        log.info(`Migration ${migrationObj.name} applied successfully.`);
        migrationsApplied = true;
      }
    }

    if (!migrationsApplied) {
      log.info('No migration applied.');
    }
  }
}
