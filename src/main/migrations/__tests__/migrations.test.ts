/**
 * Migration regression tests.
 *
 * These exercise the real MigrationRunner against real migration files and the
 * real `src/sql/schema.sql`, because the failure this guards against is not a
 * unit-level one: a migration that throws on a customer's database stops the
 * run, and every service built immediately afterwards prepares its statements
 * against a schema that is missing the table it expects. The symptom is an app
 * that will not open, on a machine nobody can attach a debugger to.
 *
 * Two paths reach a released build, and both have to work:
 *
 *   fresh install   schema.sql already contains every table, then all
 *                   migrations run against it and must no-op cleanly.
 *   upgrade         an existing database sitting on an older migration, where
 *                   only the new ones apply and existing rows must survive.
 *
 * The upgrade fixture is pinned at 019 because that is what shipped before
 * attributes and price lists. It is a historical snapshot and does not move as
 * new migrations land; the fresh-install and idempotency cases below cover
 * those automatically.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

jest.mock('electron', () => ({
  app: { isPackaged: false, getPath: jest.fn(() => '/tmp') },
}));

jest.mock('electron-log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  verbose: jest.fn(),
  debug: jest.fn(),
  silly: jest.fn(),
  transports: {
    file: { level: 'debug', getFile: jest.fn(() => ({ path: '/tmp/log' })) },
    console: { level: 'debug' },
  },
}));

const mockGetDatabase = jest.fn();
jest.mock('../../services', () => ({
  DatabaseService: {
    getInstance: () => ({ getDatabase: mockGetDatabase }),
  },
}));

// eslint-disable-next-line import/first
import { MigrationRunner } from '..';

const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, '../../../sql/schema.sql'),
  'utf-8',
);

const MIGRATIONS_DIR = path.join(__dirname, '..');

/** Everything migrations 020-023 introduce, so the 019 fixture can be cut back. */
const POST_019 = {
  tables: ['inventory_prices', 'price_lists', 'attribute_definitions'],
  columns: {
    inventory: ['parentId', 'attributes', 'excludeFromCatalog', 'title'],
  } as Record<string, string[]>,
};

const migrationNames = (): string[] =>
  fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+\.js$/.test(f))
    .sort()
    // eslint-disable-next-line global-require, import/no-dynamic-require
    .map((f) => require(path.join(MIGRATIONS_DIR, f)).name as string);

const freshDb = (): Database.Database => {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
};

/** Run the real runner against a database. */
const migrate = async (db: Database.Database): Promise<void> => {
  mockGetDatabase.mockReturnValue(db);
  const runner = new MigrationRunner();
  await runner.waitForMigrations();
};

/** better-sqlite3 types .get() as unknown; every query here is a known shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const row = (db: Database.Database, sql: string, ...params: unknown[]): any =>
  db.prepare(sql).get(...params);

const count = (db: Database.Database, sql: string, ...params: unknown[]) =>
  row(db, sql, ...params).c as number;

const tableExists = (db: Database.Database, name: string): boolean =>
  count(
    db,
    `SELECT count(*) c FROM sqlite_master WHERE type='table' AND name=?`,
    name,
  ) > 0;

const columnExists = (
  db: Database.Database,
  table: string,
  column: string,
): boolean =>
  count(
    db,
    `SELECT count(*) c FROM pragma_table_info(?) WHERE name=?`,
    table,
    column,
  ) > 0;

const appliedNames = (db: Database.Database): string[] =>
  db
    .prepare('SELECT name FROM migrations ORDER BY id')
    .all()
    .map((r: any) => String(r.name));

/**
 * Turn a current-schema database into one that looks like it was last touched
 * by migration 019: drop what 020-023 added, and record 001-019 as applied.
 */
const rollbackTo019 = (db: Database.Database): void => {
  db.pragma('foreign_keys = OFF');

  db.prepare(
    `SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN (${POST_019.tables
      .map(() => '?')
      .join(',')})`,
  )
    .all(...POST_019.tables)
    .forEach((r: any) => db.exec(`DROP TRIGGER IF EXISTS "${r.name}"`));

  POST_019.tables.forEach((t) => db.exec(`DROP TABLE IF EXISTS "${t}"`));

  Object.entries(POST_019.columns).forEach(([table, columns]) => {
    columns.forEach((column) => {
      if (!columnExists(db, table, column)) return;
      // An index over the column blocks DROP COLUMN, so clear those first.
      db.prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql LIKE ?`,
      )
        .all(table, `%${column}%`)
        .forEach((r: any) => db.exec(`DROP INDEX IF EXISTS "${r.name}"`));
      db.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
    });
  });

  // schema.sql does not carry the migrations table; the runner creates it on
  // first launch, so a 019 database already has one.
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'localtime'))
    )
  `);

  const names = migrationNames().filter((n) => n < '020');
  const insert = db.prepare('INSERT INTO migrations (name) VALUES (?)');
  db.transaction(() => names.forEach((n) => insert.run(n)))();
};

/** Representative rows across the tables a customer would actually have. */
const seedData = (db: Database.Database): void => {
  db.exec(`
    INSERT INTO users (id, username, password_hash) VALUES (1, 'owner', 'x');
    INSERT INTO chart (id, name, userId, type) VALUES (1, 'Assets', 1, 'Asset');
    INSERT INTO account (id, chartId, name, code) VALUES (1, 1, 'Customer A', '1-1');
    INSERT INTO inventory (id, name, price, quantity)
      VALUES (1, 'S-23', 810, 5), (2, 'S-23-G', 950, 2);
    INSERT INTO invoices (id, invoiceNumber, accountId, invoiceType, date, totalAmount)
      VALUES (1, 1001, 1, 'Sale', '2026-01-01', 1620);
    INSERT INTO invoice_items (id, invoiceId, inventoryId, quantity, price)
      VALUES (1, 1, 1, 2, 810);
  `);
};

describe('migrations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('every migration file returns true, which is the runner contract', () => {
    const db = freshDb();
    fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+\.js$/.test(f))
      .sort()
      .forEach((file) => {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const migration = require(path.join(MIGRATIONS_DIR, file));
        expect(typeof migration.name).toBe('string');
        expect(migration.up(db)).toBe(true);
      });
    db.close();
  });

  describe('fresh install', () => {
    it('applies every migration against the packaged schema', async () => {
      const db = freshDb();
      await migrate(db);

      expect(appliedNames(db)).toEqual(migrationNames());
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      db.close();
    });

    it('is a no-op on the second launch', async () => {
      const db = freshDb();
      await migrate(db);
      const first = appliedNames(db);

      await migrate(db);

      expect(appliedNames(db)).toEqual(first);
      db.close();
    });
  });

  describe('upgrading a database left on 019', () => {
    let db: Database.Database;

    beforeEach(async () => {
      db = freshDb();
      rollbackTo019(db);
      seedData(db);
    });

    afterEach(() => db.close());

    it('starts from a genuine 019 state', () => {
      expect(appliedNames(db)).toHaveLength(19);
      POST_019.tables.forEach((t) => expect(tableExists(db, t)).toBe(false));
      POST_019.columns.inventory.forEach((c) =>
        expect(columnExists(db, 'inventory', c)).toBe(false),
      );
    });

    it('applies only the missing migrations', async () => {
      await migrate(db);

      expect(appliedNames(db)).toEqual(migrationNames());
      expect(appliedNames(db).slice(19)).toEqual([
        '020_add_attributes_families_and_price_lists',
        '021_add_attribute_isPublic',
        '022_add_inventory_excludeFromCatalog',
        '023_add_inventory_title',
        '024_normalize_invoice_date_format',
        '025_add_customer_groups',
      ]);
    });

    it('creates the tables and columns the services expect', async () => {
      await migrate(db);

      POST_019.tables.forEach((t) => expect(tableExists(db, t)).toBe(true));
      POST_019.columns.inventory.forEach((c) =>
        expect(columnExists(db, 'inventory', c)).toBe(true),
      );
      expect(columnExists(db, 'attribute_definitions', 'isPublic')).toBe(true);
    });

    it('leaves existing rows untouched', async () => {
      const rows = (t: string) => count(db, `SELECT count(*) c FROM ${t}`);
      const before = {
        inventory: rows('inventory'),
        invoices: rows('invoices'),
        invoiceItems: rows('invoice_items'),
        account: rows('account'),
      };

      await migrate(db);

      expect(rows('inventory')).toBe(before.inventory);
      expect(rows('invoices')).toBe(before.invoices);
      expect(rows('invoice_items')).toBe(before.invoiceItems);
      expect(rows('account')).toBe(before.account);
      expect(row(db, `SELECT name FROM inventory WHERE id = 1`).name).toBe(
        'S-23',
      );
    });

    it('leaves the new columns empty rather than guessing a value', async () => {
      await migrate(db);

      expect(
        count(
          db,
          `SELECT count(*) c FROM inventory
             WHERE parentId IS NOT NULL OR attributes IS NOT NULL OR title IS NOT NULL`,
        ),
      ).toBe(0);
    });

    it('leaves the database consistent', async () => {
      await migrate(db);

      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_key_check')).toEqual([]);
    });

    it('is a no-op if the upgrade is run again', async () => {
      await migrate(db);
      const first = appliedNames(db);

      await migrate(db);

      expect(appliedNames(db)).toEqual(first);
    });
  });
});
