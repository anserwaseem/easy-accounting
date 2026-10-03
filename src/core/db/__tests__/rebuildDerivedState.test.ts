import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../bootstrap';
import { rebuildDerivedState } from '../rebuildDerivedState';

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

describe('rebuildDerivedState', () => {
  it('rebuilds vendor_stock from movements and inventory.quantity from the view', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    db.prepare(
      `INSERT INTO users (id, username, password_hash, status) VALUES (1, 'u', 'x', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO chart (id, date, name, userId, type) VALUES (1, '2024-01-01', 'Asset', 1, 'Asset')`,
    ).run();
    db.prepare(
      `INSERT INTO account (id, chartId, date, name) VALUES (1, 1, '2024-01-01', 'Vendor')`,
    ).run();
    db.prepare(
      `INSERT INTO inventory (id, name, price, quantity) VALUES (1, 'Book', 10, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate)
       VALUES (1, 5, '2024-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_stock_movements (
         vendorAccountId, inventoryId, quantityDelta, movementType, date
       ) VALUES (1, 1, 4, 'purchase', '2024-02-01')`,
    ).run();

    await rebuildDerivedState(driver);

    const stock = db
      .prepare(
        `SELECT quantity FROM vendor_stock WHERE vendorAccountId = 1 AND inventoryId = 1`,
      )
      .get() as { quantity: number };
    expect(stock.quantity).toBe(4);

    const qty = db
      .prepare(`SELECT quantity FROM inventory WHERE id = 1`)
      .get() as { quantity: number };
    expect(qty.quantity).toBe(5);

    db.close();
  });
});
