import Database from 'better-sqlite3';
import { InventoryService } from '..';

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

jest.mock('../../store', () => ({
  store: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
}));

jest.mock('electron', () => ({ app: { isPackaged: false } }));

function createTestDb(inMemoryDb: Database.Database) {
  const service = Object.create(InventoryService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).db = inMemoryDb;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).initPreparedStatements();
  return service as InventoryService;
}

function seedBasicSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      isActive INTEGER DEFAULT 1,
      isPrimary INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL DEFAULT 0,
      itemTypeId INTEGER REFERENCES item_types(id),
      isActive INTEGER DEFAULT 1,
      quantity REAL DEFAULT 0,
      listPosition INTEGER,
      parentId INTEGER REFERENCES inventory(id),
      attributes TEXT,
      excludeFromCatalog INTEGER NOT NULL DEFAULT 0,
      title TEXT
    );
    CREATE TABLE IF NOT EXISTS attribute_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      unit TEXT,
      valueType TEXT NOT NULL DEFAULT 'text',
      sortOrder INTEGER NOT NULL DEFAULT 0,
      isActive INTEGER NOT NULL DEFAULT 1,
      isPublic INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS price_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      isActive INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS inventory_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventoryId INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
      priceListId INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
      price REAL NOT NULL DEFAULT 0,
      UNIQUE(inventoryId, priceListId)
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoiceType TEXT NOT NULL,
      isQuotation INTEGER DEFAULT 0,
      isReturned INTEGER DEFAULT 0,
      returnedAt TEXT,
      date TEXT NOT NULL,
      accountId INTEGER,
      referenceNumber TEXT,
      biltyNumber TEXT,
      cartons INTEGER,
      invoiceNumber INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoiceId INTEGER NOT NULL REFERENCES invoices(id),
      inventoryId INTEGER NOT NULL REFERENCES inventory(id),
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      discount REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventoryId INTEGER NOT NULL REFERENCES inventory(id),
      quantityDelta REAL NOT NULL,
      reason TEXT,
      date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_opening_stock (
      inventoryId INTEGER PRIMARY KEY,
      quantity REAL NOT NULL,
      asOfDate TEXT,
      old_quantity REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS account (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
  `);
}

const DATES = { startDate: '2025-01-01', endDate: '2025-12-31' };

describe('InventoryService.getInventoryHealth', () => {
  it('should return empty report when no items exist', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const service = createTestDb(db);
    const response = service.getInventoryHealth(DATES);
    expect(response.rows).toHaveLength(0);
    db.close();
  });

  it('should include itemTypeId in every row', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    const t2 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T2').lastInsertRowid as number;
    db.prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity) VALUES (?, NULL, 10, ?, 5)',
    ).run('Item1', t1);
    db.prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity) VALUES (?, NULL, 20, ?, 15)',
    ).run('Item2', t2);

    const service = createTestDb(db);
    const response = service.getInventoryHealth(DATES);
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

  it('should filter by itemTypeIds when provided', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T2').lastInsertRowid as number;
    db.prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity) VALUES (?, NULL, 10, ?, 5)',
    ).run('Item1', t1);
    db.prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity) VALUES (?, NULL, 20, ?, 15)',
    ).run('Item2', t1 + 1);

    const service = createTestDb(db);
    const response = service.getInventoryHealth({
      ...DATES,
      itemTypeIds: [t1],
    });
    expect(response.rows).toHaveLength(1);
    const row = response.rows[0] as Record<string, unknown>;
    expect(row.item).toBe('Item1');
    expect(row.itemTypeId).toBe(t1);
    db.close();
  });

  it('should emit one anomaly chip per issue flag (not merged stock bucket)', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    db.prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity) VALUES (?, NULL, 0, ?, 0)',
    ).run('ZeroQty', t1);

    const service = createTestDb(db);
    const { anomalies } = service.getInventoryHealth(DATES);
    const types = anomalies.map((a) => a.type);
    expect(types).toContain('zero-stock');
    expect(types).toContain('negative-stock');
    expect(types).not.toContain('zero-negative-stock');
    const zeroChip = anomalies.find((a) => a.type === 'zero-stock');
    expect(zeroChip?.count).toBe(1);
    const negChip = anomalies.find((a) => a.type === 'negative-stock');
    expect(negChip?.count).toBe(0);
    db.close();
  });

  it('should attach last sale and last purchase invoice numbers in range', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    const invId = db
      .prepare(
        'INSERT INTO inventory (name, description, price, itemTypeId, quantity) VALUES (?, NULL, 10, ?, 5)',
      )
      .run('Widget', t1).lastInsertRowid as number;
    const accId = db
      .prepare('INSERT INTO account (name) VALUES (?)')
      .run('Cust').lastInsertRowid as number;
    const saleInvId = db
      .prepare(
        `INSERT INTO invoices (invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES ('Sale', 0, 0, '2025-06-10T12:00:00.000Z', ?, 2390)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 2, 10)',
    ).run(saleInvId, invId);
    const purchInvId = db
      .prepare(
        `INSERT INTO invoices (invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES ('Purchase', 0, 0, '2025-06-15T12:00:00.000Z', ?, 88)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 5, 8)',
    ).run(purchInvId, invId);

    const service = createTestDb(db);
    const response = service.getInventoryHealth(DATES);
    const row = response.rows[0] as Record<string, unknown>;
    expect(row.item).toBe('Widget');
    expect(row.lastSaleInvoiceNumber).toBe(2390);
    expect(row.lastPurchaseInvoiceNumber).toBe(88);
    db.close();
  });

  it('uses last movement ever for daysSinceMovement when report range has no activity', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    const invId = db
      .prepare(
        'INSERT INTO inventory (name, description, price, itemTypeId, quantity) VALUES (?, NULL, 10, ?, 50)',
      )
      .run('SlowMover', t1).lastInsertRowid as number;
    const accId = db
      .prepare('INSERT INTO account (name) VALUES (?)')
      .run('Cust').lastInsertRowid as number;
    const saleInvId = db
      .prepare(
        `INSERT INTO invoices (invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES ('Sale', 0, 0, '2024-06-01T12:00:00.000Z', ?, 100)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 1, 10)',
    ).run(saleInvId, invId);

    const service = createTestDb(db);
    const response = service.getInventoryHealth({
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

describe('InventoryService.getStockAsOf', () => {
  it('returns zero quantity when no invoices apply and inventory is zero', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    db.prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity) VALUES (?, NULL, 10, ?, 0)',
    ).run('Widget', t1);

    const service = createTestDb(db);
    const res = service.getStockAsOf({ asOfDate: '2025-01-15' });
    expect(res.rows).toHaveLength(1);
    const row = res.rows[0];
    expect(row.quantityAsOf).toBe(0);
    db.close();
  });

  it('rewinds from current quantity when no movement after as-of', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    const invId = db
      .prepare(
        'INSERT INTO inventory (name, description, price, itemTypeId, quantity) VALUES (?, NULL, 10, ?, 10)',
      )
      .run('Widget', t1).lastInsertRowid as number;
    const accId = db.prepare('INSERT INTO account (name) VALUES (?)').run('V')
      .lastInsertRowid as number;
    const inv = db
      .prepare(
        `INSERT INTO invoices (invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES ('Purchase', 0, 0, '2025-06-01T12:00:00.000Z', ?, 1)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 10, 8)',
    ).run(inv, invId);

    const service = createTestDb(db);
    const res = service.getStockAsOf({ asOfDate: '2025-06-15' });
    const row = res.rows.find((r) => r.itemId === invId);
    expect(row?.quantityAsOf).toBe(10);
    db.close();
  });

  it('subtracts purchases after as-of from current to get historical qty', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    const invId = db
      .prepare(
        'INSERT INTO inventory (name, description, price, itemTypeId, quantity) VALUES (?, NULL, 10, ?, 12)',
      )
      .run('Widget', t1).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate) VALUES (?, 5, ?)',
    ).run(invId, '2025-01-01');
    const accId = db.prepare('INSERT INTO account (name) VALUES (?)').run('V')
      .lastInsertRowid as number;
    const purchSameDay = db
      .prepare(
        `INSERT INTO invoices (invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES ('Purchase', 0, 0, '2025-01-01T10:00:00.000Z', ?, 1)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 3, 8)',
    ).run(purchSameDay, invId);
    const purchLater = db
      .prepare(
        `INSERT INTO invoices (invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES ('Purchase', 0, 0, '2025-02-01T12:00:00.000Z', ?, 2)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 7, 8)',
    ).run(purchLater, invId);

    const service = createTestDb(db);
    const resMar = service.getStockAsOf({ asOfDate: '2025-03-01' });
    expect(resMar.rows.find((r) => r.itemId === invId)?.quantityAsOf).toBe(12);
    const resJan = service.getStockAsOf({ asOfDate: '2025-01-15' });
    expect(resJan.rows.find((r) => r.itemId === invId)?.quantityAsOf).toBe(5);
    db.close();
  });

  it('matches current when return predates as-of (no delta after as-of end)', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    const invId = db
      .prepare(
        'INSERT INTO inventory (name, description, price, itemTypeId, quantity) VALUES (?, NULL, 10, ?, 20)',
      )
      .run('Widget', t1).lastInsertRowid as number;
    const accId = db.prepare('INSERT INTO account (name) VALUES (?)').run('C')
      .lastInsertRowid as number;
    const purch = db
      .prepare(
        `INSERT INTO invoices (invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES ('Purchase', 0, 0, '2025-05-01T12:00:00.000Z', ?, 1)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 20, 8)',
    ).run(purch, invId);
    const sale = db
      .prepare(
        `INSERT INTO invoices (invoiceType, isQuotation, isReturned, returnedAt, date, accountId, invoiceNumber)
         VALUES ('Sale', 0, 1, '2025-05-10T12:00:00.000Z', '2025-05-05T12:00:00.000Z', ?, 2)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 6, 10)',
    ).run(sale, invId);

    const service = createTestDb(db);
    const res = service.getStockAsOf({ asOfDate: '2025-05-15' });
    const row = res.rows.find((r) => r.itemId === invId);
    expect(row?.quantityAsOf).toBe(20);
    db.close();
  });

  it('adds back sales that occur strictly after as-of (rewind)', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    const invId = db
      .prepare(
        'INSERT INTO inventory (name, description, price, itemTypeId, quantity) VALUES (?, NULL, 10, ?, 5)',
      )
      .run('Widget', t1).lastInsertRowid as number;
    const accId = db.prepare('INSERT INTO account (name) VALUES (?)').run('C')
      .lastInsertRowid as number;
    const sale = db
      .prepare(
        `INSERT INTO invoices (invoiceType, isQuotation, isReturned, date, accountId, invoiceNumber)
         VALUES ('Sale', 0, 0, '2025-06-20T12:00:00.000Z', ?, 1)`,
      )
      .run(accId).lastInsertRowid as number;
    db.prepare(
      'INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 3, 10)',
    ).run(sale, invId);

    const service = createTestDb(db);
    const res = service.getStockAsOf({ asOfDate: '2025-06-10' });
    const row = res.rows.find((r) => r.itemId === invId);
    expect(row?.quantityAsOf).toBe(8);
    db.close();
  });
});

describe('InventoryService.getInventory list order', () => {
  it('orders by listPosition then id, nulls last', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    db.prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity, listPosition) VALUES (?, NULL, 1, ?, 0, ?)',
    ).run('B', t1, 20);
    db.prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity, listPosition) VALUES (?, NULL, 1, ?, 0, ?)',
    ).run('A', t1, 10);
    db.prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity, listPosition) VALUES (?, NULL, 1, ?, 0, NULL)',
    ).run('Z', t1);

    const service = createTestDb(db);
    const rows = service.getInventory();
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'Z']);
    db.close();
  });
});

describe('InventoryService.applyListPositions', () => {
  it('updates by trimmed name and reports not found / ambiguous', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    db.prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity, listPosition) VALUES (?, NULL, 1, ?, 0, NULL)',
    ).run('Only', t1);
    db.prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity, listPosition) VALUES (?, NULL, 1, ?, 0, NULL)',
    ).run('Dup', t1);
    db.prepare(
      'INSERT INTO inventory (name, description, price, itemTypeId, quantity, listPosition) VALUES (?, NULL, 1, ?, 0, NULL)',
    ).run('Dup', t1);

    const service = createTestDb(db);
    const res = service.applyListPositions([
      { name: '  Only  ', listPosition: 5 },
      { name: 'Missing', listPosition: 1 },
      { name: 'Dup', listPosition: 9 },
    ]);
    expect(res).toEqual({
      updated: 1,
      notFoundNames: ['Missing'],
      ambiguousNames: ['Dup'],
    });
    const only = service.getInventory().find((r) => r.name === 'Only');
    expect(only?.listPosition).toBe(5);
    db.close();
  });
});

describe('InventoryService.bulkUpdatePricesAndListPositions', () => {
  it('updates only provided ids in one transaction', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    const idA = db
      .prepare(
        'INSERT INTO inventory (name, description, price, itemTypeId, quantity, listPosition) VALUES (?, NULL, ?, ?, 0, ?)',
      )
      .run('A', 10, t1, 1).lastInsertRowid as number;
    const idB = db
      .prepare(
        'INSERT INTO inventory (name, description, price, itemTypeId, quantity, listPosition) VALUES (?, NULL, ?, ?, 0, ?)',
      )
      .run('B', 20, t1, 2).lastInsertRowid as number;

    const service = createTestDb(db);
    const res = service.bulkUpdatePricesAndListPositions([
      { id: idA, price: 15, listPosition: 9 },
      { id: idB, price: 20, listPosition: null },
    ]);
    expect(res.updated).toBe(2);

    const rows = service.getInventory();
    const a = rows.find((r) => r.id === idA);
    const b = rows.find((r) => r.id === idB);
    expect(a?.price).toBe(15);
    expect(a?.listPosition).toBe(9);
    expect(b?.price).toBe(20);
    expect(b?.listPosition).toBeNull();
    db.close();
  });

  it('rejects invalid price', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    const idA = db
      .prepare(
        'INSERT INTO inventory (name, description, price, itemTypeId, quantity, listPosition) VALUES (?, NULL, ?, ?, 0, ?)',
      )
      .run('A', 10, t1, 1).lastInsertRowid as number;

    const service = createTestDb(db);
    expect(() =>
      service.bulkUpdatePricesAndListPositions([
        { id: idA, price: -1, listPosition: 1 },
      ]),
    ).toThrow(/Invalid price/);
    db.close();
  });

  it('rejects negative list #', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const t1 = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    const idA = db
      .prepare(
        'INSERT INTO inventory (name, description, price, itemTypeId, quantity, listPosition) VALUES (?, NULL, ?, ?, 0, ?)',
      )
      .run('A', 10, t1, 1).lastInsertRowid as number;

    const service = createTestDb(db);
    expect(() =>
      service.bulkUpdatePricesAndListPositions([
        { id: idA, price: 10, listPosition: -1 },
      ]),
    ).toThrow(/Invalid list #/);
    db.close();
  });
});

describe('InventoryService attribute definitions', () => {
  const seedDef = (db: any, key: string, label: string) =>
    db
      .prepare(
        'INSERT INTO attribute_definitions (key, label, valueType, sortOrder) VALUES (?, ?, ?, 0)',
      )
      .run(key, label, 'text').lastInsertRowid as number;

  it('appends new attributes after the highest order, even after a delete', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const service = createTestDb(db);

    service.upsertAttributeDefinition({
      key: 'a',
      label: 'A',
      valueType: 'text',
    });
    service.upsertAttributeDefinition({
      key: 'b',
      label: 'B',
      valueType: 'text',
    });
    service.upsertAttributeDefinition({
      key: 'c',
      label: 'C',
      valueType: 'text',
    });
    expect(service.getAttributeDefinitions().map((d) => d.sortOrder)).toEqual([
      1, 2, 3,
    ]);

    // delete from the middle: a row-count based order would reuse 3 and collide
    const middle = service
      .getAttributeDefinitions()
      .find((d) => d.key === 'b') as { id: number };
    service.deleteAttributeDefinition(middle.id);
    service.upsertAttributeDefinition({
      key: 'd',
      label: 'D',
      valueType: 'text',
    });

    const orders = service.getAttributeDefinitions().map((d) => d.sortOrder);
    expect(orders).toEqual([1, 3, 4]);
    // and no two definitions share an order
    expect(new Set(orders).size).toBe(orders.length);
    db.close();
  });

  it('normalises order to 1..N on reorder, healing gaps and duplicates', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    // deliberately messy starting state: a gap and a duplicate
    db.prepare(
      'INSERT INTO attribute_definitions (key,label,valueType,sortOrder) VALUES (?,?,?,?)',
    ).run('a', 'A', 'text', 5);
    db.prepare(
      'INSERT INTO attribute_definitions (key,label,valueType,sortOrder) VALUES (?,?,?,?)',
    ).run('b', 'B', 'text', 5);
    db.prepare(
      'INSERT INTO attribute_definitions (key,label,valueType,sortOrder) VALUES (?,?,?,?)',
    ).run('c', 'C', 'text', 99);

    const service = createTestDb(db);
    const byKey = (k: string) =>
      service.getAttributeDefinitions().find((d) => d.key === k)!.id;
    const ok = service.reorderAttributeDefinitions([
      byKey('c'),
      byKey('a'),
      byKey('b'),
    ]);

    expect(ok).toBe(true);
    expect(
      service.getAttributeDefinitions().map((d) => [d.key, d.sortOrder]),
    ).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', 3],
    ]);
    db.close();
  });

  it('ignores unknown ids and an empty reorder', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const service = createTestDb(db);
    service.upsertAttributeDefinition({
      key: 'a',
      label: 'A',
      valueType: 'text',
    });
    const { id } = service.getAttributeDefinitions()[0];

    expect(service.reorderAttributeDefinitions([])).toBe(false);
    expect(service.reorderAttributeDefinitions([999])).toBe(false);
    // a known id mixed with junk still applies to the known one
    expect(service.reorderAttributeDefinitions([999, id])).toBe(true);
    expect(service.getAttributeDefinitions()[0].sortOrder).toBe(1);
    db.close();
  });

  it('reports how many items use each attribute', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    seedDef(db, 'size_in', 'Paper size');
    seedDef(db, 'unused_key', 'Unused');
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, ?)',
    ).run('A', JSON.stringify({ size_in: '5 x 9' }));
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, ?)',
    ).run('B', JSON.stringify({ size_in: '6 x 9' }));
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, NULL)',
    ).run('C');

    const service = createTestDb(db);
    const defs = service.getAttributeDefinitions();
    const byKey = Object.fromEntries(defs.map((d) => [d.key, d.usageCount]));
    expect(byKey).toEqual({ size_in: 2, unused_key: 0 });
    db.close();
  });

  it('deletes an unused attribute but defers one in use to a confirmation', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const usedId = seedDef(db, 'size_in', 'Paper size');
    const unusedId = seedDef(db, 'unused_key', 'Unused');
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, ?)',
    ).run('A', JSON.stringify({ size_in: '5 x 9' }));

    const service = createTestDb(db);
    expect(service.deleteAttributeDefinition(unusedId)).toEqual({
      deleted: true,
      usageCount: 0,
      valuesRemoved: 0,
    });
    // in use: not deleted yet, and reports how many items are affected
    expect(service.deleteAttributeDefinition(usedId)).toEqual({
      deleted: false,
      usageCount: 1,
      valuesRemoved: 0,
    });
    expect(service.getAttributeDefinitions().map((d) => d.key)).toEqual([
      'size_in',
    ]);
    db.close();
  });

  it('force-deletes an in-use attribute and strips it from every item', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const usedId = seedDef(db, 'size_in', 'Paper size');
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, ?)',
    ).run('A', JSON.stringify({ size_in: '5 x 9', pages: 100 }));
    // this item keeps nothing else, so its attributes should end up NULL
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, ?)',
    ).run('B', JSON.stringify({ size_in: '6 x 9' }));

    const service = createTestDb(db);
    expect(service.deleteAttributeDefinition(usedId, true)).toEqual({
      deleted: true,
      usageCount: 2,
      valuesRemoved: 2,
    });
    expect(service.getAttributeDefinitions()).toEqual([]);

    const rows = db
      .prepare('SELECT name, attributes FROM inventory ORDER BY name')
      .all() as Array<{ name: string; attributes: string | null }>;
    // other keys survive; an item left with nothing stores NULL
    expect(JSON.parse(rows[0].attributes as string)).toEqual({ pages: 100 });
    expect(rows[1].attributes).toBeNull();
    db.close();
  });

  it('leaves items without the attribute untouched when force-deleting', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const id = seedDef(db, 'size_in', 'Paper size');
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, ?)',
    ).run('HasIt', JSON.stringify({ size_in: '5 x 9' }));
    db.prepare(
      'INSERT INTO inventory (name, price, quantity, attributes) VALUES (?, 1, 0, ?)',
    ).run('Other', JSON.stringify({ pages: 50 }));

    const service = createTestDb(db);
    expect(service.deleteAttributeDefinition(id, true).valuesRemoved).toBe(1);
    const other = db
      .prepare("SELECT attributes FROM inventory WHERE name = 'Other'")
      .get() as { attributes: string };
    expect(JSON.parse(other.attributes)).toEqual({ pages: 50 });
    db.close();
  });

  it('drops blank values so "has attributes" stays meaningful', () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const id = db
      .prepare('INSERT INTO inventory (name, price, quantity) VALUES (?, 1, 0)')
      .run('A').lastInsertRowid as number;

    const service = createTestDb(db);
    service.updateInventoryAttributes(id, { a: 'x', b: '', c: null });
    const stored = db
      .prepare('SELECT attributes FROM inventory WHERE id = ?')
      .get(id) as { attributes: string | null };
    expect(JSON.parse(stored.attributes as string)).toEqual({ a: 'x' });

    // clearing everything stores NULL rather than an empty object
    service.updateInventoryAttributes(id, { a: '' });
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

describe('InventoryService display title (migration 023)', () => {
  const setup = () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const typeId = db
      .prepare('INSERT INTO item_types (name, isActive) VALUES (?, 1)')
      .run('T1').lastInsertRowid as number;
    return { db, typeId, service: createTestDb(db) };
  };
  const titleOf = (db: Database.Database, name: string) =>
    (
      db.prepare('SELECT title FROM inventory WHERE name = ?').get(name) as {
        title: string | null;
      }
    ).title;

  it('stores a title given on create', () => {
    const { db, typeId, service } = setup();
    service.insertItem({
      name: 'H ABU BAKR',
      price: 40,
      title: 'Hazrat Abu Bakr Siddiq (RA)',
      itemTypeId: typeId,
    });
    expect(titleOf(db, 'H ABU BAKR')).toBe('Hazrat Abu Bakr Siddiq (RA)');
    db.close();
  });

  it('stores NULL rather than an empty string when left blank', () => {
    // "no title" must have one representation: a consumer choosing between a
    // stored title and a composed one would otherwise have to test for both
    const { db, typeId, service } = setup();
    service.insertItem({
      name: 'S-23-G',
      price: 1080,
      title: '   ',
      itemTypeId: typeId,
    });
    expect(titleOf(db, 'S-23-G')).toBeNull();
    db.close();
  });

  it('updates a title, and clearing it restores NULL', () => {
    const { db, typeId, service } = setup();
    service.insertItem({ name: 'PEGHAM', price: 100, itemTypeId: typeId });
    const { id } = db
      .prepare('SELECT id FROM inventory WHERE name = ?')
      .get('PEGHAM') as {
      id: number;
    };

    service.updateItem({ id, price: 100, title: 'Paigham' });
    expect(titleOf(db, 'PEGHAM')).toBe('Paigham');

    service.updateItem({ id, price: 100, title: '' });
    expect(titleOf(db, 'PEGHAM')).toBeNull();
    db.close();
  });

  it('leaves the identifying name alone when the title changes', () => {
    // `name` is identity: it matches the photograph folder, the storefront SKU
    // and the ad-feed id, so a title edit must never touch it
    const { db, typeId, service } = setup();
    service.insertItem({ name: 'H ALI', price: 40, itemTypeId: typeId });
    const { id } = db
      .prepare('SELECT id FROM inventory WHERE name = ?')
      .get('H ALI') as {
      id: number;
    };
    service.updateItem({ id, price: 40, title: 'Hazrat Ali (RA)' });
    expect(
      (
        db.prepare('SELECT name FROM inventory WHERE id = ?').get(id) as {
          name: string;
        }
      ).name,
    ).toBe('H ALI');
    db.close();
  });
});
