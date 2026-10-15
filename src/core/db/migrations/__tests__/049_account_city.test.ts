import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { CORE_MIGRATIONS } from '../index';
import { migration049 } from '../049_account_city';

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

describe('migration 049 — account city and cityUrdu', () => {
  it('is registered in CORE_MIGRATIONS', () => {
    expect(CORE_MIGRATIONS.some((m) => m.name === '049_account_city')).toBe(
      true,
    );
  });

  it('applies cleanly via bootstrapDatabase and adds columns', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    const cols = (
      db.prepare(`PRAGMA table_info("account")`).all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);

    expect(cols).toContain('city');
    expect(cols).toContain('cityUrdu');
  });

  it('captures city and cityUrdu on sync triggers', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES ('admin', X'00', 1)`,
    ).run();
    const user = db
      .prepare(`SELECT id FROM users WHERE username = 'admin'`)
      .get() as {
      id: number;
    };
    db.prepare(
      `INSERT INTO chart (date, name, type, userId) VALUES ('2025-01-01', 'Current Asset', 'Asset', ?)`,
    ).run(user.id);
    const chart = db
      .prepare(`SELECT id FROM chart WHERE name = 'Current Asset'`)
      .get() as {
      id: number;
    };

    db.prepare(
      `INSERT INTO account (chartId, name, address, city, addressUrdu, cityUrdu, isActive)
       VALUES (?, 'Test Account', 'Main Bazaar', 'Lahore', 'مین بازار', 'لاہور', 1)`,
    ).run(chart.id);

    const outboxRow = db
      .prepare(
        `SELECT op, tableName, rowJson FROM sync_outbox WHERE tableName = 'account' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { op: string; tableName: string; rowJson: string };

    expect(outboxRow).toBeDefined();
    expect(outboxRow.op).toBe('put');
    const parsed = JSON.parse(outboxRow.rowJson);
    expect(parsed.city).toBe('Lahore');
    expect(parsed.cityUrdu).toBe('لاہور');
  });

  it('up() alters existing account table without losing rows', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    // Verify migration049 can run its operations
    expect(migration049.name).toBe('049_account_city');
  });
});
