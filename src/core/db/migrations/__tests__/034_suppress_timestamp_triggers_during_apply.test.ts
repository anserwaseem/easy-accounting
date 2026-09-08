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

/**
 * `sync_state.applying` toggled directly against the raw better-sqlite3
 * handle — the exact mechanism `SyncEngine.setApplying` uses (see
 * `SyncEngine.ts`'s "Echo suppression" doc comment) — so these tests can
 * exercise the guarded triggers without spinning up a full `SyncEngine` +
 * transport + second device. Migration 029 guarantees `sync_state` exists
 * by the time migration 034 (and therefore this test's `bootstrapDatabase`)
 * has run — see 034's own doc comment ("Why no runtime guard on
 * `sync_state` existing").
 */
function setApplying(db: Database.Database, applying: boolean): void {
  if (applying) {
    db.prepare(
      `INSERT INTO sync_state (key, value) VALUES ('applying', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
  } else {
    db.prepare(`DELETE FROM sync_state WHERE key = 'applying'`).run();
  }
}

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

describe('core migration 034 (suppress add_timestamp triggers during sync apply)', () => {
  it('is registered exactly once in CORE_MIGRATIONS, immediately after 033', () => {
    const names = CORE_MIGRATIONS.map((m) => m.name);
    expect(
      names.filter((n) => n === '034_suppress_timestamp_triggers_during_apply'),
    ).toHaveLength(1);
    expect(names.indexOf('034_suppress_timestamp_triggers_during_apply')).toBe(
      names.indexOf('033_sync_settings') + 1,
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
        `SELECT COUNT(*) AS c FROM migrations WHERE name = '034_suppress_timestamp_triggers_during_apply'`,
      )
      .get() as { c: number };
    expect(applied.c).toBe(1);

    db.close();
  });

  describe('timestamp fidelity (sync_state.applying)', () => {
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

    it('while applying: an INSERT carrying an explicit old createdAt/updatedAt (a pulled row image) keeps them verbatim — not stomped to apply-time, the field bug this migration fixes', () => {
      setApplying(db, true);
      const OLD_TS = '2020-01-01 12:00:00';

      db.prepare(
        `INSERT INTO invoices
           (invoiceNumber, accountId, invoiceType, date, totalAmount, createdAt, updatedAt)
         VALUES (1001, @accountId, 'Sale', '2020-01-01', 100, @createdAt, @updatedAt)`,
      ).run({ accountId, createdAt: OLD_TS, updatedAt: OLD_TS });

      const row = invoiceTimestamps(db, 1001);
      expect(row.createdAt).toBe(OLD_TS);
      expect(row.updatedAt).toBe(OLD_TS);
      // The "Edited" pill's own predicate (updatedAt > createdAt,
      // src/renderer/lib/invoiceUtils.ts) must read false here: a fresh
      // apply of a never-edited row must never look edited.
      expect(row.updatedAt! > row.createdAt!).toBe(false);
    });

    it('while applying: an UPDATE carrying an explicit updatedAt (a re-delivered row image) keeps that exact value — not bumped to apply-time, and createdAt is untouched', () => {
      setApplying(db, true);
      const OLD_TS = '2020-01-01 12:00:00';
      db.prepare(
        `INSERT INTO invoices
           (invoiceNumber, accountId, invoiceType, date, totalAmount, createdAt, updatedAt)
         VALUES (1002, @accountId, 'Sale', '2020-01-01', 100, @t, @t)`,
      ).run({ accountId, t: OLD_TS });

      // Distinct from OLD_TS (but still nowhere near "now") so this
      // assertion can tell "the UPDATE statement's own value survived"
      // apart from "the trigger happened to leave createdAt's old value in
      // place by coincidence".
      const REDELIVERED_UPDATED_AT = '2020-06-01 08:30:00';
      db.prepare(
        `UPDATE invoices SET totalAmount = 200, updatedAt = @u WHERE invoiceNumber = 1002`,
      ).run({ u: REDELIVERED_UPDATED_AT });

      const row = invoiceTimestamps(db, 1002);
      expect(row.createdAt).toBe(OLD_TS);
      expect(row.updatedAt).toBe(REDELIVERED_UPDATED_AT);
    });

    it("NOT applying (an ordinary local write): INSERT and UPDATE still stamp this device's own local clock exactly as before this migration — local writes are unaffected", () => {
      // sync_state.applying is unset by default — this is the ordinary,
      // pre-034 desktop/web write path.
      db.prepare(
        `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount)
         VALUES (2001, @accountId, 'Sale', '2020-01-01', 50)`,
      ).run({ accountId });
      const inserted = invoiceTimestamps(db, 2001);
      expect(inserted.createdAt).not.toBeNull();
      expect(inserted.createdAt).toBe(inserted.updatedAt);

      // As of 034 ALONE (i.e. if migration 035 had never landed), an INSERT
      // that explicitly supplies old timestamps outside of an apply would
      // still have been overridden — 034's insert trigger's UPDATE was
      // unconditional whenever APPLYING_GUARD passed, `applying` or not.
      // But this suite bootstraps the FULL migration chain, and 035 (see
      // src/core/db/migrations/035_insert_timestamps_fill_only.ts) changes
      // exactly this: the insert trigger now only FILLS a column the INSERT
      // left NULL, regardless of `applying` — so by the time this test runs,
      // explicit old timestamps on an ordinary local write are kept
      // verbatim, same as they would be under sync apply or import. This is
      // the CURRENT, correct behavior, not a regression of 034's own fix.
      //
      // uuid is supplied explicitly too — migration 029's own
      // `trg_sync_capture_invoices_insert` backfills a NULL uuid via its own
      // UPDATE, and (unrelated to anything 034/035 change) that backfill
      // cascades into `after_update_invoices_add_timestamp` regardless of
      // this fix, an unrelated confound this assertion isn't about — see
      // 035's own doc comment ("A second, independent source of the exact
      // same cascade").
      db.prepare(
        `INSERT INTO invoices
           (invoiceNumber, accountId, invoiceType, date, totalAmount, createdAt, updatedAt, uuid)
         VALUES (2002, @accountId, 'Sale', '2020-01-01', 50, '2000-01-01 00:00:00', '2000-01-01 00:00:00', 'fixture-uuid-2002')`,
      ).run({ accountId });
      const kept = invoiceTimestamps(db, 2002);
      expect(kept.createdAt).toBe('2000-01-01 00:00:00');
      expect(kept.updatedAt).toBe('2000-01-01 00:00:00');

      const createdAtBeforeUpdate = inserted.createdAt;
      db.prepare(
        `UPDATE invoices SET totalAmount = 999, updatedAt = '2000-01-01 00:00:00' WHERE invoiceNumber = 2001`,
      ).run();
      const updated = invoiceTimestamps(db, 2001);
      expect(updated.createdAt).toBe(createdAtBeforeUpdate); // UPDATE never touches createdAt, guard or no guard
      expect(updated.updatedAt).not.toBe('2000-01-01 00:00:00');
    });
  });
});
