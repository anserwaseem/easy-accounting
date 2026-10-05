import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { CORE_MIGRATIONS } from '..';
import { migration045 } from '../045_agent_tours';

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

interface OutboxRow {
  tableName: string;
  op: string;
  rowJson: string;
}

describe('core migration 045 (agent tours + account.collectionRole)', () => {
  let db: InstanceType<typeof Database>;
  let driver: BetterSqliteDriver;

  beforeEach(async () => {
    db = new Database(':memory:');
    driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);
  });

  afterEach(() => db.close());

  it('is the last CORE migration', () => {
    expect(CORE_MIGRATIONS[CORE_MIGRATIONS.length - 1].name).toBe(
      '045_agent_tours',
    );
  });

  it('creates agent_tours and account.collectionRole on a fresh bootstrap', () => {
    const tourCols = db.prepare(`PRAGMA table_info("agent_tours")`).all() as {
      name: string;
    }[];
    expect(tourCols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'chartId',
        'name',
        'startDate',
        'endDate',
        'notes',
        'uuid',
      ]),
    );
    const accountCols = db.prepare(`PRAGMA table_info("account")`).all() as {
      name: string;
    }[];
    expect(accountCols.map((c) => c.name)).toContain('collectionRole');
  });

  it('is idempotent', async () => {
    await expect(migration045.up(driver)).resolves.toBeUndefined();
    await expect(migration045.up(driver)).resolves.toBeUndefined();
  });

  it('rejects an unknown collectionRole and an end before start', () => {
    const chartId = db
      .prepare(`INSERT INTO chart (name, type) VALUES ('Agent', 'Asset')`)
      .run().lastInsertRowid;
    expect(() =>
      db
        .prepare(
          `INSERT INTO account (chartId, name, collectionRole) VALUES (?, 'A', 'bogus')`,
        )
        .run(chartId),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO agent_tours (chartId, name, startDate, endDate) VALUES (?, 'T', '2026-02-10', '2026-02-01')`,
        )
        .run(chartId),
    ).toThrow();
  });

  it('captures agent_tours rows and the new account column into the outbox', () => {
    const chartId = db
      .prepare(`INSERT INTO chart (name, type) VALUES ('Agent', 'Asset')`)
      .run().lastInsertRowid;
    const accountId = db
      .prepare(`INSERT INTO account (chartId, name) VALUES (?, 'Cash')`)
      .run(chartId).lastInsertRowid;
    db.prepare(`DELETE FROM sync_outbox`).run();

    db.prepare(
      `UPDATE account SET collectionRole = 'receipt' WHERE id = ?`,
    ).run(accountId);
    db.prepare(
      `INSERT INTO agent_tours (chartId, name, startDate) VALUES (?, 'Oct 2026', '2026-10-01')`,
    ).run(chartId);

    const rows = db
      .prepare(`SELECT tableName, op, rowJson FROM sync_outbox ORDER BY id`)
      .all() as OutboxRow[];
    const accountPut = rows.find((r) => r.tableName === 'account');
    expect(JSON.parse(accountPut!.rowJson).collectionRole).toBe('receipt');
    const tourPut = rows.find((r) => r.tableName === 'agent_tours');
    const tourJson = JSON.parse(tourPut!.rowJson);
    expect(tourJson.name).toBe('Oct 2026');
    expect(tourJson.chartId_uuid).toEqual(expect.any(String));
    expect(tourJson.uuid).toEqual(expect.any(String));
  });

  it('fills timestamps on insert', () => {
    const chartId = db
      .prepare(`INSERT INTO chart (name, type) VALUES ('Agent', 'Asset')`)
      .run().lastInsertRowid;
    const id = db
      .prepare(
        `INSERT INTO agent_tours (chartId, name, startDate) VALUES (?, 'T', '2026-10-01')`,
      )
      .run(chartId).lastInsertRowid;
    const row = db
      .prepare(`SELECT createdAt, updatedAt FROM agent_tours WHERE id = ?`)
      .get(id) as { createdAt: string | null; updatedAt: string | null };
    expect(row.createdAt).not.toBeNull();
    expect(row.updatedAt).toBe(row.createdAt);
  });
});
