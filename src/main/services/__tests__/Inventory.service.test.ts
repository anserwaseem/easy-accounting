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
      quantity REAL DEFAULT 0
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
