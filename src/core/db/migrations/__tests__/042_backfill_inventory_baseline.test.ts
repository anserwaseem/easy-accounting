import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { CORE_MIGRATIONS } from '..';
import { migration042 } from '../042_backfill_inventory_baseline';
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

describe('migration 042 — backfill inventory baseline', () => {
  it('is registered in CORE_MIGRATIONS', () => {
    expect(
      CORE_MIGRATIONS.some((m) => m.name === '042_backfill_inventory_baseline'),
    ).toBe(true);
  });

  it('backfills baseline stock adjustments for items with quantity gaps', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);

    await bootstrapDatabase(driver);

    // Setup an account for invoices
    const chart = await driver.run(
      `INSERT INTO chart (date, name, type) VALUES ('2024-01-01', 'Current Asset', 'Asset')`,
    );
    const account = await driver.run(
      `INSERT INTO account (chartId, date, name) VALUES (?, '2024-01-01', 'Cash')`,
      [Number(chart.lastInsertRowid)],
    );
    const accountId = Number(account.lastInsertRowid);

    // Simulate an item with stored quantity 50, but 100 sales and no purchase/opening stock.
    // View would see 0 - 100 = -100, leaving a 150 gap against stored 50.
    const item = await driver.run(
      `INSERT INTO inventory (name, price, quantity) VALUES ('Widget 42', 10, 50)`,
    );
    const inventoryId = Number(item.lastInsertRowid);

    const invoice = await driver.run(
      `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount)
       VALUES (1, ?, 'Sale', '2024-02-01', 1000)`,
      [accountId],
    );
    await driver.run(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 100, 10)`,
      [Number(invoice.lastInsertRowid), inventoryId],
    );

    // Prior to migration 042, view quantity is -100
    const viewBefore = await driver.get<{ quantity: number }>(
      `SELECT quantity FROM inventory_quantity_view WHERE inventoryId = ?`,
      [inventoryId],
    );
    expect(viewBefore?.quantity).toBe(-100);

    // Run migration 042
    await migration042.up(driver);

    // After migration 042, view quantity matches stored quantity (50)
    const viewAfter = await driver.get<{ quantity: number }>(
      `SELECT quantity FROM inventory_quantity_view WHERE inventoryId = ?`,
      [inventoryId],
    );
    expect(viewAfter?.quantity).toBe(50);

    // Adjustment row exists with expected reason and date
    const adj = await driver.get<{
      quantityDelta: number;
      reason: string;
      date: string;
    }>(
      `SELECT quantityDelta, reason, date FROM stock_adjustments WHERE inventoryId = ?`,
      [inventoryId],
    );
    expect(adj?.quantityDelta).toBe(150);
    expect(adj?.reason).toBe(INVENTORY_BASELINE_REASON);
    expect(adj?.date).toBe(INVENTORY_BASELINE_DATE);

    // Verify it also queued in sync_outbox
    const outbox = await driver.all<{ tableName: string; rowUuid: string }>(
      `SELECT tableName, rowUuid FROM sync_outbox WHERE tableName = 'stock_adjustments'`,
    );
    expect(outbox.length).toBeGreaterThanOrEqual(1);

    // Verify idempotency
    await migration042.up(driver);
    const viewSecond = await driver.get<{ quantity: number }>(
      `SELECT quantity FROM inventory_quantity_view WHERE inventoryId = ?`,
      [inventoryId],
    );
    expect(viewSecond?.quantity).toBe(50);

    db.close();
  });
});
