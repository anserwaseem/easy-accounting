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
});
