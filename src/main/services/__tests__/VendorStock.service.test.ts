import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { VendorStockService } from '../VendorStock.service';

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

const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, '../../../sql/schema.sql'),
  'utf-8',
);

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');
const MIGRATIONS: { up: (db: Database.Database) => unknown }[] = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d+\.js$/.test(f))
  .sort()
  // eslint-disable-next-line global-require, import/no-dynamic-require
  .map((f) => require(path.join(MIGRATIONS_DIR, f)));

function seedSchema(db: Database.Database) {
  db.exec(SCHEMA_SQL);
  MIGRATIONS.forEach((migration) => migration.up(db));
}

function createService(db: Database.Database): VendorStockService {
  const service = Object.create(VendorStockService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).initPreparedStatements();
  return service as VendorStockService;
}

function seedVendorAndItem(db: Database.Database): {
  vendorId: number;
  inventoryId: number;
  agentId: number;
} {
  db.prepare(
    `INSERT INTO users (id, username, password_hash, status) VALUES (1, 'test', 'x', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO chart (id, name, type, userId) VALUES (1, 'Creditors', 'Liability', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO account (id, chartId, name, code, isActive, tracksVendorStock)
     VALUES (10, 1, 'Vendor A', 'V1', 1, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO account (id, chartId, name, code, isActive, tracksVendorStock)
     VALUES (11, 1, 'Agent B', 'A1', 1, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO inventory (id, name, price, quantity) VALUES (100, 'Item-X', 10, 50)`,
  ).run();
  return { vendorId: 10, inventoryId: 100, agentId: 11 };
}

describe('VendorStockService', () => {
  it('issue increases vendor stock without changing warehouse qty', () => {
    const db = new Database(':memory:');
    seedSchema(db);
    const { vendorId, inventoryId } = seedVendorAndItem(db);
    const service = createService(db);

    const warehouseBefore = (
      db.prepare('SELECT quantity FROM inventory WHERE id = ?').get(inventoryId) as {
        quantity: number;
      }
    ).quantity;

    const result = service.createIssue({
      vendorAccountId: vendorId,
      date: '2026-01-15',
      items: [{ inventoryId, quantity: 20 }],
    });

    expect(result.success).toBe(true);

    const onHand = service.getOnHand(vendorId);
    expect(onHand).toHaveLength(1);
    expect(onHand[0].quantity).toBe(20);

    const warehouseAfter = (
      db.prepare('SELECT quantity FROM inventory WHERE id = ?').get(inventoryId) as {
        quantity: number;
      }
    ).quantity;
    expect(warehouseAfter).toBe(warehouseBefore);

    db.close();
  });

  it('purchase reduces tracked vendor stock but skips untracked accounts', () => {
    const db = new Database(':memory:');
    seedSchema(db);
    const { vendorId, inventoryId, agentId } = seedVendorAndItem(db);
    const service = createService(db);

    service.createIssue({
      vendorAccountId: vendorId,
      date: '2026-01-10',
      items: [{ inventoryId, quantity: 30 }],
    });

    service.applyPurchaseEffect({
      invoiceId: 1,
      date: '2026-01-20',
      lines: [{ accountId: vendorId, inventoryId, quantity: 12 }],
      direction: 'purchase',
    });

    expect(service.getOnHand(vendorId)[0].quantity).toBe(18);

    service.applyPurchaseEffect({
      invoiceId: 2,
      date: '2026-01-21',
      lines: [{ accountId: agentId, inventoryId, quantity: 5 }],
      direction: 'purchase',
    });

    // agent untracked — vendor qty unchanged; no agent stock row
    expect(service.getOnHand(vendorId)[0].quantity).toBe(18);
    expect(service.getOnHand(agentId)).toHaveLength(0);

    db.close();
  });

  it('purchase return restores vendor stock', () => {
    const db = new Database(':memory:');
    seedSchema(db);
    const { vendorId, inventoryId } = seedVendorAndItem(db);
    const service = createService(db);

    service.createIssue({
      vendorAccountId: vendorId,
      date: '2026-01-10',
      items: [{ inventoryId, quantity: 10 }],
    });
    service.applyPurchaseEffect({
      invoiceId: 1,
      date: '2026-01-20',
      lines: [{ accountId: vendorId, inventoryId, quantity: 10 }],
      direction: 'purchase',
    });
    service.applyPurchaseEffect({
      invoiceId: 1,
      date: '2026-01-22',
      lines: [{ accountId: vendorId, inventoryId, quantity: 10 }],
      direction: 'purchase_return',
    });

    expect(service.getOnHand(vendorId)[0].quantity).toBe(10);
    db.close();
  });

  it('activity report computes opening issued purchased closing', () => {
    const db = new Database(':memory:');
    seedSchema(db);
    const { vendorId, inventoryId } = seedVendorAndItem(db);
    const service = createService(db);

    service.setOpeningStock(
      vendorId,
      [{ name: 'Item-X', quantity: 100 }],
      '2026-01-01',
    );
    service.createIssue({
      vendorAccountId: vendorId,
      date: '2026-01-15',
      items: [{ inventoryId, quantity: 40 }],
    });
    service.applyPurchaseEffect({
      invoiceId: 9,
      date: '2026-01-20',
      lines: [{ accountId: vendorId, inventoryId, quantity: 25 }],
      direction: 'purchase',
    });

    const activity = service.getActivity({
      vendorAccountId: vendorId,
      startDate: '2026-01-10',
      endDate: '2026-01-31',
    });

    expect(activity.items).toHaveLength(1);
    const row = activity.items[0];
    expect(row.opening).toBe(100);
    expect(row.issued).toBe(40);
    expect(row.purchased).toBe(25);
    expect(row.closing).toBe(115);

    db.close();
  });

  it('rejects issue to untracked vendor', () => {
    const db = new Database(':memory:');
    seedSchema(db);
    const { agentId, inventoryId } = seedVendorAndItem(db);
    const service = createService(db);

    const result = service.createIssue({
      vendorAccountId: agentId,
      date: '2026-01-15',
      items: [{ inventoryId, quantity: 5 }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Track vendor stock/i);
    db.close();
  });

  it('updateIssue rewrites stock and lines', () => {
    const db = new Database(':memory:');
    seedSchema(db);
    const { vendorId, inventoryId } = seedVendorAndItem(db);
    db.prepare(
      `INSERT INTO inventory (id, name, price, quantity) VALUES (101, 'Item-Y', 10, 0)`,
    ).run();
    const service = createService(db);

    const created = service.createIssue({
      vendorAccountId: vendorId,
      date: '2026-01-15',
      items: [{ inventoryId, quantity: 20 }],
    });
    expect(created.success).toBe(true);
    expect(created.issueId).toBeDefined();

    const updated = service.updateIssue(created.issueId!, {
      vendorAccountId: vendorId,
      date: '2026-01-16',
      notes: 'corrected',
      items: [
        { inventoryId, quantity: 5 },
        { inventoryId: 101, quantity: 7 },
      ],
    });
    expect(updated.success).toBe(true);
    expect(updated.issueNumber).toBe(created.issueNumber);

    const onHand = service.getOnHand(vendorId);
    const byId = Object.fromEntries(
      onHand.map((r) => [r.inventoryId, r.quantity]),
    );
    expect(byId[inventoryId]).toBe(5);
    expect(byId[101]).toBe(7);

    const issue = service.getIssue(created.issueId!);
    expect(issue?.items).toHaveLength(2);
    expect(issue?.notes).toBe('corrected');
    expect(issue?.date.slice(0, 10)).toBe('2026-01-16');

    db.close();
  });

  it('deleteIssue reverses stock and removes the issue', () => {
    const db = new Database(':memory:');
    seedSchema(db);
    const { vendorId, inventoryId } = seedVendorAndItem(db);
    const service = createService(db);

    const created = service.createIssue({
      vendorAccountId: vendorId,
      date: '2026-01-15',
      items: [{ inventoryId, quantity: 20 }],
    });
    expect(created.issueId).toBeDefined();

    const deleted = service.deleteIssue(created.issueId!);
    expect(deleted.success).toBe(true);

    expect(service.getIssue(created.issueId!)).toBeNull();
    expect(service.getIssues()).toHaveLength(0);
    // qty row may remain at 0; on-hand filters non-zero
    expect(service.getOnHand(vendorId)).toHaveLength(0);

    const movementCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM vendor_stock_movements
           WHERE referenceType = 'vendor_issue' AND referenceId = ?`,
        )
        .get(created.issueId!) as { c: number }
    ).c;
    expect(movementCount).toBe(0);

    db.close();
  });
});
