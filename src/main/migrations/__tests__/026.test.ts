/**
 * Migration 026 — repair the "Edited" stamp left by the original 024.
 *
 * The first shipped 024 rewrote invoice dates without suspending the
 * after-update timestamp trigger, so every converted row got
 * `updatedAt = now` and the whole imported history showed the Edited
 * indicator (`updatedAt > createdAt`). 026 resets `updatedAt = createdAt`
 * for bulk-stamp clusters (many invoices sharing one exact updatedAt) while
 * leaving genuine one-at-a-time edits alone.
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

const MIGRATIONS_DIR = path.join(__dirname, '..');

const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, '../../../sql/schema.sql'),
  'utf-8',
);

interface MigrationFile {
  name: string;
  up: (db: Database.Database) => true | Error;
}

const loadMigration = (file: string): MigrationFile =>
  // eslint-disable-next-line global-require, import/no-dynamic-require
  require(path.join(MIGRATIONS_DIR, file));

const migration026 = loadMigration('026.js');

const dbBefore026 = (): Database.Database => {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+\.js$/.test(f))
    .sort()
    .filter((f) => f < '026')
    .forEach((f) => expect(loadMigration(f).up(db)).toBe(true));
  return db;
};

const BULK_STAMP = '2026-08-31 10:15:42';

/**
 * Recreates the damage: `count` invoices bulk-stamped with one updatedAt
 * (the buggy-024 signature), one genuinely edited invoice with a unique
 * updatedAt, and one untouched invoice.
 */
const seed = (db: Database.Database, bulkCount: number): void => {
  db.exec(`
    INSERT INTO users (id, username, password_hash) VALUES (1, 'owner', 'x');
    INSERT INTO chart (id, name, userId, type) VALUES (1, 'Assets', 1, 'Asset');
    INSERT INTO account (id, chartId, name, code) VALUES (1, 1, 'Customer A', '1-1');
  `);
  const insert = db.prepare(
    `INSERT INTO invoices (id, invoiceNumber, accountId, invoiceType, date, totalAmount)
       VALUES (?, ?, 1, 'Sale', '2021-11-23T07:00:00.000Z', 100)`,
  );
  const stamp = db.prepare(
    `UPDATE invoices SET createdAt = ?, updatedAt = ? WHERE id = ?`,
  );
  db.exec('DROP TRIGGER IF EXISTS after_update_invoices_add_timestamp');
  for (let id = 1; id <= bulkCount; id += 1) {
    insert.run(id, id);
    stamp.run('2024-05-01 09:00:00', BULK_STAMP, id);
  }
  // a genuine single edit: unique updatedAt, must keep its indicator
  insert.run(9001, 9001);
  stamp.run('2024-05-01 09:00:00', '2025-02-14 16:03:31', 9001);
  // an untouched row: updatedAt equals createdAt
  insert.run(9002, 9002);
  stamp.run('2024-05-01 09:00:00', '2024-05-01 09:00:00', 9002);
  db.exec(`CREATE TRIGGER IF NOT EXISTS after_update_invoices_add_timestamp
    AFTER UPDATE ON invoices
    BEGIN
      UPDATE invoices SET
        updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
      WHERE id = NEW.id;
    END`);
};

const editedIds = (db: Database.Database): number[] =>
  (
    db
      .prepare(
        `SELECT id FROM invoices WHERE updatedAt > createdAt ORDER BY id`,
      )
      .all() as Array<{ id: number }>
  ).map(({ id }) => id);

describe('026_repair_invoice_updatedat_after_024', () => {
  let db: Database.Database;

  afterEach(() => db.close());

  it('clears the bulk stamp but keeps genuine single edits', () => {
    db = dbBefore026();
    seed(db, 50);
    expect(editedIds(db)).toHaveLength(51); // 50 bulk + 1 genuine

    expect(migration026.up(db)).toBe(true);

    expect(editedIds(db)).toEqual([9001]);
    // repaired rows are byte-equal to their createdAt
    const repaired = db
      .prepare(
        `SELECT count(*) c FROM invoices WHERE id <= 50 AND updatedAt = createdAt`,
      )
      .get() as { c: number };
    expect(repaired.c).toBe(50);
  });

  it('leaves small same-second groups (below threshold) alone', () => {
    db = dbBefore026();
    seed(db, 5); // 5 < BULK_THRESHOLD of 20 — plausibly human, not a migration

    expect(migration026.up(db)).toBe(true);

    expect(editedIds(db)).toHaveLength(6);
  });

  it('is a no-op on a clean database and idempotent after a repair', () => {
    db = dbBefore026();
    seed(db, 50);
    expect(migration026.up(db)).toBe(true);
    const after = db
      .prepare('SELECT id, createdAt, updatedAt FROM invoices ORDER BY id')
      .all();

    expect(migration026.up(db)).toBe(true);

    expect(
      db
        .prepare('SELECT id, createdAt, updatedAt FROM invoices ORDER BY id')
        .all(),
    ).toEqual(after);
  });

  it('restores the timestamp trigger for future real edits', () => {
    db = dbBefore026();
    seed(db, 50);
    expect(migration026.up(db)).toBe(true);

    const trigger = db
      .prepare(
        `SELECT count(*) c FROM sqlite_master
           WHERE type = 'trigger' AND name = 'after_update_invoices_add_timestamp'`,
      )
      .get() as { c: number };
    expect(trigger.c).toBe(1);
  });
});
