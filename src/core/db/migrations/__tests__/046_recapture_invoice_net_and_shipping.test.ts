import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';

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

describe('migration 046 — recapture net price and shipping', () => {
  it('rebuilds capture triggers so netPrice and shippingCharges are in the row image', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    const itemTrigger = db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE name = 'trg_sync_capture_invoice_items_insert'`,
      )
      .get() as { sql: string };
    const invoiceTrigger = db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE name = 'trg_sync_capture_invoices_insert'`,
      )
      .get() as { sql: string };

    expect(itemTrigger.sql).toContain('netPrice');
    expect(invoiceTrigger.sql).toContain('shippingCharges');
    expect(invoiceTrigger.sql).toContain('shippingAccountId');

    db.close();
  });
});
