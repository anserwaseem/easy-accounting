import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { CORE_MIGRATIONS } from '..';
import { migration048 } from '../048_heal_duplicate_invoice_lines';

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

describe('core migration 048 (heal duplicate invoice lines and journals)', () => {
  it('is registered in CORE_MIGRATIONS', () => {
    expect(
      CORE_MIGRATIONS.some(
        (m) => m.name === '048_heal_duplicate_invoice_lines',
      ),
    ).toBe(true);
  });

  describe('healing behavior on duplicate items and journals', () => {
    let db: InstanceType<typeof Database>;
    let driver: BetterSqliteDriver;
    let accountId: number;
    let itemId: number;
    let invoiceId: number;

    beforeEach(async () => {
      db = new Database(':memory:');
      driver = new BetterSqliteDriver(db);
      await bootstrapDatabase(driver);

      // Seed chart and account
      const chart = db
        .prepare(
          `INSERT INTO chart (date, name, type) VALUES ('2020-01-01', 'Receivables', 'Asset')`,
        )
        .run();
      accountId = Number(
        db
          .prepare(
            `INSERT INTO account (chartId, name) VALUES (?, 'Customer A')`,
          )
          .run(chart.lastInsertRowid).lastInsertRowid,
      );

      // Seed inventory item with starting quantity 100
      itemId = Number(
        db
          .prepare(
            `INSERT INTO inventory (name, description, price, quantity) VALUES ('ITEM-1', 'Test Item', 100, 100)`,
          )
          .run().lastInsertRowid,
      );

      // Seed invoice
      invoiceId = Number(
        db
          .prepare(
            `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount)
             VALUES (9999, @accountId, 'Sale', '2026-10-03', 1000)`,
          )
          .run({ accountId }).lastInsertRowid,
      );

      // Seed duplicate line items (2 lines of 10 qty at 100 price, 0 discount)
      db.prepare(
        `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, uuid)
         VALUES (@invoiceId, @itemId, 10, 100, 0, 'uuid-line-1')`,
      ).run({ invoiceId, itemId });

      db.prepare(
        `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, uuid)
         VALUES (@invoiceId, @itemId, 10, 100, 0, 'uuid-line-2')`,
      ).run({ invoiceId, itemId });

      // Seed duplicate journals
      const j1 = db
        .prepare(
          `INSERT INTO journal (date, narration, billNumber, discountPercentage, invoiceId, uuid)
           VALUES ('2026-10-03', 'Sale Invoice #9999', 9999, 0, @invoiceId, 'uuid-journal-1')`,
        )
        .run({ invoiceId }).lastInsertRowid;
      db.prepare(
        `INSERT INTO journal_entry (journalId, debitAmount, creditAmount, accountId, uuid)
         VALUES (?, 1000, 0, ?, 'uuid-entry-1')`,
      ).run(j1, accountId);

      const j2 = db
        .prepare(
          `INSERT INTO journal (date, narration, billNumber, discountPercentage, invoiceId, uuid)
           VALUES ('2026-10-03', 'Sale Invoice #9999', 9999, 0, @invoiceId, 'uuid-journal-2')`,
        )
        .run({ invoiceId }).lastInsertRowid;
      db.prepare(
        `INSERT INTO journal_entry (journalId, debitAmount, creditAmount, accountId, uuid)
         VALUES (?, 1000, 0, ?, 'uuid-entry-2')`,
      ).run(j2, accountId);
    });

    afterEach(() => db.close());

    it('removes duplicate line item, duplicate journal and synchronizes stock', async () => {
      // Prior to migration: 2 invoice items and 2 journals exist
      const itemsBefore = db
        .prepare(`SELECT count(*) as c FROM invoice_items WHERE invoiceId = ?`)
        .get(invoiceId) as { c: number };
      expect(itemsBefore.c).toBe(2);

      const journalsBefore = db
        .prepare(`SELECT count(*) as c FROM journal WHERE invoiceId = ?`)
        .get(invoiceId) as { c: number };
      expect(journalsBefore.c).toBe(2);

      // Run migration 048
      await migration048.up(driver);

      // Exactly 1 line item remains
      const itemsAfter = db
        .prepare(
          `SELECT id, uuid, quantity FROM invoice_items WHERE invoiceId = ?`,
        )
        .all(invoiceId) as Array<{
        id: number;
        uuid: string;
        quantity: number;
      }>;
      expect(itemsAfter).toHaveLength(1);
      expect(itemsAfter[0].uuid).toBe('uuid-line-1');

      // Exactly 1 journal remains
      const journalsAfter = db
        .prepare(`SELECT id, uuid FROM journal WHERE invoiceId = ?`)
        .all(invoiceId) as Array<{ id: number; uuid: string }>;
      expect(journalsAfter).toHaveLength(1);
      expect(journalsAfter[0].uuid).toBe('uuid-journal-1');

      // Journal entry for deleted journal is also removed
      const entriesAfter = db
        .prepare(`SELECT * FROM journal_entry WHERE journalId = ?`)
        .all(journalsAfter[0].id);
      expect(entriesAfter).toHaveLength(1);

      // Stored quantity matches inventory_quantity_view
      const stored = (
        db
          .prepare(`SELECT quantity FROM inventory WHERE id = ?`)
          .get(itemId) as { quantity: number }
      ).quantity;
      const viewQty = (
        db
          .prepare(
            `SELECT quantity FROM inventory_quantity_view WHERE inventoryId = ?`,
          )
          .get(itemId) as { quantity: number }
      ).quantity;
      expect(stored).toBe(viewQty);
    });

    it('calling migration048.up is idempotent', async () => {
      await migration048.up(driver);
      await expect(migration048.up(driver)).resolves.not.toThrow();

      const items = db
        .prepare(`SELECT count(*) as c FROM invoice_items WHERE invoiceId = ?`)
        .get(invoiceId) as { c: number };
      expect(items.c).toBe(1);
    });
  });
});
