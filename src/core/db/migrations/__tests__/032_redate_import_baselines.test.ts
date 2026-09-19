import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { CORE_MIGRATIONS } from '..';
import {
  INVENTORY_BASELINE_DATE,
  INVENTORY_BASELINE_REASON,
} from '../../inventoryBaselineBackfill';

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

/** Frozen historical value 032 targets — see that migration's doc comment. */
const OLD_BASELINE_REASON =
  'Import baseline: carried from desktop stored quantity';

interface OutboxRow {
  id: number;
  tableName: string;
  rowUuid: string;
  op: string;
  rowJson: string;
}

describe('core migration 032 (re-date import baselines)', () => {
  it('is registered exactly once in CORE_MIGRATIONS, immediately after 031', () => {
    const names = CORE_MIGRATIONS.map((m) => m.name);
    expect(
      names.filter((n) => n === '032_redate_import_baselines'),
    ).toHaveLength(1);
    expect(names.indexOf('032_redate_import_baselines')).toBe(
      names.indexOf('031_replicate_blob_columns') + 1,
    );
  });

  it('re-dates and renames only rows carrying the old baseline reason, leaves an unrelated adjustment untouched, is a no-op on a second run, and syncs the change via the capture trigger', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    // Fully bootstrapped (including 032 itself, a no-op with no matching
    // rows yet) — the exact state a real device is in.
    await bootstrapDatabase(driver);

    db.prepare(
      `INSERT INTO inventory (name, price, quantity) VALUES ('Widget', 50, 100)`,
    ).run();
    const inventoryId = (
      db.prepare(`SELECT id FROM inventory WHERE name = 'Widget'`).get() as {
        id: number;
      }
    ).id;

    // Simulate a device that already ran the OLD backfillInventoryBaseline
    // before this change: a baseline row dated import-day under the old
    // reason literal.
    db.prepare(
      `INSERT INTO stock_adjustments (inventoryId, quantityDelta, reason, date) VALUES (?, ?, ?, ?)`,
    ).run(inventoryId, 110, OLD_BASELINE_REASON, '2026-08-15');

    // An unrelated, genuine stock adjustment that must survive untouched.
    db.prepare(
      `INSERT INTO stock_adjustments (inventoryId, quantityDelta, reason, date) VALUES (?, ?, ?, ?)`,
    ).run(inventoryId, -5, 'Damaged in transit', '2026-05-01');

    // Isolate migration 032's own effect from whatever the inserts above
    // captured into sync_outbox.
    db.exec(`DELETE FROM sync_outbox`);

    const migration032 = CORE_MIGRATIONS.find(
      (m) => m.name === '032_redate_import_baselines',
    )!;
    await migration032.up(driver);

    const rows = db
      .prepare(
        `SELECT quantityDelta, reason, date FROM stock_adjustments ORDER BY id`,
      )
      .all() as { quantityDelta: number; reason: string; date: string }[];
    expect(rows).toHaveLength(2);

    const baseline = rows.find((r) => r.quantityDelta === 110)!;
    expect(baseline.reason).toBe(INVENTORY_BASELINE_REASON);
    expect(baseline.date).toBe(INVENTORY_BASELINE_DATE);

    const unrelated = rows.find((r) => r.quantityDelta === -5)!;
    expect(unrelated.reason).toBe('Damaged in transit');
    expect(unrelated.date).toBe('2026-05-01');

    // The UPDATE went through the normal driver.run path, so migration
    // 029's capture trigger fired and pushed a corrective row image.
    const outboxRows = db
      .prepare(
        `SELECT id, tableName, rowUuid, op, rowJson FROM sync_outbox WHERE tableName = 'stock_adjustments'`,
      )
      .all() as OutboxRow[];
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].op).toBe('put');
    const captured = JSON.parse(outboxRows[0].rowJson) as {
      reason: string;
      date: string;
    };
    expect(captured.reason).toBe(INVENTORY_BASELINE_REASON);
    expect(captured.date).toBe(INVENTORY_BASELINE_DATE);

    // Second run: WHERE clause matches nothing (reason is already the new
    // value) — idempotent by construction, no further sync_outbox rows.
    db.exec(`DELETE FROM sync_outbox`);
    await migration032.up(driver);

    const rowsAfterSecondRun = db
      .prepare(`SELECT reason, date FROM stock_adjustments ORDER BY id`)
      .all();
    expect(rowsAfterSecondRun).toEqual([
      { reason: INVENTORY_BASELINE_REASON, date: INVENTORY_BASELINE_DATE },
      { reason: 'Damaged in transit', date: '2026-05-01' },
    ]);
    const outboxAfterSecondRun = db
      .prepare(`SELECT COUNT(*) c FROM sync_outbox`)
      .get() as { c: number };
    expect(outboxAfterSecondRun.c).toBe(0);

    db.close();
  });

  it('via bootstrapDatabase, runs exactly once per database (bookkeeping table guard) even across repeated bootstraps', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);

    await bootstrapDatabase(driver);
    await bootstrapDatabase(driver);
    await bootstrapDatabase(driver);

    const applied = db
      .prepare(
        `SELECT COUNT(*) AS c FROM migrations WHERE name = '032_redate_import_baselines'`,
      )
      .get() as { c: number };
    expect(applied.c).toBe(1);

    db.close();
  });
});
