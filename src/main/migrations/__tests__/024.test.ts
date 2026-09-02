/**
 * Migration 024 — normalize imported invoice dates.
 *
 * The bulk import wrote `invoices.date` as US-style strings ('11/23/2021')
 * while the app writes ISO ('2026-01-01' / '2026-08-28T07:00:00.000Z'), and
 * every date filter is a string comparison, so imported rows silently drop
 * out of date-ranged reports. 024 rewrites the slash form to ISO and must
 * leave everything else exactly as it found it.
 *
 * This file covers the data transform itself — the general runner behaviour
 * (fresh install, upgrade path, idempotent re-run of the whole chain) lives
 * in migrations.test.ts.
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

const migration024 = loadMigration('024.js');

/**
 * A database exactly as it stands the moment 024 runs: packaged schema plus
 * every earlier migration (017 adds `returnedAt`, which schema.sql lacks).
 */
const dbBefore024 = (): Database.Database => {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+\.js$/.test(f))
    .sort()
    .filter((f) => f < '024')
    .forEach((f) => expect(loadMigration(f).up(db)).toBe(true));
  return db;
};

/** id → [date, returnedAt] covering every input shape 024 must handle. */
const FIXTURES: Record<number, [string, string | null]> = {
  // imported MM/DD/YYYY, day > 12 proving month-first parsing
  1: ['11/23/2021', null],
  // imported MM/DD/YYYY, both tokens <= 12
  2: ['01/05/2008', null],
  // unpadded M/D/YYYY variant
  3: ['1/5/2021', null],
  // system-generated ISO forms must pass through untouched
  4: ['2026-01-01', null],
  5: ['2026-08-28T07:00:00.000Z', '2026-04-13 17:11:05'],
  // leap-day boundary cases: 2/29 valid in 2020, not in 2021
  6: ['02/29/2020', null],
  7: ['02/29/2021', null],
  // unparseable: month 13, day 32, zero month, free text, empty string
  8: ['13/01/2021', null],
  9: ['01/32/2021', null],
  10: ['00/05/2021', null],
  11: ['not a date', null],
  12: ['', null],
  // returnedAt in the imported form is converted too
  13: ['06/07/2022', '06/09/2022'],
};

const EXPECTED: Record<number, [string, string | null]> = {
  1: ['2021-11-23T07:00:00.000Z', null],
  2: ['2008-01-05T07:00:00.000Z', null],
  3: ['2021-01-05T07:00:00.000Z', null],
  4: ['2026-01-01', null],
  5: ['2026-08-28T07:00:00.000Z', '2026-04-13 17:11:05'],
  6: ['2020-02-29T07:00:00.000Z', null],
  7: ['02/29/2021', null],
  8: ['13/01/2021', null],
  9: ['01/32/2021', null],
  10: ['00/05/2021', null],
  11: ['not a date', null],
  12: ['', null],
  13: ['2022-06-07T07:00:00.000Z', '2022-06-09T07:00:00.000Z'],
};

const seed = (db: Database.Database): void => {
  db.exec(`
    INSERT INTO users (id, username, password_hash) VALUES (1, 'owner', 'x');
    INSERT INTO chart (id, name, userId, type) VALUES (1, 'Assets', 1, 'Asset');
    INSERT INTO account (id, chartId, name, code) VALUES (1, 1, 'Customer A', '1-1');
  `);
  const insert = db.prepare(
    `INSERT INTO invoices (id, invoiceNumber, accountId, invoiceType, date, returnedAt, totalAmount)
       VALUES (?, ?, 1, 'Sale', ?, ?, 100)`,
  );
  Object.entries(FIXTURES).forEach(([id, [date, returnedAt]]) =>
    insert.run(Number(id), Number(id), date, returnedAt),
  );
};

const snapshot = (db: Database.Database) =>
  db
    .prepare('SELECT id, date, returnedAt FROM invoices ORDER BY id')
    .all() as Array<{ id: number; date: string; returnedAt: string | null }>;

describe('024_normalize_invoice_date_format', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = dbBefore024();
    seed(db);
  });

  afterEach(() => db.close());

  it('converts every slash form, leaves ISO and unparseable rows untouched', () => {
    expect(migration024.up(db)).toBe(true);

    snapshot(db).forEach(({ id, date, returnedAt }) => {
      expect([id, date, returnedAt]).toEqual([id, ...EXPECTED[id]]);
    });
  });

  it('loses no rows and never writes NULL into a date', () => {
    const before = snapshot(db).length;

    expect(migration024.up(db)).toBe(true);

    const after = snapshot(db);
    expect(after).toHaveLength(before);
    expect(after.every(({ date }) => date !== null)).toBe(true);
  });

  it('is idempotent: a second run changes nothing', () => {
    expect(migration024.up(db)).toBe(true);
    const first = snapshot(db);

    expect(migration024.up(db)).toBe(true);

    expect(snapshot(db)).toEqual(first);
  });

  it('preserves createdAt/updatedAt so converted rows do not read as edited', () => {
    // the invoices "Edited" indicator is `updatedAt > createdAt`; the date
    // rewrite is a repair, not an edit, so the timestamp trigger must not
    // stamp converted rows
    const stamps = () =>
      db
        .prepare('SELECT id, createdAt, updatedAt FROM invoices ORDER BY id')
        .all() as Array<{ id: number; createdAt: string; updatedAt: string }>;
    const before = stamps();
    expect(
      before.every(({ createdAt, updatedAt }) => updatedAt === createdAt),
    ).toBe(true);

    expect(migration024.up(db)).toBe(true);

    expect(stamps()).toEqual(before);

    // and the trigger is back afterward: a real edit stamps updatedAt again
    // (backdate first — the trigger has second granularity)
    db.prepare(
      `UPDATE invoices SET updatedAt = '2000-01-01 00:00:00' WHERE id = 1`,
    ).run();
    db.prepare(`UPDATE invoices SET totalAmount = 200 WHERE id = 1`).run();
    const edited = stamps().find(({ id }) => id === 1);
    expect(edited?.updatedAt).not.toBe('2000-01-01 00:00:00');
  });

  it('makes imported rows visible to string-compare date range filters', () => {
    const inRange = () =>
      (
        db
          .prepare(
            `SELECT count(*) c FROM invoices WHERE date >= ? AND date < ?`,
          )
          .get('2021-01-01', '2022-01-01') as { c: number }
      ).c;

    // the string comparison the reports use: slash dates sort below every
    // ISO date, so the imported 2021 rows are invisible before the fix
    expect(inRange()).toBe(0);

    expect(migration024.up(db)).toBe(true);

    // ids 1, 3 and the invalid-leap-day row stays out; 11/23 and 1/5 land in 2021
    expect(inRange()).toBe(2);
  });
});
