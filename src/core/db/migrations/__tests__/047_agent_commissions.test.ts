import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { migration047 } from '../047_agent_commissions';

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

describe('migration 047 — agent commissions and settlements', () => {
  it('applies cleanly via bootstrapDatabase on an empty database', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    const tables = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'agent_%'`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toContain('agent_commissions');
    expect(tables).toContain('agent_commission_settlements');

    // unique indexes on uuid
    const indexes = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_agent_%_uuid'`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(indexes).toContain('idx_agent_commissions_uuid');
    expect(indexes).toContain('idx_agent_commission_settlements_uuid');

    db.close();
  });

  it('calling migration047.up is idempotent', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    await expect(migration047.up(driver)).resolves.not.toThrow();

    db.close();
  });

  it('assigns uuid, timestamps, and outbox capture on row insert & update', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    // Seed parent chart
    const chart = db
      .prepare(
        `INSERT INTO chart (name, type, parentId) VALUES ('Ijaz Parties', 'Asset', 2)`,
      )
      .run();
    const chartId = Number(chart.lastInsertRowid);

    // Insert into agent_commissions
    const ratesJson = JSON.stringify([
      { itemTypeId: 1, percent: 5.0, netRatePercent: 2.5 },
    ]);
    const overridesJson = JSON.stringify([
      { inventoryId: 239, rupeesPerUnit: 5.0 },
    ]);

    const insertResult = db
      .prepare(
        `INSERT INTO agent_commissions (chartId, ratesJson, overridesJson)
         VALUES (?, ?, ?)`,
      )
      .run(chartId, ratesJson, overridesJson);
    const rowId = Number(insertResult.lastInsertRowid);

    const row = db
      .prepare(`SELECT * FROM agent_commissions WHERE id = ?`)
      .get(rowId) as {
      uuid: string | null;
      createdAt: string | null;
      updatedAt: string | null;
      ratesJson: string;
    };

    expect(row.uuid).toBeDefined();
    expect(typeof row.uuid).toBe('string');
    expect(row.uuid?.length).toBe(36);
    expect(row.createdAt).toBeDefined();
    expect(row.updatedAt).toBeDefined();

    // Verify outbox entry
    const outboxInsert = db
      .prepare(
        `SELECT * FROM sync_outbox WHERE tableName = 'agent_commissions' AND rowUuid = ? AND op = 'put'`,
      )
      .get(row.uuid) as { rowJson: string };
    expect(outboxInsert).toBeDefined();
    const parsedInsertJson = JSON.parse(outboxInsert.rowJson);
    expect(parsedInsertJson.chartId).toBe(chartId);
    expect(JSON.parse(parsedInsertJson.ratesJson)).toEqual([
      { itemTypeId: 1, percent: 5.0, netRatePercent: 2.5 },
    ]);

    // Update row and verify update trigger & outbox
    const updatedRatesJson = JSON.stringify([
      { itemTypeId: 1, percent: 6.0, netRatePercent: 3.0 },
    ]);
    db.prepare(`UPDATE agent_commissions SET ratesJson = ? WHERE id = ?`).run(
      updatedRatesJson,
      rowId,
    );

    const outboxEntries = db
      .prepare(
        `SELECT * FROM sync_outbox WHERE tableName = 'agent_commissions' AND rowUuid = ? AND op = 'put'`,
      )
      .all(row.uuid) as { rowJson: string }[];

    expect(outboxEntries.length).toBe(2);
    const lastEntry = JSON.parse(
      outboxEntries[outboxEntries.length - 1].rowJson,
    );
    expect(JSON.parse(lastEntry.ratesJson)[0].percent).toBe(6);

    db.close();
  });
});
