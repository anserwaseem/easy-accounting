import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../bootstrap';
import {
  backfillInventoryBaseline,
  verifyInventoryReconciliation,
  INVENTORY_BASELINE_REASON,
  INVENTORY_BASELINE_DATE,
} from '../inventoryBaselineBackfill';

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

/** A fresh, fully-bootstrapped database, same as the worker boots the real OPFS db. */
async function buildDriver(): Promise<{
  db: Database.Database;
  driver: BetterSqliteDriver;
}> {
  const db = new Database(':memory:');
  const driver = new BetterSqliteDriver(db);
  await bootstrapDatabase(driver);
  return { db, driver };
}

async function insertAccountChart(driver: BetterSqliteDriver): Promise<number> {
  const chart = await driver.run(
    `INSERT INTO chart (date, name, type) VALUES ('2024-01-01', 'Current Asset', 'Asset')`,
  );
  const account = await driver.run(
    `INSERT INTO account (chartId, date, name) VALUES (?, '2024-01-01', 'Cash')`,
    [Number(chart.lastInsertRowid)],
  );
  return Number(account.lastInsertRowid);
}

describe('backfillInventoryBaseline', () => {
  it('adds a baseline stock adjustment for an item whose stored quantity is unexplained by facts', async () => {
    const { db, driver } = await buildDriver();
    const accountId = await insertAccountChart(driver);

    // The field-bug shape: stored quantity 100, no opening stock, one Sale
    // invoice of 10 with no return — the view can only see the invoice
    // movement (-10), leaving a 110-unit gap the legacy stored counter
    // accounted for but no fact row ever captured.
    const item = await driver.run(
      `INSERT INTO inventory (name, price, quantity) VALUES ('Widget', 50, 100)`,
    );
    const inventoryId = Number(item.lastInsertRowid);

    const invoice = await driver.run(
      `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount)
       VALUES (1, ?, 'Sale', '2024-02-01', 500)`,
      [accountId],
    );
    await driver.run(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 10, 50)`,
      [Number(invoice.lastInsertRowid), inventoryId],
    );

    const viewBefore = await driver.get<{ quantity: number }>(
      `SELECT quantity FROM inventory_quantity_view WHERE inventoryId = ?`,
      [inventoryId],
    );
    expect(viewBefore?.quantity).toBe(-10);

    const result = await backfillInventoryBaseline(driver);
    expect(result.reconciled).toBe(1);
    expect(result.totalDelta).toBe(110);

    const adjustments = await driver.all<{
      quantityDelta: number;
      reason: string | null;
      date: string;
      inventoryId: number;
    }>(
      `SELECT quantityDelta, reason, date, inventoryId FROM stock_adjustments`,
    );
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].inventoryId).toBe(inventoryId);
    expect(adjustments[0].quantityDelta).toBe(110);
    expect(adjustments[0].reason).toBe(INVENTORY_BASELINE_REASON);
    expect(adjustments[0].date).toBe(INVENTORY_BASELINE_DATE);

    const viewAfter = await driver.get<{ quantity: number }>(
      `SELECT quantity FROM inventory_quantity_view WHERE inventoryId = ?`,
      [inventoryId],
    );
    expect(viewAfter?.quantity).toBe(100);

    db.close();
  });

  it('adds no baseline row for an item whose facts already fully explain its stored quantity', async () => {
    const { db, driver } = await buildDriver();

    // Stored quantity 7, opening stock 10, one Sale invoice of 3 — fully
    // consistent (10 - 3 = 7), so there is nothing to reconcile.
    const item = await driver.run(
      `INSERT INTO inventory (name, price, quantity) VALUES ('Gadget', 20, 7)`,
    );
    const inventoryId = Number(item.lastInsertRowid);
    await driver.run(
      `INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate) VALUES (?, 10, '2024-01-01')`,
      [inventoryId],
    );
    const accountId = await insertAccountChart(driver);
    const invoice = await driver.run(
      `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount)
       VALUES (1, ?, 'Sale', '2024-02-01', 60)`,
      [accountId],
    );
    await driver.run(
      `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 3, 20)`,
      [Number(invoice.lastInsertRowid), inventoryId],
    );

    const result = await backfillInventoryBaseline(driver);
    expect(result.reconciled).toBe(0);
    expect(result.totalDelta).toBe(0);

    const adjustments = await driver.all(`SELECT * FROM stock_adjustments`);
    expect(adjustments).toHaveLength(0);

    db.close();
  });

  it('reconciles multiple items independently in one pass', async () => {
    const { db, driver } = await buildDriver();

    const itemA = await driver.run(
      `INSERT INTO inventory (name, price, quantity) VALUES ('A', 10, 50)`,
    );
    const itemB = await driver.run(
      `INSERT INTO inventory (name, price, quantity) VALUES ('B', 10, 0)`,
    );
    const inventoryIdA = Number(itemA.lastInsertRowid);
    const inventoryIdB = Number(itemB.lastInsertRowid);
    // B's facts already explain its stored 0 (no opening stock, no invoices).

    const result = await backfillInventoryBaseline(driver);
    expect(result.reconciled).toBe(1);
    expect(result.totalDelta).toBe(50);

    const adjustments = await driver.all<{ inventoryId: number }>(
      `SELECT inventoryId FROM stock_adjustments`,
    );
    expect(adjustments.map((a) => a.inventoryId)).toEqual([inventoryIdA]);
    expect(inventoryIdB).toBeGreaterThan(0); // sanity: B really was created

    db.close();
  });
});

describe('verifyInventoryReconciliation', () => {
  it('names every item whose computed quantity still diverges from the stored one', async () => {
    const { db, driver } = await buildDriver();

    // A divergent row with the backfill deliberately NOT run — the audit
    // must catch and name it (this is the "should be impossible after
    // reconciliation" report the import summary surfaces).
    await driver.run(
      `INSERT INTO inventory (name, price, quantity) VALUES ('Ghost Stock', 10, 42)`,
    );

    const warnings = await verifyInventoryReconciliation(driver);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('RECONCILIATION FAILURE');
    expect(warnings[0]).toContain('"Ghost Stock"');
    expect(warnings[0]).toContain('desktop 42');
    expect(warnings[0]).toContain('computed 0');

    db.close();
  });

  it('returns nothing once the backfill has reconciled everything', async () => {
    const { db, driver } = await buildDriver();

    await driver.run(
      `INSERT INTO inventory (name, price, quantity) VALUES ('Ghost Stock', 10, 42)`,
    );
    await backfillInventoryBaseline(driver);

    expect(await verifyInventoryReconciliation(driver)).toEqual([]);

    db.close();
  });
});
