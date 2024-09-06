import type { Database } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { compact, get, isEmpty, reject } from 'lodash';
import log from 'electron-log';
import { app } from 'electron';
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

  private migrationsDir: string;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();

    const devMigrationsPath = __dirname;
    const prodMigrationsPath = path.join(
      process.resourcesPath,
      'migrations',
      // 'main',
      // 'migrations',
    );
    this.migrationsDir = app.isPackaged
      ? prodMigrationsPath
      : devMigrationsPath;

    log.info('App is packaged:', app.isPackaged);
    log.info('Migrations directory:', this.migrationsDir);
    log.info('Migrations directory exists:', fs.existsSync(this.migrationsDir));

    this.migrateUp();

    log.transports.file.level = 'debug';
    log.transports.console.level = 'debug';
  }

  private async ensureMigrationTable(): Promise<void> {
    log.info('MigrationRunner.ensureMigrationTable called');
    const doesTableExist = this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name='migrations';`,
      )
      .get();
    log.info('doesTableExist', doesTableExist);

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
    log.info('MigrationRunner.getAppliedMigrations called');
    return this.db
      .prepare('SELECT name FROM migrations ORDER BY id')
      .all()
      .map((row: any) => String(row.name));
  }

  private async getMigrationFiles(): Promise<Migration[]> {
    log.info('MigrationRunner.getMigrationFiles called');
    log.info('migrationsDir:', this.migrationsDir);

    const fileNames = fs
      .readdirSync(this.migrationsDir)
      .filter((fileName) => fileName.endsWith('.js'))
      .sort();
    log.info('Migration files:', fileNames);

    const migrations = await Promise.all(
      fileNames.map(async (fileName) => {
        const filePath = path.join(this.migrationsDir, fileName);
        // const resolvedPath =
        //   process.platform === 'win32'
        //     ? filePath.replace(/\\/g, '\\\\')
        //     : filePath;
        log.info(`Importing migration file - filePath: ${filePath}`);

        try {
          let migration;

          if (app.isPackaged) {
            // In production, use a dynamic require
            // migration = await import(filePath);
            // eslint-disable-next-line no-eval
            // migration = eval(`require('${filePath.replace(/\\/g, '\\\\')}')`); // HACK: using eval is bad practice

            // In production, read the file content and evaluate it
            let fileContent = fs.readFileSync(filePath, 'utf-8');
            log.info(0, fileContent);
            // Convert ES module syntax to CommonJS if necessary
            if (fileContent.includes('export default')) {
              fileContent = fileContent.replace(
                'export default',
                'module.exports =',
              );
            }
            log.info(1, fileContent);
            const wrappedContent = `(function(exports, require, module, __filename, __dirname) { ${fileContent} \n});`;
            log.info(2, wrappedContent);
            const compiledWrapper = require('vm').runInThisContext(
              wrappedContent,
              { filename: filePath },
            );
            const module = { exports: {} };
            compiledWrapper.call(
              module.exports,
              module.exports,
              require,
              module,
              filePath,
              path.dirname(filePath),
            );

            log.info(2, module);
            migration = module.exports;
          } else {
            // In development, use dynamic import
            migration = await import(filePath);
          }

          log.info(`Successfully imported migration: ${fileName}`);
          return migration.default || migration;
        } catch (error) {
          log.error(`Error importing migration ${fileName}:`, error);
          return null;
        }
      }),
    );
    return reject(compact(migrations), isEmpty);
  }

  private async migrateUp(): Promise<void> {
    await this.ensureMigrationTable();
    const appliedMigrations = await this.getAppliedMigrations();
    const migrationFiles = await this.getMigrationFiles();
    let migrationsApplied = false;

    log.info('in migrationUp', migrationFiles);
    for (const migrationObj of migrationFiles) {
      const migrationName = get(migrationObj, 'name');

      if (!appliedMigrations.includes(migrationName)) {
        log.info(`Applying migration: ${migrationName}`);

        this.db.transaction(() => {
          migrationObj.up(this.db);
          this.db
            .prepare('INSERT INTO migrations (name) VALUES (?)')
            .run(migrationName);
        })();

        log.info(`Migration ${migrationName} applied successfully.`);
        migrationsApplied = true;
      } else {
        log.info(`Ignoring migration: ${migrationName}`);
      }
    }

    if (!migrationsApplied) {
      log.info('No migration applied.');
    }
  }
}
