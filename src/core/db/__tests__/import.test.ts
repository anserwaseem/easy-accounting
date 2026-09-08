import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../bootstrap';
import { applyFrozenWebSchema } from '../../../../scripts/generate-schema-snapshot';
import {
  BUSINESS_TABLES,
  importDatabase,
  looksLikeSqliteFile,
  readSourceMigrationVersion,
  SNAPSHOT_MIGRATION_VERSION,
  validateUploadedDatabase,
} from '../import';
import {
  INVENTORY_BASELINE_REASON,
  INVENTORY_BASELINE_DATE,
} from '../inventoryBaselineBackfill';

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

/** Builds a "desktop-format" database via the frozen web schema.sql + migrations 001..upToInclusive. */
function buildDesktopDatabase(upToInclusive: number): Database.Database {
  const db = new Database(':memory:');
  applyFrozenWebSchema(db, upToInclusive);
  return db;
}

/** A fresh destination database, bootstrapped exactly like the worker boots the real OPFS db. */
async function buildTargetDriver(): Promise<{
  db: Database.Database;
  driver: BetterSqliteDriver;
}> {
  const db = new Database(':memory:');
  const driver = new BetterSqliteDriver(db);
  await bootstrapDatabase(driver);
  return { db, driver };
}

function seedDesktopBusinessData(
  db: Database.Database,
  opts: { withUuid: boolean },
): void {
  const passwordHash = `${'deadbeef'.repeat(4)}:${'cafebabe'.repeat(8)}`; // salt:hash hex shape, content unchecked here
  db.prepare(
    `INSERT INTO users (id, username, password_hash, status) VALUES (1, 'imported-user', ?, 1)`,
  ).run(passwordHash);

  db.prepare(
    `INSERT INTO chart (id, date, name, userId, type) VALUES (1, '2024-01-01', 'Current Asset', 1, 'Asset')`,
  ).run();
  db.prepare(
    `INSERT INTO chart (id, date, name, userId, type) VALUES (2, '2024-01-01', 'Revenue', 1, 'Revenue')`,
  ).run();

  db.prepare(
    `INSERT INTO account (id, chartId, date, name) VALUES (1, 1, '2024-01-01', 'Cash')`,
  ).run();
  db.prepare(
    `INSERT INTO account (id, chartId, date, name) VALUES (2, 2, '2024-01-01', 'Sales')`,
  ).run();

  db.prepare(
    `INSERT INTO journal (id, date, narration, isPosted) VALUES (1, '2024-02-01', 'Opening cash sale', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO journal_entry (id, journalId, debitAmount, creditAmount, accountId) VALUES (1, 1, 500, 0, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO journal_entry (id, journalId, debitAmount, creditAmount, accountId) VALUES (2, 1, 0, 500, 2)`,
  ).run();
  db.prepare(
    `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType, linkedAccountId)
     VALUES (1, '2024-02-01', 'Journal #1', 1, 500, 0, 500, 'Dr', 2)`,
  ).run();
  db.prepare(
    `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType, linkedAccountId)
     VALUES (2, '2024-02-01', 'Journal #1', 2, 0, 500, 500, 'Cr', 1)`,
  ).run();

  db.prepare(
    `INSERT INTO inventory (id, name, price, quantity) VALUES (1, 'Widget', 200, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO inventory_opening_stock (id, inventoryId, quantity, asOfDate) VALUES (1, 1, 10, '2024-01-01')`,
  ).run();

  db.prepare(
    `INSERT INTO invoices (id, invoiceNumber, accountId, invoiceType, date, totalAmount)
     VALUES (1, 1, 1, 'Sale', '2024-03-01', 600)`,
  ).run();
  db.prepare(
    `INSERT INTO invoice_items (id, invoiceId, inventoryId, quantity, price) VALUES (1, 1, 1, 3, 200)`,
  ).run();

  if (opts.withUuid) {
    // Migration 024 added `uuid` on these tables — only stamp it when the
    // fixture is meant to represent an upload already on that migration.
    for (const table of [
      'chart',
      'account',
      'journal',
      'journal_entry',
      'ledger',
      'inventory',
      'inventory_opening_stock',
      'invoices',
      'invoice_items',
    ]) {
      const rows = db.prepare(`SELECT id FROM "${table}"`).all() as {
        id: number;
      }[];
      rows.forEach((row, i) => {
        db.prepare(`UPDATE "${table}" SET uuid = ? WHERE id = ?`).run(
          `${table}-uuid-${i}`,
          row.id,
        );
      });
    }
  }
}

describe('looksLikeSqliteFile', () => {
  it('accepts real SQLite file bytes', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (id INTEGER)');
    const bytes = db.serialize();
    expect(looksLikeSqliteFile(new Uint8Array(bytes))).toBe(true);
    db.close();
  });

  it('rejects non-SQLite bytes', () => {
    expect(
      looksLikeSqliteFile(new Uint8Array(Buffer.from('not a database'))),
    ).toBe(false);
    expect(looksLikeSqliteFile(new Uint8Array(4))).toBe(false);
  });
});

describe('validateUploadedDatabase', () => {
  it('rejects a database missing a minimum required table', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');
    const driver = new BetterSqliteDriver(db);

    const result = await validateUploadedDatabase(driver);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(
      /missing table/,
    );
    db.close();
  });

  it('refuses an upload newer than this app supports', async () => {
    const db = buildDesktopDatabase(28);
    // Always genuinely newer than whatever SNAPSHOT_MIGRATION_VERSION
    // currently is, rather than a number hardcoded once and left to drift
    // stale the next time a migration is added (see src/core/db/import.ts's
    // doc comment on that constant).
    db.prepare(
      `INSERT INTO migrations (name) VALUES ('${
        SNAPSHOT_MIGRATION_VERSION + 1
      }_some_future_migration')`,
    ).run();
    const driver = new BetterSqliteDriver(db);

    const result = await validateUploadedDatabase(driver);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(
      /newer version/,
    );
    db.close();
  });

  it('accepts and previews an older upload (pre-024, no uuid columns) with a warning', async () => {
    const db = buildDesktopDatabase(23);
    seedDesktopBusinessData(db, { withUuid: false });
    const driver = new BetterSqliteDriver(db);

    expect(await readSourceMigrationVersion(driver)).toBe(23);

    const result = await validateUploadedDatabase(driver);
    expect(result.ok).toBe(true);
    const preview = result as Extract<typeof result, { ok: true }>;
    expect(preview.sourceMigrationVersion).toBe(23);
    expect(preview.warnings.some((w) => /older/.test(w))).toBe(true);
    const accountRow = preview.tables.find((t) => t.name === 'account');
    expect(accountRow?.rows).toBe(2);
    db.close();
  });
});

describe('importDatabase', () => {
  it('replaces target business data with an older (pre-uuid) upload, filling uuid via the target schema trigger', async () => {
    const sourceDb = buildDesktopDatabase(23);
    seedDesktopBusinessData(sourceDb, { withUuid: false });
    const source = new BetterSqliteDriver(sourceDb);

    const { db: targetDb, driver: target } = await buildTargetDriver();
    // A pre-existing row that MUST be gone after the replace-import.
    await target.run(
      `INSERT INTO users (username, password_hash, status) VALUES ('stale-user', NULL, 1)`,
    );

    const summary = await importDatabase({ source, target });

    const byName = new Map(summary.tables.map((t) => [t.name, t.rows]));
    expect(byName.get('users')).toBe(1);
    expect(byName.get('account')).toBe(2);
    expect(byName.get('journal')).toBe(1);
    expect(byName.get('journal_entry')).toBe(2);
    expect(byName.get('ledger')).toBe(2);
    expect(byName.get('invoices')).toBe(1);
    expect(byName.get('invoice_items')).toBe(1);
    expect(byName.get('inventory')).toBe(1);
    expect(byName.get('inventory_opening_stock')).toBe(1);

    const users = await target.all<{ username: string }>(
      'SELECT username FROM users',
    );
    expect(users.map((u) => u.username)).toEqual(['imported-user']);

    // uuid backfilled by the target schema's own AFTER INSERT trigger,
    // since the pre-024 source had no uuid column to copy.
    const account = await target.get<{ uuid: string | null }>(
      'SELECT uuid FROM account WHERE id = 1',
    );
    expect(account?.uuid).toEqual(expect.any(String));
    expect(account?.uuid).not.toBeNull();

    // Trial balance / ledger_view equivalence checks ran and found no issue
    // for this internally-consistent fixture.
    expect(
      summary.warnings.some((w) => /Trial balance check failed/.test(w)),
    ).toBe(false);
    expect(summary.warnings.some((w) => /ledger_view derives/.test(w))).toBe(
      false,
    );

    targetDb.close();
    sourceDb.close();
  });

  it("preserves an already-migrated upload's own uuids instead of overwriting them", async () => {
    const sourceDb = buildDesktopDatabase(27);
    seedDesktopBusinessData(sourceDb, { withUuid: true });
    const source = new BetterSqliteDriver(sourceDb);

    const { db: targetDb, driver: target } = await buildTargetDriver();
    await importDatabase({ source, target });

    const account = await target.get<{ uuid: string }>(
      'SELECT uuid FROM account WHERE id = 1',
    );
    expect(account?.uuid).toBe('account-uuid-0');

    targetDb.close();
    sourceDb.close();
  });

  it('wipes all business tables even when the upload has none of them (minimum-viable empty database)', async () => {
    const sourceDb = buildDesktopDatabase(27);
    const source = new BetterSqliteDriver(sourceDb);

    const { db: targetDb, driver: target } = await buildTargetDriver();
    await target.run(
      `INSERT INTO users (username, password_hash, status) VALUES ('stale-user', NULL, 1)`,
    );

    const summary = await importDatabase({ source, target });
    expect(summary.tables.every((t) => t.rows === 0)).toBe(true);
    const users = await target.all('SELECT * FROM users');
    expect(users).toHaveLength(0);

    targetDb.close();
    sourceDb.close();
  });

  it('flags a genuinely irreconcilable ledger/journal mismatch as a plain, non-"harmless" warning', async () => {
    const sourceDb = buildDesktopDatabase(23);
    seedDesktopBusinessData(sourceDb, { withUuid: false });
    // A ledger row that is NOT the migration-025 "Opening Balance from B/S"
    // shape the backfill knows how to fix, and doesn't match the
    // `Journal #<id>` pattern `removeLedgerEffectOfJournals` uses either —
    // simulating "residual gap class 1/3" from checkImportIntegrity's doc
    // comment (e.g. a row whose backing journal was deleted through some
    // path that never stripped it). The backfill above has nothing to do
    // with this row, so it stays genuinely unreconciled after import.
    sourceDb
      .prepare(
        `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType)
       VALUES (3, '2024-01-01', 'Some Untracked Entry', 1, 1000, 0, 1500, 'Dr')`,
      )
      .run();
    const source = new BetterSqliteDriver(sourceDb);

    const { db: targetDb, driver: target } = await buildTargetDriver();
    const summary = await importDatabase({ source, target });

    const mismatchWarning = summary.warnings.find((w) =>
      /ledger_view derives/.test(w),
    );
    expect(mismatchWarning).toBeDefined();
    // No more "known, harmless" dismissal — plain numbers plus actionable
    // guidance instead (the warning does say "NOT ... harmless" explicitly,
    // so this checks for the dismissal phrasing, not the word in isolation).
    expect(mismatchWarning).not.toMatch(/known,? harmless/i);
    expect(mismatchWarning).toMatch(
      /1 row\(s\) beyond that remain unexplained/,
    );
    expect(mismatchWarning).toMatch(/export a copy/i);
    expect(mismatchWarning).toMatch(/contact support/i);

    // The warning now NAMES the offending row instead of only counting it:
    // account name (joined from `account`), date, debit/credit, particulars,
    // and the ledger row's own id — everything needed to go find it.
    expect(mismatchWarning).toMatch(/Cash/);
    expect(mismatchWarning).toMatch(/2024-01-01/);
    expect(mismatchWarning).toMatch(/debit 1000\.00/);
    expect(mismatchWarning).toMatch(/Some Untracked Entry/);
    expect(mismatchWarning).toMatch(/ledger row id 3/);

    targetDb.close();
    sourceDb.close();
  });

  it('backfills a pre-025 opening-balance row so it is balanced and visible in ledger_view, with the row count fully reconciled', async () => {
    const sourceDb = buildDesktopDatabase(23);
    seedDesktopBusinessData(sourceDb, { withUuid: false });
    // The real-world shape this whole change exists for: a pre-025 desktop
    // database's "Opening Balance from B/S" ledger row, written straight to
    // `ledger` by the old StatementService.setupLedgers with no backing
    // journal at all.
    sourceDb
      .prepare(
        `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType)
         VALUES (3, '2024-01-01', 'Opening Balance from B/S', 1, 1000, 0, 1000, 'Dr')`,
      )
      .run();
    const source = new BetterSqliteDriver(sourceDb);

    const { db: targetDb, driver: target } = await buildTargetDriver();
    const summary = await importDatabase({ source, target });

    // A journal now backs the imported opening-balance row.
    const journal = await target.get<{
      id: number;
      date: string;
      isPosted: number;
    }>(`SELECT id, date, isPosted FROM journal WHERE narration = ?`, [
      'Opening Balance from B/S',
    ]);
    expect(journal).toBeDefined();
    expect(journal?.date).toBe('2024-01-01');
    expect(journal?.isPosted).toBe(1);

    const entries = await target.all<{
      debitAmount: number;
      creditAmount: number;
      accountId: number;
    }>(
      `SELECT debitAmount, creditAmount, accountId FROM journal_entry WHERE journalId = ?`,
      [journal!.id],
    );
    expect(entries).toHaveLength(2);
    // Balanced: total debit == total credit across both entries.
    const totalDebit = entries.reduce((s, e) => s + e.debitAmount, 0);
    const totalCredit = entries.reduce((s, e) => s + e.creditAmount, 0);
    expect(totalDebit).toBe(totalCredit);
    // One side is the account's own, exactly as stored on the ledger row.
    expect(
      entries.some((e) => e.accountId === 1 && e.debitAmount === 1000),
    ).toBe(true);
    // The other side landed on a find-or-created "Opening Balance Equity"
    // account under an "Equity" chart.
    const equityAccount = await target.get<{ id: number; chartId: number }>(
      `SELECT id, chartId FROM account WHERE name = 'Opening Balance Equity'`,
    );
    expect(equityAccount).toBeDefined();
    expect(entries.some((e) => e.accountId === equityAccount!.id)).toBe(true);
    const equityChart = await target.get<{ type: string }>(
      `SELECT type FROM chart WHERE id = ?`,
      [equityAccount!.chartId],
    );
    expect(equityChart?.type).toBe('Equity');

    // ledger_view now derives a row for the opening-balance entry.
    const viewRow = await target.get(
      `SELECT * FROM ledger_view WHERE accountId = 1 AND particulars = 'Opening Balance from B/S'`,
    );
    expect(viewRow).toBeDefined();

    // The row count reconciles: no mismatch warning at all (the structural
    // Opening Balance Equity contra-row surplus is accounted for, and there
    // is no other residual gap in this fixture).
    expect(summary.warnings.some((w) => /ledger_view derives/.test(w))).toBe(
      false,
    );
    // A fully-explained import has no rows to name, so it produces no
    // unexplained-row detail listing at all (in either direction).
    expect(summary.warnings.some((w) => /with no matching/.test(w))).toBe(
      false,
    );

    targetDb.close();
    sourceDb.close();
  });

  it('does not duplicate journals for a source whose opening-balance rows are already migration-025+ backed (idempotent)', async () => {
    const sourceDb = buildDesktopDatabase(27);
    seedDesktopBusinessData(sourceDb, { withUuid: true });
    // Simulates a database already on migration 025+: one ledger row backed
    // by exactly the journal/journal_entry pair StatementService.setupLedgers
    // (or migration 025 itself) would have written — own side on the real
    // account, contra side on the Equity account.
    const equityChartId = Number(
      sourceDb
        .prepare(
          `INSERT INTO chart (date, name, type, userId) VALUES ('2024-01-01', 'Equity', 'Equity', 1)`,
        )
        .run().lastInsertRowid,
    );
    const equityAccountId = Number(
      sourceDb
        .prepare(
          `INSERT INTO account (chartId, name, code, isActive) VALUES (?, 'Opening Balance Equity', NULL, 1)`,
        )
        .run(equityChartId).lastInsertRowid,
    );
    sourceDb
      .prepare(
        `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType)
         VALUES (3, '2024-06-01', 'Opening Balance from B/S', 1, 2000, 0, 2000, 'Dr')`,
      )
      .run();
    const journalId = Number(
      sourceDb
        .prepare(
          `INSERT INTO journal (date, narration, isPosted, invoiceId) VALUES ('2024-06-01', 'Opening Balance from B/S', 1, NULL)`,
        )
        .run().lastInsertRowid,
    );
    sourceDb
      .prepare(
        `INSERT INTO journal_entry (journalId, debitAmount, accountId, creditAmount) VALUES (?, 2000, 1, 0)`,
      )
      .run(journalId);
    sourceDb
      .prepare(
        `INSERT INTO journal_entry (journalId, debitAmount, accountId, creditAmount) VALUES (?, 0, ?, 2000)`,
      )
      .run(journalId, equityAccountId);
    const source = new BetterSqliteDriver(sourceDb);

    const { db: targetDb, driver: target } = await buildTargetDriver();
    const summary = await importDatabase({ source, target });

    // Exactly one journal for this narration — the backfill's idempotency
    // guard saw it already existed (copied in with the rest of the source
    // data) and skipped, rather than adding a second one.
    const journalCount = await target.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM journal WHERE narration = 'Opening Balance from B/S'`,
    );
    expect(journalCount?.c).toBe(1);
    const entryCount = await target.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM journal_entry WHERE journalId = ?`,
      [journalId],
    );
    expect(entryCount?.c).toBe(2);

    // No new "Opening Balance Equity" account/chart was created either —
    // the source's own (already-backed) one was copied in and reused.
    const equityAccountCount = await target.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Opening Balance Equity'`,
    );
    expect(equityAccountCount?.c).toBe(1);

    // Fully reconciled: no mismatch warning.
    expect(summary.warnings.some((w) => /ledger_view derives/.test(w))).toBe(
      false,
    );

    targetDb.close();
    sourceDb.close();
  });

  it('backfills multiple pre-025 opening-balance rows across different accounts in one import (mixed)', async () => {
    const sourceDb = buildDesktopDatabase(23);
    seedDesktopBusinessData(sourceDb, { withUuid: false });
    // Two unbacked opening-balance rows for two different accounts, same
    // user — exercises the backfill's per-user equity-account cache
    // (`getEquityAccountId`) actually being reused across rows rather than
    // just exercised once.
    sourceDb
      .prepare(
        `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType)
         VALUES (3, '2024-01-01', 'Opening Balance from B/S', 1, 1000, 0, 1000, 'Dr')`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType)
         VALUES (4, '2024-01-02', 'Opening Balance from B/S', 2, 0, 500, 500, 'Cr')`,
      )
      .run();
    const source = new BetterSqliteDriver(sourceDb);

    const { db: targetDb, driver: target } = await buildTargetDriver();
    const summary = await importDatabase({ source, target });

    const journals = await target.all<{ id: number }>(
      `SELECT id FROM journal WHERE narration = 'Opening Balance from B/S'`,
    );
    expect(journals).toHaveLength(2);

    // Both journals' contra side landed on the SAME equity account (one
    // find-or-create per user, reused).
    const equityAccountCount = await target.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Opening Balance Equity'`,
    );
    expect(equityAccountCount?.c).toBe(1);

    expect(summary.warnings.some((w) => /ledger_view derives/.test(w))).toBe(
      false,
    );

    targetDb.close();
    sourceDb.close();
  });

  it('reports a zero-amount opening-balance row as a harmless info note, not an alarm', async () => {
    const sourceDb = buildDesktopDatabase(23);
    seedDesktopBusinessData(sourceDb, { withUuid: false });
    // A zero-balance "Opening Balance from B/S" row: the backfill still
    // synthesizes a journal for it (openingBalanceBackfill.ts does not
    // special-case a zero amount), but that journal's two entries both carry
    // debitAmount=0 AND creditAmount=0, so journal_entry_pairs' `d.debitAmount
    // > 0` / `c.creditAmount > 0` joins find no pair for it at all — the view
    // genuinely (and harmlessly) never reproduces this row.
    sourceDb
      .prepare(
        `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType)
         VALUES (3, '2024-01-01', 'Opening Balance from B/S', 1, 0, 0, 0, 'Dr')`,
      )
      .run();
    const source = new BetterSqliteDriver(sourceDb);

    const { db: targetDb, driver: target } = await buildTargetDriver();
    const summary = await importDatabase({ source, target });

    const mismatchWarning = summary.warnings.find((w) =>
      /ledger_view derives/.test(w),
    );
    expect(mismatchWarning).toBeDefined();
    expect(mismatchWarning).toMatch(/zero-amount/i);
    expect(mismatchWarning).not.toMatch(/contact support/i);

    targetDb.close();
    sourceDb.close();
  });

  it('reports a balance-neutral row split (same total, different row shape) as an info note, not an alarm', async () => {
    const sourceDb = buildDesktopDatabase(23);
    seedDesktopBusinessData(sourceDb, { withUuid: false });
    // A normal (non-opening-balance) journal: one 100.00 debit leg on Cash,
    // one 100.00 credit leg on Sales.
    sourceDb
      .prepare(
        `INSERT INTO journal (id, date, narration, isPosted) VALUES (2, '2024-04-01', 'Split test', 1)`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO journal_entry (id, journalId, debitAmount, creditAmount, accountId) VALUES (3, 2, 100, 0, 1)`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO journal_entry (id, journalId, debitAmount, creditAmount, accountId) VALUES (4, 2, 0, 100, 2)`,
      )
      .run();
    // The desktop app's own stored `ledger`, though, split the debit side
    // across two rows (60.00 + 40.00) instead of the single 100.00 row
    // ledger_view derives from the journal above — same total, different row
    // shape.
    sourceDb
      .prepare(
        `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType)
         VALUES (3, '2024-04-01', 'Journal #2', 1, 60, 0, 560, 'Dr')`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType)
         VALUES (4, '2024-04-01', 'Journal #2', 1, 40, 0, 600, 'Dr')`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType)
         VALUES (5, '2024-04-01', 'Journal #2', 2, 0, 100, 600, 'Cr')`,
      )
      .run();
    const source = new BetterSqliteDriver(sourceDb);

    const { db: targetDb, driver: target } = await buildTargetDriver();
    const summary = await importDatabase({ source, target });

    const mismatchWarning = summary.warnings.find((w) =>
      /ledger_view derives/.test(w),
    );
    expect(mismatchWarning).toBeDefined();
    expect(mismatchWarning).toMatch(/identical/i);
    expect(mismatchWarning).not.toMatch(/contact support/i);

    targetDb.close();
    sourceDb.close();
  });

  it('absorbs sub-cent float noise between a stored ledger row and its journal-derived counterpart (no warning at all)', async () => {
    const sourceDb = buildDesktopDatabase(23);
    seedDesktopBusinessData(sourceDb, { withUuid: false });
    sourceDb
      .prepare(
        `INSERT INTO journal (id, date, narration, isPosted) VALUES (2, '2024-05-01', 'Float noise test', 1)`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO journal_entry (id, journalId, debitAmount, creditAmount, accountId) VALUES (3, 2, 33109.40, 0, 1)`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO journal_entry (id, journalId, debitAmount, creditAmount, accountId) VALUES (4, 2, 0, 33109.40, 2)`,
      )
      .run();
    // The desktop app's own stored ledger row carries the same kind of
    // IEEE754 noise `ledger_lines`' `(debitAmount*creditAmount)/totalCredits`
    // division introduces on the view side — ~1e-9 off the "clean" 33109.40.
    // Row counts on both sides stay equal (one row per side, same as the
    // journal), so this only exercises the rounded-key comparison, not the
    // row-count residual math.
    sourceDb
      .prepare(
        `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType)
         VALUES (3, '2024-05-01', 'Journal #2', 1, 33109.399999999994, 0, 33609.4, 'Dr')`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO ledger (id, date, particulars, accountId, debit, credit, balance, balanceType)
         VALUES (4, '2024-05-01', 'Journal #2', 2, 0, 33109.40, 33609.4, 'Cr')`,
      )
      .run();
    const source = new BetterSqliteDriver(sourceDb);

    const { db: targetDb, driver: target } = await buildTargetDriver();
    const summary = await importDatabase({ source, target });

    expect(summary.warnings.some((w) => /ledger_view derives/.test(w))).toBe(
      false,
    );

    targetDb.close();
    sourceDb.close();
  });

  it('reconciles an item whose stored desktop quantity includes history no fact row captures', async () => {
    const sourceDb = buildDesktopDatabase(27);
    // The field-bug shape this whole change exists for: a legacy desktop
    // item whose stored `quantity` (100) was built up partly through writes
    // that only ever touched the stored counter (item creation, direct
    // edits from older app versions) — no `inventory_opening_stock` row at
    // all, and only a single Sale invoice of 10 the fact tables DO capture.
    // The view alone can only see -10; the other 110 units are the gap this
    // backfill exists to carry forward.
    sourceDb
      .prepare(
        `INSERT INTO inventory (id, name, price, quantity) VALUES (1, 'Widget', 50, 100)`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO chart (id, date, name, type) VALUES (1, '2024-01-01', 'Current Asset', 'Asset')`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO account (id, chartId, date, name) VALUES (1, 1, '2024-01-01', 'Cash')`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO invoices (id, invoiceNumber, accountId, invoiceType, date, totalAmount)
         VALUES (1, 1, 1, 'Sale', '2024-02-01', 500)`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO invoice_items (id, invoiceId, inventoryId, quantity, price) VALUES (1, 1, 1, 10, 50)`,
      )
      .run();
    const source = new BetterSqliteDriver(sourceDb);

    const { db: targetDb, driver: target } = await buildTargetDriver();
    const summary = await importDatabase({ source, target });

    // inventory_quantity_view now reports exactly the desktop-trusted stored
    // quantity, not the fact-only -10.
    const view = await target.get<{ quantity: number }>(
      `SELECT quantity FROM inventory_quantity_view WHERE inventoryId = 1`,
    );
    expect(view?.quantity).toBe(100);

    // Exactly one baseline stock_adjustments row, with the computed delta
    // (100 stored - (-10) fact-derived = 110), clearly identified.
    const adjustments = await target.all<{
      quantityDelta: number;
      reason: string | null;
      date: string;
    }>(
      `SELECT quantityDelta, reason, date FROM stock_adjustments WHERE inventoryId = 1`,
    );
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].quantityDelta).toBe(110);
    expect(adjustments[0].reason).toBe(INVENTORY_BASELINE_REASON);
    expect(adjustments[0].date).toBe(INVENTORY_BASELINE_DATE);

    // inventory.quantity itself is untouched by the backfill (still the
    // desktop-imported 100 — same value, but not written a second time).
    const stored = await target.get<{ quantity: number }>(
      `SELECT quantity FROM inventory WHERE id = 1`,
    );
    expect(stored?.quantity).toBe(100);

    expect(
      summary.warnings.some((w) => /1 inventory item\(s\) reconciled/.test(w)),
    ).toBe(true);

    targetDb.close();
    sourceDb.close();
  });

  it("adds no baseline adjustment when an item's facts already fully explain its stored quantity", async () => {
    const sourceDb = buildDesktopDatabase(27);
    // Consistent history: opening stock 10, one Sale of 3 -> 7, matching the
    // stored counter exactly. Nothing for the baseline backfill to do.
    sourceDb
      .prepare(
        `INSERT INTO inventory (id, name, price, quantity) VALUES (1, 'Gadget', 20, 7)`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO inventory_opening_stock (id, inventoryId, quantity, asOfDate) VALUES (1, 1, 10, '2024-01-01')`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO chart (id, date, name, type) VALUES (1, '2024-01-01', 'Current Asset', 'Asset')`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO account (id, chartId, date, name) VALUES (1, 1, '2024-01-01', 'Cash')`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO invoices (id, invoiceNumber, accountId, invoiceType, date, totalAmount)
         VALUES (1, 1, 1, 'Sale', '2024-02-01', 60)`,
      )
      .run();
    sourceDb
      .prepare(
        `INSERT INTO invoice_items (id, invoiceId, inventoryId, quantity, price) VALUES (1, 1, 1, 3, 20)`,
      )
      .run();
    const source = new BetterSqliteDriver(sourceDb);

    const { db: targetDb, driver: target } = await buildTargetDriver();
    const summary = await importDatabase({ source, target });

    const adjustments = await target.all(
      `SELECT * FROM stock_adjustments WHERE inventoryId = 1`,
    );
    expect(adjustments).toHaveLength(0);
    expect(
      summary.warnings.some((w) => /inventory item\(s\) reconciled/.test(w)),
    ).toBe(false);

    targetDb.close();
    sourceDb.close();
  });

  it("carries the source device's TRUE createdAt/updatedAt through import verbatim — the field bug migration 035 fixes, exercised end-to-end", async () => {
    const sourceDb = buildDesktopDatabase(27);
    // withUuid: true — this fixture represents the incident's actual shape:
    // a MODERN, already-migrated (024+) business file, where every row
    // (including the two planted below) genuinely carries a real uuid, same
    // as `copyTable` (src/core/db/import.ts) would copy from any real
    // source on 024+. This matters beyond realism: an invoice inserted with
    // a NULL uuid gets one backfilled by migration 029's own
    // `trg_sync_capture_invoices_insert` on the TARGET side during import,
    // and that backfill `UPDATE` cascades into `after_update_invoices_
    // add_timestamp` (untouched by 035) regardless of this fix — see 035's
    // own doc comment ("A second, independent source of the exact same
    // cascade") for why that's a narrower, separately-documented residual
    // case (a pre-024 source with no uuid column at all), not this test's.
    seedDesktopBusinessData(sourceDb, { withUuid: true });

    // Plant two more invoices with known, old timestamps, emulating years of
    // real desktop use before the file was ever uploaded here. Drop the
    // source db's own after_insert/after_update "_add_timestamp" triggers
    // first — on THIS (pre-035, legacy-shape) source database they are
    // exactly the unconditional triggers this migration's incident report is
    // about, and would otherwise immediately re-stamp these INSERTs/UPDATEs
    // to "now" the moment they land in the fixture, defeating the point of a
    // fixture with known old timestamps at all. Harmless: the source db is
    // only ever read from by importDatabase() below, then discarded.
    sourceDb.exec(`DROP TRIGGER after_insert_invoices_add_timestamp`);
    sourceDb.exec(`DROP TRIGGER after_update_invoices_add_timestamp`);

    // Invoice 2: created and never edited on desktop — createdAt ==
    // updatedAt, both old. Must stay pill-free after import.
    const UNEDITED_TS = '2015-05-30 10:00:00';
    sourceDb
      .prepare(
        `INSERT INTO invoices
           (id, invoiceNumber, accountId, invoiceType, date, totalAmount, createdAt, updatedAt, uuid)
         VALUES (2, 2, 1, 'Sale', '2015-05-30', 150, ?, ?, 'invoice-uuid-2')`,
      )
      .run(UNEDITED_TS, UNEDITED_TS);

    // Invoice 3: a genuine edit on desktop, years apart — updatedAt >
    // createdAt. Must keep looking edited after import; the "Edited" pill's
    // whole point is telling this row apart from invoice 2.
    const CREATED_TS = '2016-02-01 09:00:00';
    const EDITED_TS = '2018-11-20 16:45:00';
    sourceDb
      .prepare(
        `INSERT INTO invoices
           (id, invoiceNumber, accountId, invoiceType, date, totalAmount, createdAt, updatedAt, uuid)
         VALUES (3, 3, 1, 'Sale', '2016-02-01', 300, ?, ?, 'invoice-uuid-3')`,
      )
      .run(CREATED_TS, EDITED_TS);

    const source = new BetterSqliteDriver(sourceDb);
    const { db: targetDb, driver: target } = await buildTargetDriver();

    await importDatabase({ source, target });

    const unedited = await target.get<{
      createdAt: string;
      updatedAt: string;
    }>(`SELECT createdAt, updatedAt FROM invoices WHERE invoiceNumber = 2`);
    expect(unedited?.createdAt).toBe(UNEDITED_TS);
    expect(unedited?.updatedAt).toBe(UNEDITED_TS);
    expect(unedited!.updatedAt > unedited!.createdAt).toBe(false);

    const edited = await target.get<{
      createdAt: string;
      updatedAt: string;
    }>(`SELECT createdAt, updatedAt FROM invoices WHERE invoiceNumber = 3`);
    expect(edited?.createdAt).toBe(CREATED_TS);
    expect(edited?.updatedAt).toBe(EDITED_TS);
    expect(edited!.updatedAt > edited!.createdAt).toBe(true);

    targetDb.close();
    sourceDb.close();
  });

  it('every BUSINESS_TABLES entry exists in the target (frozen) schema', async () => {
    const { db: targetDb, driver: target } = await buildTargetDriver();
    for (const table of BUSINESS_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      const row = await target.get(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
        [table],
      );
      expect(row).toBeDefined();
    }
    targetDb.close();
  });
});
