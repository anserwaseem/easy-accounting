import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { migration041 } from '../041_seed_existing_business_data_outbox';

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

describe('migration 041 — seed existing business data outbox', () => {
  it('seeds existing business records into sync_outbox and is idempotent', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);

    // Bootstrap database up to latest
    await bootstrapDatabase(driver);

    // Insert dummy business records (e.g. user, chart, account)
    db.prepare(
      `INSERT INTO users (username, password_hash) VALUES ('test', 'hash')`,
    ).run();
    const userId = (
      db.prepare(`SELECT id FROM users LIMIT 1`).get() as { id: number }
    ).id;
    db.prepare(
      `INSERT INTO chart (date, name, type, userId) VALUES ('2026-01-01', 'Test Chart', 'Asset', ?)`,
    ).run(userId);
    const chartId = (
      db.prepare(`SELECT id FROM chart WHERE name = 'Test Chart'`).get() as {
        id: number;
      }
    ).id;
    db.prepare(
      `INSERT INTO account (name, chartId, isActive) VALUES ('Test Account', ?, 1)`,
    ).run(chartId);

    // Clear sync_outbox to simulate pre-sync legacy data
    db.exec(`DELETE FROM sync_outbox`);
    expect(
      (
        db.prepare(`SELECT count(*) as c FROM sync_outbox`).get() as {
          c: number;
        }
      ).c,
    ).toBe(0);

    // Run migration 041
    await migration041.up(driver);

    const countAfterFirst = (
      db.prepare(`SELECT count(*) as c FROM sync_outbox`).get() as { c: number }
    ).c;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Verify account and chart are in sync_outbox
    const accountOutbox = db
      .prepare(`SELECT * FROM sync_outbox WHERE tableName = 'account'`)
      .all();
    expect(accountOutbox.length).toBeGreaterThan(0);

    // Run migration 041 again to verify idempotency (NOT EXISTS prevents duplication)
    await migration041.up(driver);
    const countAfterSecond = (
      db.prepare(`SELECT count(*) as c FROM sync_outbox`).get() as { c: number }
    ).c;
    expect(countAfterSecond).toBe(countAfterFirst);

    db.close();
  });
});
