import Database from 'better-sqlite3';
import { InventoryService } from '../InventoryService';
import type { SessionContext, KeyValueStore } from '../../ports';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { InventoryService as MainInventoryService } from '../../../main/services/Inventory.service';
import { INVENTORY_BASELINE_REASON } from '../../db/inventoryBaselineBackfill';
import { applyFrozenWebSchema } from '../../../../scripts/generate-schema-snapshot';

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

jest.mock('../../../main/store', () => ({
  store: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
}));

jest.mock('electron', () => ({
  app: { isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: jest.fn(() => false),
    encryptString: jest.fn(),
    decryptString: jest.fn(),
  },
}));

const USERNAME = 'testuser';
const session: SessionContext = { getUsername: () => USERNAME };

/**
 * The real schema, brought forward by the real migrations — see the note in
 * the main-process InventoryService test for why both are needed.
 */
function seedBasicSchema(db: Database.Database) {
  applyFrozenWebSchema(db);
}

function createCore(db: Database.Database, store?: KeyValueStore) {
  const driver = new BetterSqliteDriver(db);
  return {
    driver,
    inventory: new InventoryService({ db: driver, session, store }),
  };
}

/** The old main-process service, bound to a given db the way its tests do. */
function createMainService(db: Database.Database): MainInventoryService {
  const service = Object.create(MainInventoryService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).initPreparedStatements();
  return service as MainInventoryService;
}

const DATES = { startDate: '2025-01-01', endDate: '2025-12-31' };

const seedItemType = (db: Database.Database, name: string) =>
  db.prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)').run(name)
    .lastInsertRowid as number;

const seedInventoryRow = (
  db: Database.Database,
  name: string,
  price: number,
  itemTypeId: number | null,
  quantity: number,
  listPosition: number | null = null,
) =>
  db
    .prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity, listPosition) VALUES (?, NULL, ?, ?, ?, ?)',
    )
    .run(name, price, itemTypeId, quantity, listPosition)
    .lastInsertRowid as number;

describe('core InventoryService.getInventoryHealth', () => {
  it('returns empty report when no items exist', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { inventory } = createCore(db);
    const response = await inventory.getInventoryHealth(DATES);
    expect(response.rows).toHaveLength(0);
    db.close();
  });

  it('includes itemTypeId in every row', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    const t2 = seedItemType(db, 'T2');
    seedInventoryRow(db, 'Item1', 10, t1, 5);
    seedInventoryRow(db, 'Item2', 20, t2, 15);

    const { inventory } = createCore(db);
    const response = await inventory.getInventoryHealth(DATES);
    expect(response.rows).toHaveLength(2);

    const r1 = response.rows.find(
      (r) => (r as Record<string, unknown>).item === 'Item1',
    ) as Record<string, unknown>;
    const r2 = response.rows.find(
      (r) => (r as Record<string, unknown>).item === 'Item2',
    ) as Record<string, unknown>;
    expect(r1.itemTypeId).toBe(t1);
    expect(r2.itemTypeId).toBe(t2);
    expect(r1.price).toBe(10);
    expect(r2.price).toBe(20);
    db.close();
  });

  it('filters by itemTypeIds when provided', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    seedItemType(db, 'T2');
    seedInventoryRow(db, 'Item1', 10, t1, 5);
    seedInventoryRow(db, 'Item2', 20, t1 + 1, 15);

    const { inventory } = createCore(db);
    const response = await inventory.getInventoryHealth({
      ...DATES,
      itemTypeIds: [t1],
    });
    expect(response.rows).toHaveLength(1);
    const row = response.rows[0] as Record<string, unknown>;
    expect(row.item).toBe('Item1');
    expect(row.itemTypeId).toBe(t1);
    db.close();
  });

  it('emits one anomaly chip per issue flag (not merged stock bucket)', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    seedInventoryRow(db, 'ZeroQty', 0, t1, 0);

    const { inventory } = createCore(db);
    const { anomalies } = await inventory.getInventoryHealth(DATES);
    const types = anomalies.map((a) => a.type);
    expect(types).toContain('zero-stock');
    expect(types).toContain('negative-stock');
    const zeroChip = anomalies.find((a) => a.type === 'zero-stock');
    expect(zeroChip?.count).toBe(1);
    const negChip = anomalies.find((a) => a.type === 'negative-stock');
    expect(negChip?.count).toBe(0);
    db.close();
  });

  it('attaches last sale and last purchase invoice numbers in range', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    const invId = seedInventoryRow(db, 'Widget', 10, t1, 5);
    const accId = db
      .prepare('INSERT INTO account (chartId, name) VALUES (1, ?)')
      .run('Cust').lastInsertRowid as number;
    const saleInvId = db
      .prepare(
        `INSERT INTO invoices (totalAmount, invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES (0, 'Sale', 0, 0, '2025-06-10T12:00:00.000Z', ?, 2390)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 2, 10)',
    ).run(saleInvId, invId);
    const purchInvId = db
      .prepare(
        `INSERT INTO invoices (totalAmount, invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES (0, 'Purchase', 0, 0, '2025-06-15T12:00:00.000Z', ?, 88)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 5, 8)',
    ).run(purchInvId, invId);

    const { inventory } = createCore(db);
    const response = await inventory.getInventoryHealth(DATES);
    const row = response.rows[0] as Record<string, unknown>;
    expect(row.item).toBe('Widget');
    expect(row.lastSaleInvoiceNumber).toBe(2390);
    expect(row.lastPurchaseInvoiceNumber).toBe(88);
    db.close();
  });

  it('uses last movement ever for daysSinceMovement when report range has no activity', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    const invId = seedInventoryRow(db, 'SlowMover', 10, t1, 50);
    const accId = db
      .prepare('INSERT INTO account (chartId, name) VALUES (1, ?)')
      .run('Cust').lastInsertRowid as number;
    const saleInvId = db
      .prepare(
        `INSERT INTO invoices (totalAmount, invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES (0, 'Sale', 0, 0, '2024-06-01T12:00:00.000Z', ?, 100)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 1, 10)',
    ).run(saleInvId, invId);

    const { inventory } = createCore(db);
    const response = await inventory.getInventoryHealth({
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    });
    const row = response.rows[0] as Record<string, unknown>;
    expect(row.lastSaleDate).toBeNull();
    expect(row.lastMovementDate).toBe('2024-06-01T12:00:00.000Z');
    expect(typeof row.daysSinceMovement).toBe('number');
    expect((row.daysSinceMovement as number) > 90).toBe(true);
    db.close();
  });
});

describe('core InventoryService.getStockAsOf', () => {
  it('returns zero quantity when no invoices apply and inventory is zero', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    seedInventoryRow(db, 'Widget', 10, t1, 0);

    const { inventory } = createCore(db);
    const res = await inventory.getStockAsOf({ asOfDate: '2025-01-15' });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].quantityAsOf).toBe(0);
    db.close();
  });

  it('rewinds from current quantity when no movement after as-of', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    const invId = seedInventoryRow(db, 'Widget', 10, t1, 10);
    const accId = db
      .prepare('INSERT INTO account (chartId, name) VALUES (1, ?)')
      .run('V').lastInsertRowid as number;
    const inv = db
      .prepare(
        `INSERT INTO invoices (totalAmount, invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES (0, 'Purchase', 0, 0, '2025-06-01T12:00:00.000Z', ?, 1)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 10, 8)',
    ).run(inv, invId);

    const { inventory } = createCore(db);
    const res = await inventory.getStockAsOf({ asOfDate: '2025-06-15' });
    const row = res.rows.find((r) => r.itemId === invId);
    expect(row?.quantityAsOf).toBe(10);
    db.close();
  });

  it('subtracts purchases after as-of from current to get historical qty', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    // docs/derived-state-design.md §6 migration 028: getStockAsOf's
    // "current quantity" anchor now comes from inventory_quantity_view
    // (canon) rather than the raw `inventory.quantity` column, so the
    // opening-stock fact below must actually reconcile with the movements
    // seeded further down (5+3+7=15 was the pre-cutover fixture's
    // internally-inconsistent raw counter vs. facts; 2+3+7=12 reproduces
    // the same intended "current = 12" the test's assertions rely on, now
    // sourced from real facts instead of an independently-poked column).
    const invId = seedInventoryRow(db, 'Widget', 10, t1, 12);
    db.prepare(
      'INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate) VALUES (?, 2, ?)',
    ).run(invId, '2025-01-01');
    const accId = db
      .prepare('INSERT INTO account (chartId, name) VALUES (1, ?)')
      .run('V').lastInsertRowid as number;
    const purchSameDay = db
      .prepare(
        `INSERT INTO invoices (totalAmount, invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES (0, 'Purchase', 0, 0, '2025-01-01T10:00:00.000Z', ?, 1)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 3, 8)',
    ).run(purchSameDay, invId);
    const purchLater = db
      .prepare(
        `INSERT INTO invoices (totalAmount, invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES (0, 'Purchase', 0, 0, '2025-02-01T12:00:00.000Z', ?, 2)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 7, 8)',
    ).run(purchLater, invId);

    const { inventory } = createCore(db);
    const resMar = await inventory.getStockAsOf({ asOfDate: '2025-03-01' });
    expect(resMar.rows.find((r) => r.itemId === invId)?.quantityAsOf).toBe(12);
    const resJan = await inventory.getStockAsOf({ asOfDate: '2025-01-15' });
    expect(resJan.rows.find((r) => r.itemId === invId)?.quantityAsOf).toBe(5);
    db.close();
  });

  it('matches current when return predates as-of (no delta after as-of end)', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    const invId = seedInventoryRow(db, 'Widget', 10, t1, 20);
    const accId = db
      .prepare('INSERT INTO account (chartId, name) VALUES (1, ?)')
      .run('C').lastInsertRowid as number;
    const purch = db
      .prepare(
        `INSERT INTO invoices (totalAmount, invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES (0, 'Purchase', 0, 0, '2025-05-01T12:00:00.000Z', ?, 1)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 20, 8)',
    ).run(purch, invId);
    const sale = db
      .prepare(
        `INSERT INTO invoices (totalAmount, invoiceType, isQuotation, isReturned, returnedAt, date, accountId, invoiceNumber)
         VALUES (0, 'Sale', 0, 1, '2025-05-10T12:00:00.000Z', '2025-05-05T12:00:00.000Z', ?, 2)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 6, 10)',
    ).run(sale, invId);

    const { inventory } = createCore(db);
    const res = await inventory.getStockAsOf({ asOfDate: '2025-05-15' });
    const row = res.rows.find((r) => r.itemId === invId);
    expect(row?.quantityAsOf).toBe(20);
    db.close();
  });

  it('adds back sales that occur strictly after as-of (rewind)', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    const invId = seedInventoryRow(db, 'Widget', 10, t1, 5);
    // docs/derived-state-design.md §6 migration 028: "current" is now
    // inventory_quantity_view-canon (opening stock + all movements,
    // unconditional), not the raw `inventory.quantity` column seeded above
    // — an opening-stock fact of 8 plus the -3 sale below reconciles to the
    // same "current = 5" the pre-cutover fixture asserted via the raw
    // counter alone.
    db.prepare(
      'INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate) VALUES (?, 8, ?)',
    ).run(invId, '2020-01-01');
    const accId = db
      .prepare('INSERT INTO account (chartId, name) VALUES (1, ?)')
      .run('C').lastInsertRowid as number;
    const sale = db
      .prepare(
        `INSERT INTO invoices (totalAmount, invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES (0, 'Sale', 0, 0, '2025-06-20T12:00:00.000Z', ?, 1)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 3, 10)',
    ).run(sale, invId);

    const { inventory } = createCore(db);
    const res = await inventory.getStockAsOf({ asOfDate: '2025-06-10' });
    const row = res.rows.find((r) => r.itemId === invId);
    expect(row?.quantityAsOf).toBe(8);
    db.close();
  });
});

describe('core InventoryService.getInventory list order', () => {
  it('orders by listPosition then id, nulls last', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    seedInventoryRow(db, 'B', 1, t1, 0, 20);
    seedInventoryRow(db, 'A', 1, t1, 0, 10);
    seedInventoryRow(db, 'Z', 1, t1, 0, null);

    const { inventory } = createCore(db);
    const rows = await inventory.getInventory();
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'Z']);
    db.close();
  });
});

describe('core InventoryService.applyListPositions', () => {
  it('updates by trimmed name and reports not found / ambiguous', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    seedInventoryRow(db, 'Only', 1, t1, 0);
    seedInventoryRow(db, 'Dup', 1, t1, 0);
    seedInventoryRow(db, 'Dup', 1, t1, 0);

    const { inventory } = createCore(db);
    const res = await inventory.applyListPositions([
      { name: '  Only  ', listPosition: 5 },
      { name: 'Missing', listPosition: 1 },
      { name: 'Dup', listPosition: 9 },
    ]);
    expect(res).toEqual({
      updated: 1,
      notFoundNames: ['Missing'],
      ambiguousNames: ['Dup'],
    });
    const rows = await inventory.getInventory();
    expect(rows.find((r) => r.name === 'Only')?.listPosition).toBe(5);
    db.close();
  });
});

describe('core InventoryService.bulkUpdatePricesAndListPositions', () => {
  it('updates only provided ids in one transaction', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    const idA = seedInventoryRow(db, 'A', 10, t1, 0, 1);
    const idB = seedInventoryRow(db, 'B', 20, t1, 0, 2);

    const { inventory } = createCore(db);
    const res = await inventory.bulkUpdatePricesAndListPositions([
      { id: idA, price: 15, listPosition: 9 },
      { id: idB, price: 20, listPosition: null },
    ]);
    expect(res.updated).toBe(2);

    const rows = await inventory.getInventory();
    const a = rows.find((r) => r.id === idA);
    const b = rows.find((r) => r.id === idB);
    expect(a?.price).toBe(15);
    expect(a?.listPosition).toBe(9);
    expect(b?.price).toBe(20);
    expect(b?.listPosition).toBeNull();
    db.close();
  });

  it('rejects invalid price', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    const idA = seedInventoryRow(db, 'A', 10, t1, 0, 1);

    const { inventory } = createCore(db);
    await expect(
      inventory.bulkUpdatePricesAndListPositions([
        { id: idA, price: -1, listPosition: 1 },
      ]),
    ).rejects.toThrow(/Invalid price/);
    db.close();
  });

  it('rejects negative list #', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    const idA = seedInventoryRow(db, 'A', 10, t1, 0, 1);

    const { inventory } = createCore(db);
    await expect(
      inventory.bulkUpdatePricesAndListPositions([
        { id: idA, price: 10, listPosition: -1 },
      ]),
    ).rejects.toThrow(/Invalid list #/);
    db.close();
  });
});

describe('core InventoryService attribute definitions', () => {
  it('appends new attributes after the highest order, even after a delete', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { inventory } = createCore(db);

    await inventory.upsertAttributeDefinition({
      key: 'a',
      label: 'A',
      valueType: 'text',
    });
    await inventory.upsertAttributeDefinition({
      key: 'b',
      label: 'B',
      valueType: 'text',
    });
    await inventory.upsertAttributeDefinition({
      key: 'c',
      label: 'C',
      valueType: 'text',
    });
    expect(
      (await inventory.getAttributeDefinitions()).map((d) => d.sortOrder),
    ).toEqual([1, 2, 3]);

    // delete from the middle: a row-count based order would reuse 3 and collide
    const middle = (await inventory.getAttributeDefinitions()).find(
      (d) => d.key === 'b',
    ) as { id: number };
    await inventory.deleteAttributeDefinition(middle.id);
    await inventory.upsertAttributeDefinition({
      key: 'd',
      label: 'D',
      valueType: 'text',
    });

    const orders = (await inventory.getAttributeDefinitions()).map(
      (d) => d.sortOrder,
    );
    expect(orders).toEqual([1, 3, 4]);
    expect(new Set(orders).size).toBe(orders.length);
    db.close();
  });

  it('normalises order to 1..N on reorder, healing gaps and duplicates', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    db.prepare(
      'INSERT INTO attribute_definitions (key,label,valueType,sortOrder) VALUES (?,?,?,?)',
    ).run('a', 'A', 'text', 5);
    db.prepare(
      'INSERT INTO attribute_definitions (key,label,valueType,sortOrder) VALUES (?,?,?,?)',
    ).run('b', 'B', 'text', 5);
    db.prepare(
      'INSERT INTO attribute_definitions (key,label,valueType,sortOrder) VALUES (?,?,?,?)',
    ).run('c', 'C', 'text', 99);

    const { inventory } = createCore(db);
    const byKey = async (k: string) =>
      (await inventory.getAttributeDefinitions()).find((d) => d.key === k)!.id;
    const ok = await inventory.reorderAttributeDefinitions([
      await byKey('c'),
      await byKey('a'),
      await byKey('b'),
    ]);

    expect(ok).toBe(true);
    expect(
      (await inventory.getAttributeDefinitions()).map((d) => [
        d.key,
        d.sortOrder,
      ]),
    ).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', 3],
    ]);
    db.close();
  });

  it('ignores unknown ids and an empty reorder', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { inventory } = createCore(db);
    await inventory.upsertAttributeDefinition({
      key: 'a',
      label: 'A',
      valueType: 'text',
    });
    const { id } = (await inventory.getAttributeDefinitions())[0];

    expect(await inventory.reorderAttributeDefinitions([])).toBe(false);
    expect(await inventory.reorderAttributeDefinitions([999])).toBe(false);
    expect(await inventory.reorderAttributeDefinitions([999, id])).toBe(true);
    expect((await inventory.getAttributeDefinitions())[0].sortOrder).toBe(1);
    db.close();
  });

  it('reports how many items use each attribute', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    db.prepare(
      'INSERT INTO attribute_definitions (key, label, valueType, sortOrder) VALUES (?, ?, ?, 0)',
    ).run('size_in', 'Paper size', 'text');
    db.prepare(
      'INSERT INTO attribute_definitions (key, label, valueType, sortOrder) VALUES (?, ?, ?, 0)',
    ).run('unused_key', 'Unused', 'text');
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, ?)',
    ).run('A', JSON.stringify({ size_in: '5 x 9' }));
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, ?)',
    ).run('B', JSON.stringify({ size_in: '6 x 9' }));
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, NULL)',
    ).run('C');

    const { inventory } = createCore(db);
    const defs = await inventory.getAttributeDefinitions();
    const byKey = Object.fromEntries(defs.map((d) => [d.key, d.usageCount]));
    expect(byKey).toEqual({ size_in: 2, unused_key: 0 });
    db.close();
  });

  it('force-deletes an in-use attribute and strips it from every item', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const usedId = db
      .prepare(
        'INSERT INTO attribute_definitions (key, label, valueType, sortOrder) VALUES (?, ?, ?, 0)',
      )
      .run('size_in', 'Paper size', 'text').lastInsertRowid as number;
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, ?)',
    ).run('A', JSON.stringify({ size_in: '5 x 9', pages: 100 }));
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, ?)',
    ).run('B', JSON.stringify({ size_in: '6 x 9' }));

    const { inventory } = createCore(db);
    expect(await inventory.deleteAttributeDefinition(usedId, true)).toEqual({
      deleted: true,
      usageCount: 2,
      valuesRemoved: 2,
    });
    expect(await inventory.getAttributeDefinitions()).toEqual([]);

    const rows = db
      .prepare('SELECT name, attributes FROM inventory ORDER BY name')
      .all() as Array<{ name: string; attributes: string | null }>;
    expect(JSON.parse(rows[0].attributes as string)).toEqual({ pages: 100 });
    expect(rows[1].attributes).toBeNull();
    db.close();
  });

  it('defers deletion of an in-use attribute to a confirmation, without force', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const usedId = db
      .prepare(
        'INSERT INTO attribute_definitions (key, label, valueType, sortOrder) VALUES (?, ?, ?, 0)',
      )
      .run('size_in', 'Paper size', 'text').lastInsertRowid as number;
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, ?)',
    ).run('A', JSON.stringify({ size_in: '5 x 9' }));

    const { inventory } = createCore(db);
    expect(await inventory.deleteAttributeDefinition(usedId)).toEqual({
      deleted: false,
      usageCount: 1,
      valuesRemoved: 0,
    });
    expect(
      (await inventory.getAttributeDefinitions()).map((d) => d.key),
    ).toEqual(['size_in']);
    db.close();
  });

  it('drops blank values so "has attributes" stays meaningful', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const id = db
      .prepare('INSERT INTO inventory (name, price, quantity) VALUES (?, 1, 0)')
      .run('A').lastInsertRowid as number;

    const { inventory } = createCore(db);
    await inventory.updateInventoryAttributes(id, { a: 'x', b: '', c: null });
    const stored = db
      .prepare('SELECT attributes FROM inventory WHERE id = ?')
      .get(id) as { attributes: string | null };
    expect(JSON.parse(stored.attributes as string)).toEqual({ a: 'x' });

    await inventory.updateInventoryAttributes(id, { a: '' });
    expect(
      (
        db.prepare('SELECT attributes FROM inventory WHERE id = ?').get(id) as {
          attributes: string | null;
        }
      ).attributes,
    ).toBeNull();
    db.close();
  });
});

describe('core InventoryService display title (migration 023)', () => {
  const setup = () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const typeId = seedItemType(db, 'T1');
    return { db, typeId, ...createCore(db) };
  };
  const titleOf = (db: Database.Database, name: string) =>
    (
      db.prepare('SELECT title FROM inventory WHERE name = ?').get(name) as {
        title: string | null;
      }
    ).title;

  it('stores a title given on create', async () => {
    const { db, typeId, inventory } = setup();
    await inventory.insertItem({
      name: 'H ABU BAKR',
      price: 40,
      title: 'Hazrat Abu Bakr Siddiq (RA)',
      itemTypeId: typeId,
    });
    expect(titleOf(db, 'H ABU BAKR')).toBe('Hazrat Abu Bakr Siddiq (RA)');
    db.close();
  });

  it('stores NULL rather than an empty string when left blank', async () => {
    const { db, typeId, inventory } = setup();
    await inventory.insertItem({
      name: 'S-23-G',
      price: 1080,
      title: '   ',
      itemTypeId: typeId,
    });
    expect(titleOf(db, 'S-23-G')).toBeNull();
    db.close();
  });

  it('updates a title, and clearing it restores NULL', async () => {
    const { db, typeId, inventory } = setup();
    await inventory.insertItem({
      name: 'PEGHAM',
      price: 100,
      itemTypeId: typeId,
    });
    const { id } = db
      .prepare('SELECT id FROM inventory WHERE name = ?')
      .get('PEGHAM') as { id: number };

    await inventory.updateItem({ id, price: 100, title: 'Paigham' });
    expect(titleOf(db, 'PEGHAM')).toBe('Paigham');

    await inventory.updateItem({ id, price: 100, title: '' });
    expect(titleOf(db, 'PEGHAM')).toBeNull();
    db.close();
  });
});

describe('core InventoryService basic reads/writes', () => {
  it('doesInventoryExist reflects row presence', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { inventory } = createCore(db);
    expect(await inventory.doesInventoryExist()).toBe(false);
    await inventory.insertItem({ name: 'Item', price: 10 });
    expect(await inventory.doesInventoryExist()).toBe(true);
    db.close();
  });

  it('applyStockAdjustment updates quantity and records history', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { inventory } = createCore(db);
    await inventory.insertItem({ name: 'Item', price: 10 });
    const { id } = (await inventory.getInventory())[0];

    const res = await inventory.applyStockAdjustment({
      inventoryId: id,
      quantityDelta: 5,
      reason: 'stock count',
      date: '2025-03-01T00:00:00.000Z',
    });
    expect(res.success).toBe(true);
    expect((await inventory.getInventory())[0].quantity).toBe(5);

    const adjustments = await inventory.getStockAdjustments(id);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].quantityDelta).toBe(5);

    // going negative is refused
    const negRes = await inventory.applyStockAdjustment({
      inventoryId: id,
      quantityDelta: -10,
    });
    expect(negRes.success).toBe(false);
    expect((await inventory.getInventory())[0].quantity).toBe(5);
    db.close();
  });

  it('setOpeningStock updates quantity for an existing item and records opening stock', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { inventory } = createCore(db);
    await inventory.insertItem({ name: 'Widget', price: 10 });
    const { id } = (await inventory.getInventory())[0];

    const res = await inventory.setOpeningStock(
      [{ name: 'Widget', quantity: 42 }],
      '2025-01-01',
    );
    expect(res.success).toBe(true);
    expect((await inventory.getInventory())[0].quantity).toBe(42);

    const opening = await inventory.getOpeningStock();
    expect(opening).toHaveLength(1);
    expect(opening[0].inventoryId).toBe(id);
    expect(opening[0].quantity).toBe(42);
    db.close();
  });

  it('getInventoryIdsWithHistory returns ids touched by opening stock or adjustments', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { inventory } = createCore(db);
    await inventory.insertItem({ name: 'A', price: 1 });
    await inventory.insertItem({ name: 'B', price: 1 });
    const [a, b] = await inventory.getInventory();

    await inventory.setOpeningStock([{ name: 'A', quantity: 1 }]);
    await inventory.applyStockAdjustment({
      inventoryId: b.id,
      quantityDelta: 1,
    });

    const ids = await inventory.getInventoryIdsWithHistory();
    expect(new Set(ids)).toEqual(new Set([a.id, b.id]));
    db.close();
  });

  it('name validation rejects a character the installation has reserved, via the store port', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const store: KeyValueStore = {
      get: jest.fn((key: string) =>
        key === 'publish.reservedNameChars' ? '/' : undefined,
      ),
      set: jest.fn(),
      delete: jest.fn(),
    };
    const { inventory } = createCore(db, store);
    await expect(
      inventory.insertItem({ name: 'A/B', price: 1 }),
    ).rejects.toThrow(/reserved/);
    // without a store, no restriction applies (matches the original's default)
    const { inventory: unrestricted } = createCore(db);
    await expect(
      unrestricted.insertItem({ name: 'A/B', price: 1 }),
    ).resolves.toBe(true);
    db.close();
  });
});

describe('core InventoryService excludes import baseline rows from lists/indicators', () => {
  it('getStockAdjustments (all and by-id) return only the real adjustment, not the baseline', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { inventory } = createCore(db);
    await inventory.insertItem({ name: 'Widget', price: 10 });
    const { id } = (await inventory.getInventory())[0];

    await inventory.applyStockAdjustment({
      inventoryId: id,
      quantityDelta: 100,
      reason: INVENTORY_BASELINE_REASON,
      date: '2000-01-01',
    });
    await inventory.applyStockAdjustment({
      inventoryId: id,
      quantityDelta: 5,
      reason: 'stock count',
      date: '2025-03-01T00:00:00.000Z',
    });

    const byId = await inventory.getStockAdjustments(id);
    expect(byId).toHaveLength(1);
    expect(byId[0].reason).toBe('stock count');

    const all = await inventory.getStockAdjustments();
    expect(all).toHaveLength(1);
    expect(all[0].reason).toBe('stock count');
    db.close();
  });

  it('getInventoryIdsWithHistory flags only items with real adjustments or opening stock, not baseline-only items', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { inventory } = createCore(db);
    await inventory.insertItem({ name: 'BaselineOnly', price: 1 });
    await inventory.insertItem({ name: 'RealAdjustment', price: 1 });
    await inventory.insertItem({ name: 'OpeningStock', price: 1 });
    const [baselineOnly, realAdjustment, openingStock] =
      await inventory.getInventory();

    await inventory.applyStockAdjustment({
      inventoryId: baselineOnly.id,
      quantityDelta: 50,
      reason: INVENTORY_BASELINE_REASON,
      date: '2000-01-01',
    });
    await inventory.applyStockAdjustment({
      inventoryId: realAdjustment.id,
      quantityDelta: 1,
      reason: 'stock count',
    });
    await inventory.setOpeningStock([{ name: 'OpeningStock', quantity: 1 }]);

    const ids = await inventory.getInventoryIdsWithHistory();
    expect(new Set(ids)).toEqual(new Set([realAdjustment.id, openingStock.id]));
    expect(ids).not.toContain(baselineOnly.id);
    db.close();
  });

  it('quantity from inventory_quantity_view still includes the baseline (math untouched)', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { inventory } = createCore(db);
    await inventory.insertItem({ name: 'Widget', price: 10 });
    const { id } = (await inventory.getInventory())[0];

    await inventory.applyStockAdjustment({
      inventoryId: id,
      quantityDelta: 100,
      reason: INVENTORY_BASELINE_REASON,
      date: '2000-01-01',
    });

    const [item] = await inventory.getInventory();
    expect(item.quantity).toBe(100);

    const view = db
      .prepare(
        'SELECT quantity FROM inventory_quantity_view WHERE inventoryId = ?',
      )
      .get(id) as { quantity: number };
    expect(view.quantity).toBe(100);
    db.close();
  });

  it('getStockAsOf is unaffected by the list exclusions (still sums the baseline delta)', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = seedItemType(db, 'T1');
    const invId = seedInventoryRow(db, 'Widget', 10, t1, 0);
    const { inventory } = createCore(db);

    await inventory.applyStockAdjustment({
      inventoryId: invId,
      quantityDelta: 100,
      reason: INVENTORY_BASELINE_REASON,
      date: '2000-01-01',
    });

    const res = await inventory.getStockAsOf({ asOfDate: '2025-01-15' });
    const row = res.rows.find((r) => r.itemId === invId);
    expect(row?.quantityAsOf).toBe(100);
    db.close();
  });
});

/**
 * Migration 024 gives every inventory row a globally unique uuid, generated
 * independently per database. Two separately-seeded in-memory databases
 * therefore never share a uuid for "the same" row even when every other
 * column matches — so this parity check confirms each side produced a
 * well-formed uuid and then excludes it before the row-for-row comparison.
 */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function stripUuids<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUuids(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'uuid')
        .map(([key, val]) => [key, stripUuids(val)]),
    ) as T;
  }
  return value;
}

// eslint-disable-next-line jest/no-disabled-tests -- schema fork: desktop 024-026 vs web 024-027
describe.skip('core InventoryService matches the main-process service row for row', () => {
  it('produces identical getInventory / getInventoryHealth / getStockAsOf results', async () => {
    const dbOld = new Database(':memory:');
    const dbCore = new Database(':memory:');
    seedBasicSchema(dbOld);
    seedBasicSchema(dbCore);

    const oldService = createMainService(dbOld);
    const { inventory: coreService } = createCore(dbCore);

    const t1Old = seedItemType(dbOld, 'T1');
    const t1Core = seedItemType(dbCore, 'T1');
    expect(t1Old).toBe(t1Core);

    oldService.insertItem({
      name: 'Widget',
      price: 25,
      itemTypeId: t1Old,
      description: 'd',
    });
    await coreService.insertItem({
      name: 'Widget',
      price: 25,
      itemTypeId: t1Core,
      description: 'd',
    });
    oldService.insertItem({ name: 'Gadget', price: 40 });
    await coreService.insertItem({ name: 'Gadget', price: 40 });

    oldService.applyStockAdjustment({
      inventoryId: 1,
      quantityDelta: 7,
      date: '2025-02-01T00:00:00.000Z',
    });
    await coreService.applyStockAdjustment({
      inventoryId: 1,
      quantityDelta: 7,
      date: '2025-02-01T00:00:00.000Z',
    });

    const oldRows = oldService.getInventory();
    const coreRows = await coreService.getInventory();
    [...oldRows, ...coreRows].forEach((r) =>
      expect((r as unknown as { uuid: string }).uuid).toMatch(UUID_V4),
    );
    expect(stripUuids(coreRows)).toEqual(stripUuids(oldRows));

    const oldHealth = oldService.getInventoryHealth(DATES);
    const coreHealth = await coreService.getInventoryHealth(DATES);
    expect(stripUuids(coreHealth.rows)).toEqual(stripUuids(oldHealth.rows));
    expect(coreHealth.kpis).toEqual(oldHealth.kpis);

    const oldAsOf = oldService.getStockAsOf({ asOfDate: '2025-06-01' });
    const coreAsOf = await coreService.getStockAsOf({ asOfDate: '2025-06-01' });
    expect(stripUuids(coreAsOf)).toEqual(stripUuids(oldAsOf));

    dbOld.close();
    dbCore.close();
  });
});

describe('BetterSqliteDriver transactions (InventoryService)', () => {
  it('rolls back bulkUpdatePricesAndListPositions entirely when one patch is invalid', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { inventory } = createCore(db);
    const t1 = seedItemType(db, 'T1');
    const idA = seedInventoryRow(db, 'A', 10, t1, 0, 1);
    const idB = seedInventoryRow(db, 'B', 20, t1, 0, 2);

    await expect(
      inventory.bulkUpdatePricesAndListPositions([
        { id: idA, price: 15, listPosition: 1 },
        { id: idB, price: -5, listPosition: 2 },
      ]),
    ).rejects.toThrow(/Invalid price/);

    const rows = await inventory.getInventory();
    // neither patch took effect — the whole transaction rolled back
    expect(rows.find((r) => r.id === idA)?.price).toBe(10);
    expect(rows.find((r) => r.id === idB)?.price).toBe(20);
    db.close();
  });
});
