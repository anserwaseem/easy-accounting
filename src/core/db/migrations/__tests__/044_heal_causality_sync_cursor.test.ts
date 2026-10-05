import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { migration044 } from '../044_heal_causality_sync_cursor';

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

describe('migration 044 — heal causality sync cursor', () => {
  it('resets cursor to 0 and clears stale sync_apply_conflicts', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);

    // Bootstrap database up to latest
    await bootstrapDatabase(driver);

    // Set a non-zero cursor
    db.prepare(
      `INSERT INTO sync_state (key, value) VALUES ('cursor', '15200')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();

    // Insert a dummy conflict
    db.prepare(
      `INSERT INTO sync_apply_conflicts (seq, rowUuid, tableName, op, error, rowJson, createdAt)
       VALUES (10, 'some-uuid', 'inventory', 'put', 'cannot resolve inventory.parentId_uuid', '{}', '2026-10-01 10:00:00')`,
    ).run();

    const cursorBefore = (
      db.prepare(`SELECT value FROM sync_state WHERE key = 'cursor'`).get() as {
        value: string;
      }
    ).value;
    expect(cursorBefore).toBe('15200');

    const conflictsBefore = (
      db.prepare(`SELECT count(*) as c FROM sync_apply_conflicts`).get() as {
        c: number;
      }
    ).c;
    expect(conflictsBefore).toBe(1);

    // Run migration 044
    await migration044.up(driver);

    const cursorAfter = (
      db.prepare(`SELECT value FROM sync_state WHERE key = 'cursor'`).get() as {
        value: string;
      }
    ).value;
    expect(cursorAfter).toBe('0');

    const conflictsAfter = (
      db.prepare(`SELECT count(*) as c FROM sync_apply_conflicts`).get() as {
        c: number;
      }
    ).c;
    expect(conflictsAfter).toBe(0);

    // Running again is idempotent
    await migration044.up(driver);
    const cursorAfterSecond = (
      db.prepare(`SELECT value FROM sync_state WHERE key = 'cursor'`).get() as {
        value: string;
      }
    ).value;
    expect(cursorAfterSecond).toBe('0');

    db.close();
  });
});
