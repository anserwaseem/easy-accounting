import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { CORE_MIGRATIONS } from '..';

jest.mock('electron-log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  verbose: jest.fn(),
  debug: jest.fn(),
  silly: jest.fn(),
  transports: {
    file: { level: 'debug', getFile: jest.fn() },
    console: { level: 'debug' },
  },
}));

const tableExists = (db: Database.Database, name: string): boolean =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?`,
      )
      .get(name) as { c: number }
  ).c > 0;

const appliedNames = (db: Database.Database): string[] =>
  (
    db.prepare('SELECT name FROM migrations ORDER BY id').all() as {
      name: string;
    }[]
  ).map((r) => r.name);

describe('core migration 028 (settings table) — platform-free runner', () => {
  it('is registered exactly once in CORE_MIGRATIONS', () => {
    const matches = CORE_MIGRATIONS.filter(
      (m) => m.name === '028_create_settings_table',
    );
    expect(matches).toHaveLength(1);
  });

  it('creates the settings table on a fresh bootstrap', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    expect(tableExists(db, 'settings')).toBe(true);
    expect(
      appliedNames(db).filter((n) => n === '028_create_settings_table'),
    ).toHaveLength(1);
    db.close();
  });

  it('runs exactly once across repeated bootstraps (idempotent)', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);

    await bootstrapDatabase(driver);
    await bootstrapDatabase(driver);
    await bootstrapDatabase(driver);

    expect(
      appliedNames(db).filter((n) => n === '028_create_settings_table'),
    ).toHaveLength(1);
    db.close();
  });

  it('the settings table itself survives a repeated bootstrap with rows intact', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    db.prepare(
      `INSERT INTO settings (key, value, updatedAt) VALUES ('k', '"v"', '2026-01-01T00:00:00.000Z')`,
    ).run();

    await bootstrapDatabase(driver);

    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'k'`)
      .get() as { value: string } | undefined;
    expect(row?.value).toBe('"v"');
    db.close();
  });
});
