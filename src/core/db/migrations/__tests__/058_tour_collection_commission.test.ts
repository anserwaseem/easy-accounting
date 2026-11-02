import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { migration058 } from '../058_tour_collection_commission';

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

describe('core migration 058 (tour collection commission)', () => {
  let db: InstanceType<typeof Database>;
  let driver: BetterSqliteDriver;

  beforeEach(async () => {
    db = new Database(':memory:');
    driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);
  });

  afterEach(() => db.close());

  it('creates settlement table and account column', () => {
    const t = db
      .prepare(`PRAGMA table_info("agent_tour_collection_settlements")`)
      .all() as { name: string }[];
    expect(t.map((c) => c.name)).toContain('uuid');
    const c = db.prepare(`PRAGMA table_info("agent_commissions")`).all() as {
      name: string;
    }[];
    expect(c.map((col) => col.name)).toContain('tourCollectionRatePercent');
  });

  it('is idempotent', async () => {
    await expect(migration058.up(driver)).resolves.toBeUndefined();
  });

  it('captures insert', () => {
    const chartId = db
      .prepare(`INSERT INTO chart (name, type) VALUES ('Agent','Asset')`)
      .run().lastInsertRowid;
    db.prepare(
      `INSERT INTO agent_tour_collection_settlements (chartId, startDate, endDate) VALUES (?, '2026-01-01', '2026-01-31')`,
    ).run(chartId);
    const outbox = db
      .prepare(
        `SELECT COUNT(*) AS c FROM sync_outbox WHERE tableName = 'agent_tour_collection_settlements'`,
      )
      .get() as { c: number };
    expect(outbox.c).toBeGreaterThanOrEqual(1);
  });
});
