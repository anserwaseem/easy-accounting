/**
 * Builds a real desktop-format SQLite database file in Node, for
 * e2e/import.spec.ts to upload through the actual Import UI.
 *
 * "Desktop-format" means built exactly the way the Electron app builds one:
 * src/sql/schema.sql followed by every historical migration
 * (src/main/migrations/001.js..027.js) via better-sqlite3 — the same
 * bootstrap sequence src/main/migrations/index.ts's MigrationRunner and
 * scripts/generate-schema-snapshot.ts both use (see the latter's
 * `buildProductionDatabase`, which this mirrors for a Node/Playwright
 * context rather than a Jest one). better-sqlite3 itself is loaded from
 * release/app/node_modules (the packaged Electron build's own copy — see
 * the repo's root jest.config.js, which resolves it the same way) since
 * apps/web has no dependency on it at all; a plain `require('better-sqlite3')`
 * from this file would fail to resolve.
 *
 * The seeded user's password hash is produced by importing
 * src/main/utils/encrypt.ts's real `hashPassword` directly — not a
 * reimplementation of its algorithm — so this fixture is byte-for-byte what
 * the desktop app would have actually written, and the web build's login
 * path is proven against the real thing, not a stand-in for it.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
// src/main/utils/encrypt.ts compiles to CommonJS (root tsconfig's
// `module: "commonjs"`); Playwright's own ESM-based TS loader for this file
// interops with that as a default export only (not the named
// `hashPassword` export TS's type-checker sees) — `require` it directly
// instead, the same way this file already reaches into
// release/app/node_modules below, so this fixture's password hash is
// produced by the REAL encrypt.ts code, not a reimplementation of it.
// eslint-disable-next-line import/no-relative-packages, @typescript-eslint/no-var-requires
const { hashPassword } =
  require('../../../../src/main/utils/encrypt') as typeof import('../../../../src/main/utils/encrypt');

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const BETTER_SQLITE3_PATH = path.join(
  REPO_ROOT,
  'release/app/node_modules/better-sqlite3',
);
const SCHEMA_SQL_PATH = path.join(REPO_ROOT, 'src/sql/schema.sql');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'src/main/migrations');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BetterSqliteDb = any;

export interface DesktopFixtureUser {
  username: string;
  password: string;
}

export interface DesktopFixtureIds {
  cashAccountId: number;
  salesAccountId: number;
  journalId: number;
  inventoryId: number;
  invoiceId: number;
  /** Stock after opening (10) minus the sale invoice's quantity (3). */
  expectedStock: number;
}

export interface DesktopFixtureOptions {
  /**
   * When true, the fixture stops applying `src/main/migrations/*.js` at
   * migration 023 — the last one before 025's opening-balance backfill —
   * instead of the full historical set, and seeds an extra "Opening Balance
   * from B/S" `ledger` row directly (old-fashioned, pre-025-write-path
   * style: a bare `INSERT INTO ledger`, no backing `journal`/`journal_entry`
   * rows at all) on the fixture's own Cash account. This is deliberately
   * NOT "build all 001-027 migrations, then seed the row" — running
   * migration 025 itself would immediately backfill the row this option
   * exists to leave unbacked, defeating the point. Stopping the migration
   * chain early instead produces a genuinely pre-025-shaped database, the
   * same technique `src/core/db/__tests__/import.test.ts`'s
   * `buildDesktopDatabase(23)` and `src/main/migrations/__tests__/
   * migrations.test.ts`'s 019 upgrade fixture both already rely on — see
   * the latter's doc comment on why a partial migration run (not a
   * schema.sql that already contains later columns) is what makes this
   * faithful: `schema.sql` only ever has the base, pre-migration-001 shape
   * (later columns/tables are added exclusively by the numbered migration
   * files themselves, guarded `IF NOT EXISTS`/`hasColumn`), so running only
   * 001-023 against it reproduces a real pre-024/025 desktop install
   * byte-for-byte, not an approximation of one.
   */
  preMigration025?: boolean;
}

/**
 * Builds the fixture database file on disk and returns both its bytes (for
 * uploading through the Import UI) and the ids/values the test asserts
 * against post-import.
 */
export function buildDesktopDatabaseFixture(
  user: DesktopFixtureUser,
  opts: DesktopFixtureOptions = {},
): {
  bytes: Buffer;
  ids: DesktopFixtureIds;
  accountName: string;
  journalNarration: string;
  inventoryName: string;
  /**
   * Set only when `opts.preMigration025` is true: the amount (and equity
   * contra account name) of the unbacked "Opening Balance from B/S" ledger
   * row seeded on the Cash account, for the caller to assert against once
   * it appears in the imported database's ledger UI.
   */
  openingBalance?: { amount: number; equityAccountName: string };
} {
  const { preMigration025 = false } = opts;
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const Database = require(BETTER_SQLITE3_PATH);
  const filePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'easy-accounting-import-fixture-')),
    'database.db',
  );
  const db: BetterSqliteDb = new Database(filePath);

  const schemaSql = fs.readFileSync(SCHEMA_SQL_PATH, 'utf-8');
  db.exec(schemaSql);

  db.prepare(
    `CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'localtime'))
    )`,
  ).run();

  const LAST_PRE_025_MIGRATION = 23;
  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+\.js$/.test(f))
    .sort();
  for (const fileName of migrationFiles) {
    if (
      preMigration025 &&
      Number(fileName.slice(0, fileName.indexOf('.'))) > LAST_PRE_025_MIGRATION
    ) {
      // eslint-disable-next-line no-continue
      continue;
    }
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const migration = require(path.join(MIGRATIONS_DIR, fileName));
    const result = migration.up(db);
    if (result !== true) {
      throw new Error(
        `fixture migration ${fileName} did not return true: ${String(result)}`,
      );
    }
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
  }

  const stamp = Date.now();
  const accountName = `Desktop Cash ${stamp}`;
  const salesAccountName = `Desktop Sales ${stamp}`;
  const journalNarration = `Imported desktop journal ${stamp}`;
  const inventoryName = `Desktop Widget ${stamp}`;

  // -- user (desktop-format hash, via the real encrypt.ts) ----------------
  const passwordHash = hashPassword(user.password);
  const userId = Number(
    db
      .prepare(
        `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
      )
      .run(user.username, passwordHash).lastInsertRowid,
  );

  // -- chart of accounts ----------------------------------------------------
  const cashChartId = Number(
    db
      .prepare(
        `INSERT INTO chart (date, name, userId, type) VALUES (?, ?, ?, 'Asset')`,
      )
      .run('2024-01-01', 'Current Asset', userId).lastInsertRowid,
  );
  const salesChartId = Number(
    db
      .prepare(
        `INSERT INTO chart (date, name, userId, type) VALUES (?, ?, ?, 'Revenue')`,
      )
      .run('2024-01-01', 'Revenue', userId).lastInsertRowid,
  );

  const cashAccountId = Number(
    db
      .prepare(
        `INSERT INTO account (chartId, date, name, isActive) VALUES (?, ?, ?, 1)`,
      )
      .run(cashChartId, '2024-01-01', accountName).lastInsertRowid,
  );
  const salesAccountId = Number(
    db
      .prepare(
        `INSERT INTO account (chartId, date, name, isActive) VALUES (?, ?, ?, 1)`,
      )
      .run(salesChartId, '2024-01-01', salesAccountName).lastInsertRowid,
  );

  // -- a posted journal (Cash debit / Sales credit) + its ledger rows ------
  const journalId = Number(
    db
      .prepare(
        `INSERT INTO journal (date, narration, isPosted) VALUES (?, ?, 1)`,
      )
      .run('2024-02-01', journalNarration).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO journal_entry (journalId, debitAmount, creditAmount, accountId) VALUES (?, 500, 0, ?)`,
  ).run(journalId, cashAccountId);
  db.prepare(
    `INSERT INTO journal_entry (journalId, debitAmount, creditAmount, accountId) VALUES (?, 0, 500, ?)`,
  ).run(journalId, salesAccountId);
  db.prepare(
    `INSERT INTO ledger (date, particulars, accountId, debit, credit, balance, balanceType, linkedAccountId)
     VALUES (?, ?, ?, 500, 0, 500, 'Dr', ?)`,
  ).run('2024-02-01', `Journal #${journalId}`, cashAccountId, salesAccountId);
  db.prepare(
    `INSERT INTO ledger (date, particulars, accountId, debit, credit, balance, balanceType, linkedAccountId)
     VALUES (?, ?, ?, 0, 500, 500, 'Cr', ?)`,
  ).run('2024-02-01', `Journal #${journalId}`, salesAccountId, cashAccountId);

  // -- inventory: opening stock 10, then a 3-unit sale invoice -> 7 left ---
  const inventoryId = Number(
    db
      .prepare(
        `INSERT INTO inventory (name, price, quantity) VALUES (?, 250, 0)`,
      )
      .run(inventoryName).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate) VALUES (?, 10, ?)`,
  ).run(inventoryId, '2024-01-01');

  const invoiceId = Number(
    db
      .prepare(
        `INSERT INTO invoices (invoiceNumber, accountId, invoiceType, date, totalAmount) VALUES (1, ?, 'Sale', ?, 750)`,
      )
      .run(cashAccountId, '2024-03-01').lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price) VALUES (?, ?, 3, 250)`,
  ).run(invoiceId, inventoryId);

  // -- pre-025 "Opening Balance from B/S" ledger row: old StatementService
  // .setupLedgers wrote this straight to `ledger` with no backing journal
  // at all (see src/main/migrations/025.js's doc comment) — this is
  // deliberately a bare `INSERT INTO ledger`, no journal/journal_entry
  // rows, and no `linkedAccountId` (StatementService's real write never set
  // one either — see StatementService.ts's `setupLedgers`). The real
  // production bug this fixture proves fixed: apps.core.db.import.ts's
  // importDatabase must synthesize the missing journal itself so this
  // entry shows up in the Ledger UI at all (ledger_view, not this bare
  // `ledger` row, is what the app actually reads post migration-028
  // cutover).
  const OPENING_BALANCE_AMOUNT = 1500;
  const OPENING_BALANCE_EQUITY_ACCOUNT_NAME = 'Opening Balance Equity';
  if (preMigration025) {
    db.prepare(
      `INSERT INTO ledger (date, particulars, accountId, debit, credit, balance, balanceType)
       VALUES (?, 'Opening Balance from B/S', ?, ?, 0, ?, 'Dr')`,
    ).run(
      '2024-01-01',
      cashAccountId,
      OPENING_BALANCE_AMOUNT,
      OPENING_BALANCE_AMOUNT,
    );
  }

  db.close();

  const bytes = fs.readFileSync(filePath);
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true });

  return {
    bytes,
    ids: {
      cashAccountId,
      salesAccountId,
      journalId,
      inventoryId,
      invoiceId,
      expectedStock: 7,
    },
    accountName,
    journalNarration,
    inventoryName,
    openingBalance: preMigration025
      ? {
          amount: OPENING_BALANCE_AMOUNT,
          equityAccountName: OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
        }
      : undefined,
  };
}
