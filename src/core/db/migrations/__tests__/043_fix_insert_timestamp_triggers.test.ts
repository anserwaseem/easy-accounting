import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { CORE_MIGRATIONS } from '..';
import { migration043 } from '../043_fix_insert_timestamp_triggers';
import { isPersistedRowEdited } from '../../../../renderer/lib/invoiceUtils';

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

describe('core migration 043 (fix insert timestamp triggers and repair UTC createdAt)', () => {
  it('is registered in CORE_MIGRATIONS', () => {
    expect(
      CORE_MIGRATIONS.some(
        (m) => m.name === '043_fix_insert_timestamp_triggers',
      ),
    ).toBe(true);
  });

  describe('timestamp trigger behavior with bootstrapped database', () => {
    let db: InstanceType<typeof Database>;
    let driver: BetterSqliteDriver;
    let accountId: number;

    beforeEach(async () => {
      db = new Database(':memory:');
      driver = new BetterSqliteDriver(db);
      await bootstrapDatabase(driver);

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
    });

    afterEach(() => db.close());

    it('ordinary application invoice insert (no createdAt, no updatedAt, no uuid) has matching local timestamps and is NOT marked edited', () => {
      // Ordinary application write issued by InvoiceService.insertInvoice
      db.prepare(
        `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount)
         VALUES (4001, @accountId, 'Sale', '2026-10-03', 250)`,
      ).run({ accountId });

      const row = db
        .prepare(
          `SELECT createdAt, updatedAt, uuid FROM invoices WHERE invoiceNumber = 4001`,
        )
        .get() as { createdAt: string; updatedAt: string; uuid: string };

      expect(row.createdAt).not.toBeNull();
      expect(row.updatedAt).not.toBeNull();
      expect(row.createdAt).toBe(row.updatedAt);
      expect(row.uuid).not.toBeNull();
      expect(isPersistedRowEdited(row)).toBe(false);
    });

    it('subsequent edit on an invoice updates updatedAt and marks it edited', async () => {
      const EARLIER_TS = '2026-10-03 10:00:00';
      db.prepare(
        `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount, createdAt, updatedAt, uuid)
         VALUES (4002, @accountId, 'Sale', '2026-10-03', 250, @ts, @ts, 'uuid-4002')`,
      ).run({ accountId, ts: EARLIER_TS });

      // An application edit updating totalAmount
      db.prepare(
        `UPDATE invoices SET totalAmount = 500 WHERE invoiceNumber = 4002`,
      ).run();

      const row = db
        .prepare(
          `SELECT createdAt, updatedAt FROM invoices WHERE invoiceNumber = 4002`,
        )
        .get() as { createdAt: string; updatedAt: string };

      expect(row.createdAt).toBe(EARLIER_TS);
      expect(row.updatedAt > row.createdAt).toBe(true);
      expect(isPersistedRowEdited(row)).toBe(true);
    });

    it('import with explicit historical timestamps preserves them verbatim and does not mark row edited', () => {
      const HISTORICAL_TS = '2018-06-15 14:30:00';

      db.prepare(
        `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount, createdAt, updatedAt, uuid)
         VALUES (4003, @accountId, 'Sale', '2018-06-15', 100, @ts, @ts, 'uuid-4003')`,
      ).run({ accountId, ts: HISTORICAL_TS });

      const row = db
        .prepare(
          `SELECT createdAt, updatedAt FROM invoices WHERE invoiceNumber = 4003`,
        )
        .get() as { createdAt: string; updatedAt: string };

      expect(row.createdAt).toBe(HISTORICAL_TS);
      expect(row.updatedAt).toBe(HISTORICAL_TS);
      expect(isPersistedRowEdited(row)).toBe(false);
    });

    it('repairs invoices where createdAt was stored as UTC and updatedAt was local time', async () => {
      // Create a corrupted invoice mimicking the bug under migration 040
      const utcTime = '2026-10-03 13:07:22';
      const localTime = '2026-10-03 18:07:22';

      db.prepare(
        `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount, createdAt, updatedAt, uuid)
         VALUES (4004, @accountId, 'Sale', '2026-10-03', 100, @createdAt, @updatedAt, 'uuid-4004')`,
      ).run({ accountId, createdAt: utcTime, updatedAt: localTime });

      const before = db
        .prepare(
          `SELECT createdAt, updatedAt FROM invoices WHERE invoiceNumber = 4004`,
        )
        .get() as { createdAt: string; updatedAt: string };
      expect(isPersistedRowEdited(before)).toBe(true);

      // Run migration 043 up (which performs the repair)
      await migration043.up(driver);

      const after = db
        .prepare(
          `SELECT createdAt, updatedAt FROM invoices WHERE invoiceNumber = 4004`,
        )
        .get() as { createdAt: string; updatedAt: string };

      expect(after.createdAt).toBe(localTime);
      expect(after.updatedAt).toBe(localTime);
      expect(isPersistedRowEdited(after)).toBe(false);
    });
  });
});
