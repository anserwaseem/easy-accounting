import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../bootstrap';
import { CORE_MIGRATIONS } from '..';

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

interface InvoiceTimestamps {
  createdAt: string | null;
  updatedAt: string | null;
}

function invoiceTimestamps(
  db: Database.Database,
  invoiceNumber: number,
): InvoiceTimestamps {
  return db
    .prepare(
      `SELECT createdAt, updatedAt FROM invoices WHERE invoiceNumber = ?`,
    )
    .get(invoiceNumber) as InvoiceTimestamps;
}

describe('core migration 035 (insert-timestamp triggers fill only, never overwrite)', () => {
  it('is registered exactly once in CORE_MIGRATIONS, immediately after 034', () => {
    const names = CORE_MIGRATIONS.map((m) => m.name);
    expect(
      names.filter((n) => n === '035_insert_timestamps_fill_only'),
    ).toHaveLength(1);
    expect(names.indexOf('035_insert_timestamps_fill_only')).toBe(
      names.indexOf('034_suppress_timestamp_triggers_during_apply') + 1,
    );
  });

  it('via bootstrapDatabase, runs exactly once per database (bookkeeping guard) even across repeated bootstraps', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);

    await bootstrapDatabase(driver);
    await bootstrapDatabase(driver);
    await bootstrapDatabase(driver);

    const applied = db
      .prepare(
        `SELECT COUNT(*) AS c FROM migrations WHERE name = '035_insert_timestamps_fill_only'`,
      )
      .get() as { c: number };
    expect(applied.c).toBe(1);

    db.close();
  });

  /**
   * A row's `uuid` is supplied explicitly on every INSERT below that expects
   * `createdAt`/`updatedAt` to survive verbatim. Not incidental: migration
   * 029's `trg_sync_capture_<table>_insert` (AFTER INSERT, unrelated to this
   * migration) backfills a NULL `uuid` via its own `UPDATE ... WHERE uuid IS
   * NULL`, and `after_update_<table>_add_timestamp` (034, untouched by 035)
   * has no `OF <columns>` restriction — it fires on ANY UPDATE to the row,
   * uuid-only included — so an INSERT that leaves `uuid` NULL gets its
   * `updatedAt` stomped by THAT cascade regardless of anything this
   * migration's own insert trigger does. Real imports don't hit this: a
   * source already on migration 024+ (uuid exists) always carries a real,
   * non-NULL `uuid` on every row — `copyTable` (src/core/db/import.ts)
   * copies it like any other intersecting column — so this fixture mirrors
   * that, not an artificial one. A source that PREDATES 024 (no `uuid`
   * column to copy at all) does still hit the uuid-backfill cascade on
   * import and loses `updatedAt` precision as a result — a known, narrower
   * residual case, see 035's own doc comment.
   */
  describe("fill-only insert timestamps (no sync_state.applying involved — a plain local write, e.g. import's copyTable)", () => {
    let db: Database.Database;
    let driver: BetterSqliteDriver;
    let accountId: number;

    beforeEach(async () => {
      db = new Database(':memory:');
      driver = new BetterSqliteDriver(db);
      await bootstrapDatabase(driver);

      // A real users -> chart -> account chain: `invoices.accountId` is a
      // real FOREIGN KEY (schemaSnapshot.ts) and this build enforces it.
      db.prepare(
        `INSERT INTO users (username, password_hash, status) VALUES ('owner', 'x', 1)`,
      ).run();
      const userId = (
        db.prepare(`SELECT id FROM users WHERE username = 'owner'`).get() as {
          id: number;
        }
      ).id;
      db.prepare(
        `INSERT INTO chart (date, name, type, userId) VALUES ('2020-01-01', 'Current Asset', 'Asset', @userId)`,
      ).run({ userId });
      const chartId = (
        db
          .prepare(`SELECT id FROM chart WHERE name = 'Current Asset'`)
          .get() as {
          id: number;
        }
      ).id;
      db.prepare(
        `INSERT INTO account (chartId, name, code) VALUES (@chartId, 'Customer', '1-1')`,
      ).run({ chartId });
      accountId = (
        db.prepare(`SELECT id FROM account WHERE name = 'Customer'`).get() as {
          id: number;
        }
      ).id;
    });

    afterEach(() => db.close());

    it("an INSERT carrying explicit old createdAt/updatedAt (import's copyTable shape) keeps them verbatim — not stomped to now, the field bug this migration fixes", () => {
      const OLD_TS = '2015-05-30 10:00:00';

      // uuid is also supplied explicitly here — see this describe block's
      // own doc comment just above for why: migration 029's own
      // `trg_sync_capture_invoices_insert` backfills a NULL uuid on any
      // INSERT that doesn't supply one, and that backfill UPDATE would
      // itself cascade into `after_update_invoices_add_timestamp` (an
      // unrelated confound this test isn't about — see this migration's own
      // doc comment's "residual case" note). `copyTable` always carries the
      // source row's real uuid when the source has the column at all (same
      // column-intersection copy as every other field), so this mirrors the
      // realistic import shape, not an artificial one.
      db.prepare(
        `INSERT INTO invoices
           (invoiceNumber, accountId, invoiceType, date, totalAmount, createdAt, updatedAt, uuid)
         VALUES (3001, @accountId, 'Sale', '2015-05-30', 100, @createdAt, @updatedAt, 'fixture-uuid-3001')`,
      ).run({ accountId, createdAt: OLD_TS, updatedAt: OLD_TS });

      const row = invoiceTimestamps(db, 3001);
      expect(row.createdAt).toBe(OLD_TS);
      expect(row.updatedAt).toBe(OLD_TS);
      // The "Edited" pill's own predicate (updatedAt > createdAt,
      // src/renderer/lib/invoiceUtils.ts) must read false here: a freshly
      // imported, never-edited row must never look edited.
      expect(row.updatedAt! > row.createdAt!).toBe(false);
    });

    it('an INSERT carrying a genuine createdAt < updatedAt (an already-edited imported row) keeps BOTH exactly as given', () => {
      const CREATED = '2016-02-01 09:00:00';
      const EDITED = '2018-11-20 16:45:00';

      db.prepare(
        `INSERT INTO invoices
           (invoiceNumber, accountId, invoiceType, date, totalAmount, createdAt, updatedAt, uuid)
         VALUES (3002, @accountId, 'Sale', '2016-02-01', 300, @createdAt, @updatedAt, 'fixture-uuid-3002')`,
      ).run({ accountId, createdAt: CREATED, updatedAt: EDITED });

      const row = invoiceTimestamps(db, 3002);
      expect(row.createdAt).toBe(CREATED);
      expect(row.updatedAt).toBe(EDITED);
      // A row that really was edited must keep looking edited.
      expect(row.updatedAt! > row.createdAt!).toBe(true);
    });

    it('an INSERT with NO createdAt/updatedAt still gets both stamped to now — legacy fill behavior intact for every ordinary application write', () => {
      db.prepare(
        `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount, uuid)
         VALUES (3003, @accountId, 'Sale', '2020-01-01', 50, 'fixture-uuid-3003')`,
      ).run({ accountId });

      const row = invoiceTimestamps(db, 3003);
      expect(row.createdAt).not.toBeNull();
      expect(row.updatedAt).not.toBeNull();
      expect(row.createdAt).toBe(row.updatedAt);
    });

    it('a subsequent plain UPDATE still bumps updatedAt — the after_update trigger is untouched by this migration', () => {
      const OLD_TS = '2015-05-30 10:00:00';
      db.prepare(
        `INSERT INTO invoices
           (invoiceNumber, accountId, invoiceType, date, totalAmount, createdAt, updatedAt, uuid)
         VALUES (3004, @accountId, 'Sale', '2015-05-30', 100, @createdAt, @updatedAt, 'fixture-uuid-3004')`,
      ).run({ accountId, createdAt: OLD_TS, updatedAt: OLD_TS });

      const beforeUpdate = invoiceTimestamps(db, 3004);
      expect(beforeUpdate.updatedAt).toBe(OLD_TS); // sanity: the fix landed

      db.prepare(
        `UPDATE invoices SET totalAmount = 999 WHERE invoiceNumber = 3004`,
      ).run();

      const afterUpdate = invoiceTimestamps(db, 3004);
      // createdAt is never touched by an UPDATE, guard or no guard.
      expect(afterUpdate.createdAt).toBe(OLD_TS);
      // A genuine local edit bumps updatedAt to now — the trigger this
      // migration deliberately leaves alone.
      expect(afterUpdate.updatedAt).not.toBe(OLD_TS);
      expect(afterUpdate.updatedAt! > afterUpdate.createdAt!).toBe(true);
    });
  });
});
