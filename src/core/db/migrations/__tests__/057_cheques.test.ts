import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { migration057 } from '../057_cheques';

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

describe('core migration 057 (cheques)', () => {
  let db: InstanceType<typeof Database>;
  let driver: BetterSqliteDriver;

  beforeEach(async () => {
    db = new Database(':memory:');
    driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);
  });

  afterEach(() => db.close());

  it('creates cheque tables', () => {
    for (const t of [
      'cheques',
      'cheque_allocations',
      'cheque_presentments',
      'cheque_custody_events',
    ]) {
      const cols = db.prepare(`PRAGMA table_info("${t}")`).all() as {
        name: string;
      }[];
      expect(cols.map((c) => c.name)).toContain('uuid');
    }
  });

  it('is idempotent', async () => {
    await expect(migration057.up(driver)).resolves.toBeUndefined();
  });

  it('captures an insert into sync_outbox', () => {
    const chartId = db
      .prepare(
        `INSERT INTO chart (name, type, userId) VALUES ('Agent', 'Asset', 1)`,
      )
      .run().lastInsertRowid;
    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES ('u','x',1)`,
    ).run();
    // users row above may conflict; tolerate by using existing
    db.prepare(
      `INSERT INTO cheques (chartId, chequeNumber, amount, receivedDate) VALUES (?, 'C1', 10, '2026-01-01')`,
    ).run(chartId);
    const outbox = db
      .prepare(
        `SELECT COUNT(*) AS c FROM sync_outbox WHERE tableName = 'cheques'`,
      )
      .get() as { c: number };
    expect(outbox.c).toBeGreaterThanOrEqual(1);
  });
});
