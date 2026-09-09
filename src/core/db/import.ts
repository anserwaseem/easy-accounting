import type { DatabaseDriver } from './driver';
import {
  backfillOpeningBalanceJournals,
  OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
  OPENING_BALANCE_PARTICULARS,
  type OpeningBalanceBackfillResult,
} from './openingBalanceBackfill';
import {
  backfillInventoryBaseline,
  verifyInventoryReconciliation,
  type InventoryBaselineBackfillResult,
} from './inventoryBaselineBackfill';

/**
 * "Bring your database" import: replaces this app's business data with the
 * contents of an uploaded desktop-format SQLite file, table by table.
 *
 * Platform-free by design — everything here is written against
 * {@link DatabaseDriver} alone, never against a concrete SQLite binding.
 * That works because BOTH sides of an import are already `DatabaseDriver`s
 * on the web target: the destination is the worker's usual OPFS-backed
 * driver, and the uploaded file becomes a *second* `DatabaseDriver` by
 * opening its bytes as a second in-memory sqlite-wasm database and wrapping
 * it in the same `SqliteWasmDriver` the destination uses (see
 * apps/web/src/worker/db.worker.ts's `import:database` handler, and
 * apps/web/src/worker/deserializeDatabase.ts for the sqlite-wasm-specific
 * `sqlite3_deserialize` call that produces it — that one file is the only
 * platform-specific part of this feature). Nothing in this module knows or
 * cares which concrete driver either side is, which is also what makes it
 * cheaply testable against two plain better-sqlite3-backed drivers (see
 * `__tests__/import.test.ts`) with no browser/wasm involved at all.
 *
 * Semantics are REPLACE, not merge (v1 — see the design note this shipped
 * with): the destination is expected to be a fresh install, so importing
 * wipes its business tables first rather than attempting to reconcile rows
 * against existing data.
 */

/**
 * Every business-data table in the current (frozen) schema snapshot — see
 * src/core/db/schema.snapshot.sql — in an order where each table's foreign
 * keys either don't exist yet or already point at rows this list has
 * already touched (parents before children). Not load-bearing for
 * correctness today (nothing in this app's runtime ever turns `PRAGMA
 * foreign_keys` on — see src/main/migrations/001.js/008.js, the only two
 * places that ever touch it, and both restore it to OFF before returning),
 * but keeping the order sane costs nothing and stops that from becoming a
 * silent landmine if that ever changes.
 *
 * Deliberately excludes `migrations` (bookkeeping, not business data — the
 * destination's own migration history must stand, not the upload's) and
 * `web_kv` (web-only session/settings storage with no desktop counterpart
 * to import from at all).
 *
 * `settings` (migration 028; rebuilt into a normal replicated-table shape
 * by migration 033 — src/core/db/migrations/033_sync_settings.ts) joined
 * this list in migration 033: company profile, invoice print settings, and
 * the publish feature's non-secret business fields are business data like
 * everything else here, so "bring your database" import carries them too.
 * An uploaded database that predates migration 028 simply has no `settings`
 * table — `validateUploadedDatabase` below already tolerates any
 * `BUSINESS_TABLES` entry being absent from an older upload (its benign
 * "nothing to import for it" warning), so no special-casing was needed for
 * this addition. No secret is ever a settings-table row (see
 * src/core/services/settingsSecrets.ts's `SECRET_SETTING_KEYS` and
 * `SettingsService.set`'s guard), so importing this table carries no
 * secret-leak risk.
 */
export const BUSINESS_TABLES = [
  'users',
  'chart',
  'discount_profiles',
  'item_types',
  'price_lists',
  'attribute_definitions',
  'account',
  'inventory',
  'inventory_opening_stock',
  'inventory_prices',
  'stock_adjustments',
  'vendor_stock',
  'vendor_issues',
  'vendor_issue_items',
  'vendor_stock_movements',
  'profile_type_discounts',
  'invoices',
  'invoice_items',
  'journal',
  'journal_entry',
  'ledger',
  'settings',
] as const;

/**
 * The minimum a file must contain to even be considered "an Easy Accounting
 * database" worth validating further, per the design task. A file missing
 * any of these is rejected outright rather than silently importing an empty
 * subset of tables.
 */
export const MINIMUM_REQUIRED_TABLES = [
  'users',
  'chart',
  'account',
  'journal',
  'journal_entry',
  'inventory',
  'invoices',
] as const;

/**
 * The highest migration number this build's own schema is on — the frozen
 * snapshot (src/core/db/schema.snapshot.sql / bootstrap.ts, migrations
 * 001-030) plus every migration src/core/db/migrations/index.ts's
 * CORE_MIGRATIONS has added since (028+, which never renumbers 001-030).
 * An uploaded database whose own `migrations` table references a migration
 * numbered higher than this came from a newer build than this one — see
 * `validateUploadedDatabase` below. Bump this whenever CORE_MIGRATIONS
 * gains a new entry (as of migration 036 —
 * src/core/db/migrations/036_desktop_vendor_stock_and_urdu.ts).
 */
export const SNAPSHOT_MIGRATION_VERSION = 36;

export interface ImportTableSummary {
  name: string;
  rows: number;
}

export interface ImportRejection {
  ok: false;
  reason: string;
}

export interface ImportPreview {
  ok: true;
  /** Row counts as they exist in the uploaded file, per business table. */
  tables: ImportTableSummary[];
  warnings: string[];
  /** Highest migration number found in the upload's own `migrations` table (0 if it has none). */
  sourceMigrationVersion: number;
}

export type ImportValidation = ImportPreview | ImportRejection;

export interface ImportSummary {
  /** Row counts as actually copied into the destination, per business table. */
  tables: ImportTableSummary[];
  warnings: string[];
  sourceMigrationVersion: number;
}

/**
 * The full result shape of the `import:database` RPC (apps/web/src/worker/
 * db.worker.ts) as seen by callers on the other side of the worker
 * boundary: a rejection, a preview (`confirm: false` — same shape as
 * {@link ImportValidation}'s ok branch), or a confirmed import's summary
 * with `ok: true` layered on for a uniform `.ok` discriminant across all
 * three. Re-exported from src/renderer/preload.d.ts and
 * apps/web/src/api/client.ts rather than redefined in each, so the two
 * separate TS programs that type-check src/renderer/views/Import (root
 * Electron and apps/web) always agree on this shape.
 */
export type ImportOutcome =
  | ImportRejection
  | ImportPreview
  | ({ ok: true } & ImportSummary);

const SQLITE_MAGIC = 'SQLite format 3\u0000';

/**
 * Cheap sniff for "is this even a SQLite file" from raw bytes, before
 * spending a wasm `sqlite3_deserialize` call (or a native open) on it. Every
 * valid SQLite database file begins with this exact 16-byte magic string —
 * see https://www.sqlite.org/fileformat.html#the_database_header.
 */
export function looksLikeSqliteFile(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i += 1) {
    if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

async function tableExists(db: DatabaseDriver, name: string): Promise<boolean> {
  const row = await db.get(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [name],
  );
  return row !== undefined;
}

async function tableColumns(
  db: DatabaseDriver,
  name: string,
): Promise<string[]> {
  // `name` only ever comes from BUSINESS_TABLES/MINIMUM_REQUIRED_TABLES
  // (fixed, hardcoded constants above) — never from the uploaded file —
  // so interpolating it here carries no injection risk.
  const rows = await db.all<{ name: string }>(`PRAGMA table_info("${name}")`);
  return rows.map((r) => r.name);
}

async function countRows(db: DatabaseDriver, name: string): Promise<number> {
  const row = await db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM "${name}"`,
  );
  return row?.c ?? 0;
}

/** Parses the leading migration number off names like `'024_add_uuid_to_business_tables'`. */
function migrationNumber(name: string): number | null {
  const match = /^(\d+)_/.exec(name);
  return match ? Number(match[1]) : null;
}

/** Highest migration number recorded in `source`'s own `migrations` table, or 0 if it has none/is empty. */
export async function readSourceMigrationVersion(
  source: DatabaseDriver,
): Promise<number> {
  if (!(await tableExists(source, 'migrations'))) return 0;
  const rows = await source.all<{ name: string }>(
    `SELECT name FROM migrations`,
  );
  let max = 0;
  for (const row of rows) {
    const n = migrationNumber(row.name);
    if (n !== null && n > max) max = n;
  }
  return max;
}

/**
 * Validates an uploaded database before ever touching the destination:
 * checks it has the minimum tables to plausibly be an Easy Accounting
 * database, and that its own migration history isn't newer than this app's
 * schema knows how to read. Read-only — safe to call for a preview/
 * confirmation step with no destructive effect yet (see the RPC handler's
 * two-call `confirm: false` / `confirm: true` flow).
 */
export async function validateUploadedDatabase(
  source: DatabaseDriver,
): Promise<ImportValidation> {
  for (const table of MINIMUM_REQUIRED_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await tableExists(source, table))) {
      return {
        ok: false,
        reason: `Not a valid Easy Accounting database — missing table "${table}".`,
      };
    }
  }

  const sourceMigrationVersion = await readSourceMigrationVersion(source);
  if (sourceMigrationVersion > SNAPSHOT_MIGRATION_VERSION) {
    return {
      ok: false,
      reason:
        `This database was created by a newer version of Easy Accounting ` +
        `(migration ${sourceMigrationVersion}) than this app supports ` +
        `(up to ${SNAPSHOT_MIGRATION_VERSION}). Update the app, then try importing again.`,
    };
  }

  const warnings: string[] = [];
  const tables: ImportTableSummary[] = [];
  for (const table of BUSINESS_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    const present = await tableExists(source, table);
    if (!present) {
      warnings.push(
        `Source database has no "${table}" table — nothing to import for it ` +
          `(expected if it predates that feature).`,
      );
      tables.push({ name: table, rows: 0 });
      // eslint-disable-next-line no-continue
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    tables.push({ name: table, rows: await countRows(source, table) });
  }

  if (sourceMigrationVersion < SNAPSHOT_MIGRATION_VERSION) {
    warnings.push(
      `Source database is older (migration ${sourceMigrationVersion}) than this ` +
        `app's schema (migration ${SNAPSHOT_MIGRATION_VERSION}) — columns it doesn't ` +
        `have yet will be filled by this app's defaults/triggers (e.g. row uuids).`,
    );
  }

  return { ok: true, tables, warnings, sourceMigrationVersion };
}

/** Deletes every business table's rows (and resets their AUTOINCREMENT counters) on `target`. */
async function wipeBusinessData(target: DatabaseDriver): Promise<void> {
  // Children before parents (see BUSINESS_TABLES' doc comment) — reversed
  // for delete.
  for (const table of [...BUSINESS_TABLES].reverse()) {
    // eslint-disable-next-line no-await-in-loop
    await target.run(`DELETE FROM "${table}"`);
  }
  await target.run(
    `DELETE FROM sqlite_sequence WHERE name IN (${BUSINESS_TABLES.map(
      () => '?',
    ).join(', ')})`,
    [...BUSINESS_TABLES],
  );
}

/**
 * Copies one table's rows from `source` to `target`, restricted to the
 * *intersection* of both sides' columns (introspected via `PRAGMA
 * table_info`, per the design this shipped with) — so an older upload
 * missing a column the target schema has (e.g. `uuid`, added in migration
 * 024) simply omits it from the INSERT, leaving the target's own
 * column default / AFTER INSERT trigger to fill it in, while a column only
 * the upload has (there are none today, but the shape allows for it) is
 * silently dropped rather than failing the import.
 *
 * Integer `id`s are preserved verbatim from the source — they are already
 * internally consistent there (every foreign key in this schema points at
 * one), and the destination was just wiped, so there is nothing for them to
 * collide with.
 */
async function copyTable(
  source: DatabaseDriver,
  target: DatabaseDriver,
  table: string,
): Promise<number> {
  const sourceCols = await tableColumns(source, table);
  const targetCols = await tableColumns(target, table);
  const sourceColSet = new Set(sourceCols);
  // Column identifiers below only ever come from the TARGET's own
  // PRAGMA table_info — i.e. this app's fixed, hardcoded schema — filtered
  // by membership in the source's column set. Nothing from the uploaded
  // file's column *names* is ever interpolated into SQL directly, so a
  // maliciously-named column in the upload cannot inject anything: at worst
  // it just fails to match one of our own column names and is ignored.
  const columns = targetCols.filter((c) => sourceColSet.has(c));
  if (columns.length === 0) return 0;

  const quoted = columns.map((c) => `"${c}"`).join(', ');
  const rows = await source.all<Record<string, unknown>>(
    `SELECT ${quoted} FROM "${table}"`,
  );
  if (rows.length === 0) return 0;

  const placeholders = columns.map((c) => `@${c}`).join(', ');
  const insertSql = `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders})`;
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await target.run(insertSql, row);
  }
  return rows.length;
}

/**
 * Rebuild-from-facts integrity checks, run once the copy (and the opening-
 * balance backfill below) have landed: cheap equivalence assertions that
 * read back what was just written rather than trusting the copy loop's own
 * row counts. Returns warnings (never throws) — an import that copied real,
 * if inconsistent, data from the uploaded file is still more useful
 * surfaced-with-a-warning than discarded, and the caller already has the
 * raw counts to judge severity from.
 *
 * `backfill` is the result of the {@link backfillOpeningBalanceJournals}
 * call `importDatabase` makes right after the table copy — passed through
 * so the ledger_view/ledger row-count warning below can say plainly whether
 * the backfill ran and what it did, instead of a blanket "known, harmless"
 * that stopped being true the moment a real user hit it with a genuinely
 * unreconciled gap (see this module's `importDatabase` doc comment).
 *
 * ## The expected, structural surplus: the Opening Balance Equity contra row
 *
 * Even a *perfectly* reconciled import does not make `ledger_view`'s row
 * count equal the imported `ledger` table's row count — the two are
 * expected to differ by exactly the number of `'Opening Balance from B/S'`
 * journals present (whether written natively by `StatementService` on
 * migration 025+ or just synthesized by the backfill above). Every such
 * journal has two `journal_entry` rows (the account's own side and the
 * "Opening Balance Equity" contra side), so `ledger_view` — a pure
 * projection of `journal`/`journal_entry` — materializes two rows per
 * journal; `StatementService.setupLedgers` (see its doc comment) writes only
 * ONE stored `ledger` row per opening-balance entry, deliberately never one
 * for the equity contra side. `derivedStateEquivalence.test.ts`'s "opening
 * balance is the first activity on the account" test documents this exact
 * asymmetry by excluding the Opening Balance Equity account from its
 * row-for-row comparison. This is computed and subtracted out below before
 * anything is called a mismatch — it is not itself a warning-worthy gap.
 *
 * ## Residual gap classes (why counts can still differ after that)
 *
 * The backfill closes the *documented, expected* gap (pre-025 "Opening
 * Balance from B/S" rows with no backing journal); the structural surplus
 * above accounts for the Equity contra row every such journal produces.
 * Neither is a guarantee that what remains reconciles to zero — real,
 * historical data can still diverge for reasons unrelated to either:
 *
 * 1. **Ledger rows whose backing journal was deleted through a path that
 *    never removed them.** `JournalService.removeLedgerEffectOfJournals`
 *    (the only code path that strips a `ledger` row when its journal goes
 *    away) matches on `particulars` against `/^Journal #(\d+)$/` — a row
 *    whose particulars doesn't match that exact shape (any row that isn't a
 *    plain `Journal #<id>`, most notably `'Opening Balance from B/S'`
 *    itself) is explicitly kept (`if (!m) return true`), never stripped by
 *    that path. If a journal was ever deleted a different way — direct SQL,
 *    an admin script, an older code path that predates this pairing (every
 *    caller today pairs `removeLedgerEffectOfJournals` with
 *    `deleteJournalsByIds` — see `InvoiceService.ts`/`Invoice.service.ts` —
 *    but a stray historical write need not have) — the stored `ledger` row
 *    survives with no journal behind it at all: `ledger_view` (a pure
 *    projection of `journal`/`journal_entry`) has no row for it, so
 *    `storedRows` ends up higher than the structural-surplus-adjusted
 *    expectation.
 * 2. **Opening-balance rows the backfill itself cannot reach.**
 *    {@link backfillOpeningBalanceJournals} joins each `'Opening Balance
 *    from B/S'` ledger row through `account`/`chart` to resolve the
 *    per-user Equity account — same as `025.js` did. A row whose
 *    `accountId` is NULL or points at an account that no longer exists
 *    (schema allows `ledger.accountId` to be nullable/dangling) is skipped
 *    by that INNER JOIN and stays unbacked even after the backfill runs —
 *    and, having no journal, does not count toward the structural surplus
 *    either, so it shows up as extra `storedRows` with nothing to explain it.
 * 3. **The mirror-image gap: `journal`/`journal_entry` rows with no stored
 *    `ledger` row at all**, e.g. a manual/administrative journal insert that
 *    bypassed `JournalService.insertJournal` (the only path that writes
 *    both). `ledger_view` would then have a row `ledger` never did — extra
 *    `viewRows` beyond the structural surplus, the opposite direction from
 *    classes 1-2.
 *
 * None of these are "harmless" — an unexplained row in either direction
 * means real data (an account balance, a historical entry) is either
 * invisible in this app's ledgers/trial balance (class 1, class 2) or
 * exists only in a view with no durable record to audit against (class 3).
 * The warning below reports the leftover, structural-surplus-adjusted
 * difference plainly instead of dismissing it.
 */
const UNEXPLAINED_ROW_LIST_LIMIT = 20;

/** One stored `ledger` row `ledger_view` never reproduces — see {@link findUnexplainedLedgerRows}. */
interface UnexplainedStoredRow {
  id: number;
  accountName: string | null;
  date: string;
  debit: number;
  credit: number;
  particulars: string;
}

/** One `ledger_view` row with no stored `ledger` counterpart — see {@link findUnexplainedLedgerRows}. */
interface UnexplainedViewRow {
  journalId: number;
  entryId: number;
  accountName: string | null;
  date: string;
  debit: number;
  credit: number;
  particulars: string;
}

/**
 * The matching key `checkImportIntegrity`'s row-count reconciliation is
 * really comparing, spelled out per-row: `ledger_view` (schemaSnapshot.ts) is
 * built from `ledger_lines`, which projects each `journal_entry_pairs` row
 * into an (accountId, date, debit, credit, particulars) tuple per side —
 * exactly the same five columns `derivedStateEquivalence.test.ts`'s
 * `getStoredLedgerRows`/`getComputedLedgerRows` compare a stored `ledger` row
 * against its computed counterpart on (that suite additionally compares
 * `linkedAccountId`/`balance`/`balanceType`, but those are display fields
 * derived FROM a row already matched on identity, not part of the identity
 * itself). So two rows — one stored, one view-derived — are "the same fact"
 * exactly when those five columns agree; this reuses that same key.
 *
 * Two directions of mismatch are possible under that key, both surfaced
 * separately below:
 *  - stored rows whose key `ledger_view` has fewer (or zero) of — residual
 *    gap classes 1-2 in `checkImportIntegrity`'s doc comment (a `ledger` row
 *    that outlived its journal, or an opening-balance row the backfill
 *    couldn't reach);
 *  - `ledger_view` rows whose key `ledger` has fewer (or zero) of — gap class
 *    3 (a journal with no stored `ledger` row backing it at all).
 *
 * Comparison is done as a GROUP BY/COUNT diff per key (multiset semantics),
 * not a DISTINCT set diff, so N identical duplicate rows on one side against
 * M < N on the other correctly reports N - M unexplained rows instead of
 * silently treating "at least one exists on both sides" as full agreement.
 *
 * The one *expected* structural asymmetry — the Opening Balance Equity
 * contra-side row every opening-balance journal's `ledger_view` projection
 * carries with no stored counterpart (this function's caller's own doc
 * comment covers why) — is excluded up front from the `ledger_view` side
 * before diffing, the same "every opening-balance journal contributes one
 * contra row on the Equity account" fact `checkImportIntegrity`'s
 * `expectedSurplus` count is built on, just checked per-row here instead of
 * as a single aggregate count.
 */

/**
 * `ledger_view` restricted to rows worth trying to match against a stored
 * `ledger` row at all — i.e. with the expected Opening Balance Equity contra
 * rows filtered out already, so they never show up as a spurious
 * "view-only" mismatch. Shared by every row- and balance-level comparison
 * below ({@link findUnexplainedLedgerRows}, {@link findAccountBalanceDiffs})
 * so both diff the exact same reproduction of `ledger_view`.
 */
function reproducedViewQuery(): { sql: string; params: string[] } {
  const sql = `
    SELECT accountId, date, debit, credit, particulars, journalId, ownEntryId
    FROM ledger_view
    WHERE NOT (
      particulars = ?
      AND accountId IN (
        SELECT a.id FROM account a
        JOIN chart c ON c.id = a.chartId
        WHERE a.name = ? AND c.type = 'Equity'
      )
    )
  `;
  const params = [
    OPENING_BALANCE_PARTICULARS,
    OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
  ];
  return { sql, params };
}

async function findUnexplainedLedgerRows(target: DatabaseDriver): Promise<{
  storedOnly: UnexplainedStoredRow[];
  storedOnlyTotal: number;
  /**
   * Of `storedOnlyTotal`, the rows whose ROUND(debit,2) AND ROUND(credit,2)
   * are both 0.00 — the "Opening Balance from B/S" rows a zero balance
   * genuinely gives no journal to reproduce (see `checkImportIntegrity`'s
   * doc comment); every other stored-only row is counted in
   * `storedOnlyNonZeroTotal` instead.
   */
  storedOnlyZeroTotal: number;
  storedOnlyNonZeroTotal: number;
  viewOnly: UnexplainedViewRow[];
  viewOnlyTotal: number;
}> {
  const { sql: reproducedView, params: contraParams } = reproducedViewQuery();

  // The multiset key is rounded to money precision (2dp) rather than
  // compared on the raw REAL bits: `ledger_view` derives its amounts as
  // `(debitAmount * creditAmount) / totalCredits` (schema.snapshot.sql's
  // `ledger_lines` view), which for most legs of a multi-line journal is
  // off from the "clean" money value by ~1e-9 of IEEE754 noise — and a
  // stored `ledger` row copied verbatim from the desktop app can carry the
  // exact same kind of noise from its own prior float math. Two rows that
  // agree to the cent are the same accounting fact; comparing exact REAL
  // equality treated that noise as a genuine mismatch. Display columns
  // below stay unrounded — the raw values are already rendered to 2dp via
  // `formatMoney`/`toFixed(2)`, so rounding them again here would only
  // throw away information a human reading the detail listing might want.
  const countsCte = `
    WITH stored_counts AS (
      SELECT accountId, date,
             ROUND(COALESCE(debit, 0), 2) AS debitKey,
             ROUND(COALESCE(credit, 0), 2) AS creditKey,
             particulars, COUNT(*) AS cnt
      FROM ledger
      GROUP BY accountId, date, debitKey, creditKey, particulars
    ),
    view_rows AS (${reproducedView}),
    view_counts AS (
      SELECT accountId, date,
             ROUND(COALESCE(debit, 0), 2) AS debitKey,
             ROUND(COALESCE(credit, 0), 2) AS creditKey,
             particulars, COUNT(*) AS cnt
      FROM view_rows
      GROUP BY accountId, date, debitKey, creditKey, particulars
    )
  `;
  // NULL-safe key equality throughout below (`IS` instead of `=`) — schema
  // allows both `ledger.accountId` and (transitively) `ledger_view.accountId`
  // to be NULL/dangling (see this module's and openingBalanceBackfill.ts's
  // doc comments on residual gap class 2).
  const keyJoin = (a: string, b: string) =>
    `${a}.accountId IS ${b}.accountId AND ${a}.date = ${b}.date AND ` +
    `${a}.debitKey = ${b}.debitKey AND ${a}.creditKey = ${b}.creditKey AND ` +
    `${a}.particulars = ${b}.particulars`;

  const storedOnlyTotalsRow = await target.get<{
    zeroTotal: number | null;
    nonZeroTotal: number | null;
  }>(
    `${countsCte}
     SELECT
       COALESCE(SUM(CASE WHEN s.debitKey = 0 AND s.creditKey = 0
                          THEN s.cnt - COALESCE(v.cnt, 0) ELSE 0 END), 0) AS zeroTotal,
       COALESCE(SUM(CASE WHEN NOT (s.debitKey = 0 AND s.creditKey = 0)
                          THEN s.cnt - COALESCE(v.cnt, 0) ELSE 0 END), 0) AS nonZeroTotal
     FROM stored_counts s
     LEFT JOIN view_counts v ON ${keyJoin('v', 's')}
     WHERE s.cnt > COALESCE(v.cnt, 0)`,
    contraParams,
  );
  const storedOnlyZeroTotal = storedOnlyTotalsRow?.zeroTotal ?? 0;
  const storedOnlyNonZeroTotal = storedOnlyTotalsRow?.nonZeroTotal ?? 0;
  const viewOnlyTotalRow = await target.get<{ total: number | null }>(
    `${countsCte}
     SELECT COALESCE(SUM(v.cnt - COALESCE(s.cnt, 0)), 0) AS total
     FROM view_counts v
     LEFT JOIN stored_counts s ON ${keyJoin('s', 'v')}
     WHERE v.cnt > COALESCE(s.cnt, 0)`,
    contraParams,
  );

  const storedOnly = await target.all<UnexplainedStoredRow>(
    `${countsCte},
     mismatched AS (
       SELECT s.accountId, s.date, s.debitKey, s.creditKey, s.particulars,
              s.cnt - COALESCE(v.cnt, 0) AS excessCount
       FROM stored_counts s
       LEFT JOIN view_counts v ON ${keyJoin('v', 's')}
       WHERE s.cnt > COALESCE(v.cnt, 0)
     ),
     ranked AS (
       SELECT l.id, l.accountId, l.date, l.debit, l.credit, l.particulars,
              ROUND(COALESCE(l.debit, 0), 2) AS debitKey,
              ROUND(COALESCE(l.credit, 0), 2) AS creditKey,
              ROW_NUMBER() OVER (
                PARTITION BY l.accountId, l.date,
                             ROUND(COALESCE(l.debit, 0), 2),
                             ROUND(COALESCE(l.credit, 0), 2), l.particulars
                ORDER BY l.id
              ) AS rn
       FROM ledger l
     )
     SELECT r.id, a.name AS accountName, r.date, r.debit, r.credit, r.particulars
     FROM ranked r
     JOIN mismatched m ON ${keyJoin('m', 'r')}
     LEFT JOIN account a ON a.id = r.accountId
     WHERE r.rn <= m.excessCount
     ORDER BY r.id
     LIMIT ${UNEXPLAINED_ROW_LIST_LIMIT}`,
    contraParams,
  );

  const viewOnly = await target.all<UnexplainedViewRow>(
    `${countsCte},
     mismatched AS (
       SELECT v.accountId, v.date, v.debitKey, v.creditKey, v.particulars,
              v.cnt - COALESCE(s.cnt, 0) AS excessCount
       FROM view_counts v
       LEFT JOIN stored_counts s ON ${keyJoin('s', 'v')}
       WHERE v.cnt > COALESCE(s.cnt, 0)
     ),
     ranked AS (
       SELECT vr.journalId, vr.ownEntryId, vr.accountId, vr.date, vr.debit,
              vr.credit, vr.particulars,
              ROUND(COALESCE(vr.debit, 0), 2) AS debitKey,
              ROUND(COALESCE(vr.credit, 0), 2) AS creditKey,
              ROW_NUMBER() OVER (
                PARTITION BY vr.accountId, vr.date,
                             ROUND(COALESCE(vr.debit, 0), 2),
                             ROUND(COALESCE(vr.credit, 0), 2), vr.particulars
                ORDER BY vr.ownEntryId
              ) AS rn
       FROM view_rows vr
     )
     SELECT r.journalId, r.ownEntryId AS entryId, a.name AS accountName,
            r.date, r.debit, r.credit, r.particulars
     FROM ranked r
     JOIN mismatched m ON ${keyJoin('m', 'r')}
     LEFT JOIN account a ON a.id = r.accountId
     WHERE r.rn <= m.excessCount
     ORDER BY r.ownEntryId
     LIMIT ${UNEXPLAINED_ROW_LIST_LIMIT}`,
    contraParams,
  );

  return {
    storedOnly,
    storedOnlyTotal: storedOnlyZeroTotal + storedOnlyNonZeroTotal,
    storedOnlyZeroTotal,
    storedOnlyNonZeroTotal,
    viewOnly,
    viewOnlyTotal: viewOnlyTotalRow?.total ?? 0,
  };
}

/** One account whose net (debit - credit) balance disagrees between `ledger` and `ledger_view` — see {@link findAccountBalanceDiffs}. */
interface AccountBalanceDiff {
  accountId: number | null;
  accountName: string | null;
  storedBalance: number;
  viewBalance: number;
}

/**
 * Per-account net `SUM(debit) - SUM(credit)` balance, `ledger` vs the same
 * contra-filtered `ledger_view` reproduction {@link findUnexplainedLedgerRows}
 * diffs against — rounded to money precision on both sides, then compared
 * with a cent of float slop. This is what actually separates a row-level
 * mismatch that matters from one that doesn't: two ledgers can disagree
 * about how many rows exist, or how one amount is split across them, while
 * still landing on the exact same balance for every account (see this
 * module's investigation notes on the `(debitAmount*creditAmount)/totalCredits`
 * float noise and the zero-balance opening-row gap) — that combination is
 * provably harmless, just a row-shape difference. A balance difference on
 * even one account is the opposite: real data ledger and ledger_view
 * disagree about, not just where it happens to be recorded.
 */
async function findAccountBalanceDiffs(
  target: DatabaseDriver,
): Promise<AccountBalanceDiff[]> {
  const { sql: reproducedView, params: contraParams } = reproducedViewQuery();

  return target.all<AccountBalanceDiff>(
    `WITH view_rows AS (${reproducedView}),
     stored_bal AS (
       SELECT accountId,
              ROUND(SUM(COALESCE(debit, 0)) - SUM(COALESCE(credit, 0)), 2) AS bal
       FROM ledger
       GROUP BY accountId
     ),
     view_bal AS (
       SELECT accountId,
              ROUND(SUM(COALESCE(debit, 0)) - SUM(COALESCE(credit, 0)), 2) AS bal
       FROM view_rows
       GROUP BY accountId
     ),
     accounts AS (
       SELECT accountId FROM stored_bal
       UNION
       SELECT accountId FROM view_bal
     )
     SELECT ac.accountId AS accountId, a.name AS accountName,
            COALESCE(sb.bal, 0) AS storedBalance,
            COALESCE(vb.bal, 0) AS viewBalance
     FROM accounts ac
     LEFT JOIN stored_bal sb ON sb.accountId IS ac.accountId
     LEFT JOIN view_bal vb ON vb.accountId IS ac.accountId
     LEFT JOIN account a ON a.id = ac.accountId
     WHERE ABS(COALESCE(sb.bal, 0) - COALESCE(vb.bal, 0)) > 0.01
     ORDER BY ac.accountId`,
    contraParams,
  );
}

function formatMoney(n: number): string {
  return n.toFixed(2);
}

/** Renders one `findUnexplainedLedgerRows` result into the warning's detail listing, or '' if there is nothing to name. */
function formatUnexplainedLedgerRows(result: {
  storedOnly: UnexplainedStoredRow[];
  storedOnlyTotal: number;
  viewOnly: UnexplainedViewRow[];
  viewOnlyTotal: number;
}): string {
  const blocks: string[] = [];

  if (result.storedOnlyTotal > 0) {
    const items = result.storedOnly.map(
      (r) =>
        `${r.accountName ?? '(no account)'}, ${r.date}, debit ${formatMoney(
          r.debit,
        )}, credit ${formatMoney(r.credit)}, "${
          r.particulars
        }" (ledger row id ${r.id})`,
    );
    const more = result.storedOnlyTotal - items.length;
    const suffix = more > 0 ? ` …and ${more} more` : '';
    blocks.push(
      ` Stored ledger row(s) with no matching journal-derived entry: ${items.join(
        '; ',
      )}.${suffix}`,
    );
  }

  if (result.viewOnlyTotal > 0) {
    const items = result.viewOnly.map(
      (r) =>
        `${r.accountName ?? '(no account)'}, ${r.date}, debit ${formatMoney(
          r.debit,
        )}, credit ${formatMoney(r.credit)}, "${r.particulars}" (journal id ${
          r.journalId
        }, journal_entry id ${r.entryId})`,
    );
    const more = result.viewOnlyTotal - items.length;
    const suffix = more > 0 ? ` …and ${more} more` : '';
    blocks.push(
      ` Journal-derived entry(ies) with no matching stored ledger row: ${items.join(
        '; ',
      )}.${suffix}`,
    );
  }

  return blocks.join('');
}

async function checkImportIntegrity(
  target: DatabaseDriver,
  backfill: OpeningBalanceBackfillResult,
): Promise<string[]> {
  const warnings: string[] = [];

  // Trial balance: `ledger_view` (migration 027) is a pure reconstruction
  // from `journal`/`journal_entry` alone — it never reads the stored
  // `ledger` table. Every journal this schema allows balances by
  // construction (JournalService.insertJournal rejects an unbalanced one),
  // so Σdebit and Σcredit across the whole view must match; a mismatch here
  // means the imported journal/journal_entry data itself is inconsistent,
  // not that anything about the import loop lost rows.
  const totals = await target.get<{
    totalDebit: number | null;
    totalCredit: number | null;
  }>(
    `SELECT SUM(debit) AS totalDebit, SUM(credit) AS totalCredit FROM ledger_view`,
  );
  const totalDebit = totals?.totalDebit ?? 0;
  const totalCredit = totals?.totalCredit ?? 0;
  // Real currency amounts stored as SQLite REAL — allow a cent of float slop.
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    warnings.push(
      `Trial balance check failed after import: total debits (${totalDebit.toFixed(
        2,
      )}) ` +
        `!= total credits (${totalCredit.toFixed(
          2,
        )}). The imported journal data may be inconsistent.`,
    );
  }

  // ledger_view row count vs the imported `ledger` table's own row count.
  // These are two independently-arrived-at row sets — one derived fresh
  // from journal/journal_entry, one copied verbatim from the upload's own
  // `ledger` table — so agreement (once the structural surplus below is
  // accounted for) is real corroborating evidence the import landed both
  // consistently. `importDatabase` already ran the opening-balance backfill
  // (the migration-025 gap) before this check, so a mismatch here is no
  // longer expected/harmless once that surplus is subtracted out — see the
  // doc comment above this function for the residual gap classes that can
  // still produce one.
  const viewCount = await target.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM ledger_view`,
  );
  const ledgerCount = await target.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM ledger`,
  );
  const viewRows = viewCount?.c ?? 0;
  const storedRows = ledgerCount?.c ?? 0;

  // Structural, expected surplus — see this function's doc comment: an
  // 'Opening Balance from B/S' journal (native or backfilled) contributes
  // one ledger_view row (the Opening Balance Equity contra side) with no
  // stored `ledger` counterpart at all. Counted from the VIEW's actual
  // contra rows, not from the journal table: a zero-amount opening journal
  // produces no view rows at all (journal_entry_pairs requires both sides
  // > 0), so counting journals would overstate the expected surplus by one
  // per zero-amount opening row and misreport the residual (seen on a real
  // import: 217 journals but only 212 contra rows, inflating "unexplained"
  // from 5 to 10).
  const contraRowCount = await target.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM ledger_view
     WHERE particulars = ?
       AND accountId IN (
         SELECT a.id FROM account a
         JOIN chart c ON c.id = a.chartId
         WHERE a.name = ? AND c.type = 'Equity'
       )`,
    [OPENING_BALANCE_PARTICULARS, OPENING_BALANCE_EQUITY_ACCOUNT_NAME],
  );
  const expectedSurplus = contraRowCount?.c ?? 0;
  const residual = viewRows - storedRows - expectedSurplus;

  if (residual !== 0) {
    let backfillNote: string;
    if (backfill.alreadyBackfilled) {
      backfillNote = `This upload's opening-balance rows were already migration-025+ backed, so no backfill was needed.`;
    } else if (backfill.rowsBackfilled > 0) {
      backfillNote = `The opening-balance backfill ran during this import and added ${backfill.rowsBackfilled} journal(s) for pre-migration-025 "Opening Balance from B/S" ledger row(s).`;
    } else {
      backfillNote = `The opening-balance backfill ran during this import but found no pre-migration-025 "Opening Balance from B/S" rows to backfill.`;
    }

    const unexplained = await findUnexplainedLedgerRows(target);
    const detail = formatUnexplainedLedgerRows(unexplained);
    // The check that actually tells apart a real problem from a row-shape
    // artifact — see findAccountBalanceDiffs's doc comment. Non-empty here
    // is the ONLY thing that escalates this to the alarm tier below;
    // row-count/row-key mismatches alone (the `residual !== 0` that got us
    // into this branch at all) are not, once every account's balance is
    // confirmed identical.
    const balanceDiffs = await findAccountBalanceDiffs(target);

    const headline =
      `ledger_view derives ${viewRows} row(s) from the imported journal data, while the ` +
      `imported ledger table has ${storedRows} row(s). ${expectedSurplus} of that gap is the ` +
      `expected "Opening Balance Equity" contra-side row every opening-balance journal produces ` +
      `(see StatementService.setupLedgers) — but ${Math.abs(
        residual,
      )} row(s) beyond that remain ` +
      `unexplained. ${backfillNote}`;

    if (balanceDiffs.length > 0) {
      const diffItems = balanceDiffs
        .slice(0, 10)
        .map(
          (d) =>
            `${d.accountName ?? '(no account)'} (ledger ${formatMoney(
              d.storedBalance,
            )} vs ledger_view ${formatMoney(d.viewBalance)})`,
        );
      const diffMore = balanceDiffs.length - diffItems.length;
      const diffSuffix = diffMore > 0 ? ` …and ${diffMore} more` : '';
      warnings.push(
        `${headline} This is NOT a harmless discrepancy: ${Math.abs(
          residual,
        )} ` +
          `entry(ies) will not appear in this app's ledgers, account balances, or trial balance (every ` +
          `screen reads from the journal-derived data, never the raw ledger table), and ${
            balanceDiffs.length
          } account balance(s) actually differ between the imported ledger and ledger_view: ${diffItems.join(
            '; ',
          )}.${diffSuffix} Export a copy of ` +
          `this database now and contact support so the affected row(s) can be investigated and recovered.${detail}`,
      );
    } else {
      // Every account balance matches — the remaining row-level mismatches
      // are a row-shape artifact, not a data-loss risk. Report it plainly,
      // but without the alarm-tier language: nothing needs recovering.
      const infoParts: string[] = [];
      if (
        unexplained.storedOnlyNonZeroTotal > 0 ||
        unexplained.viewOnlyTotal > 0
      ) {
        infoParts.push(
          `${unexplained.storedOnlyNonZeroTotal} stored ledger row(s) and ${unexplained.viewOnlyTotal} ` +
            `journal-derived row(s) differ only in how the same amount is split across rows (row ` +
            `granularity, not amount) — every account balance is identical between the imported ledger ` +
            `and ledger_view.`,
        );
      }
      if (unexplained.storedOnlyZeroTotal > 0) {
        infoParts.push(
          `${unexplained.storedOnlyZeroTotal} zero-amount ledger row(s) (an "Opening Balance from B/S" ` +
            `row with debit and credit both 0.00) have no journal-derived counterpart, because a zero ` +
            `opening balance produces no journal entry — this has zero effect on any account balance.`,
        );
      }
      warnings.push(`${headline} ${infoParts.join(' ')}${detail}`);
    }
  }

  return warnings;
}

/**
 * Performs the actual replace-import: wipes `target`'s business tables,
 * copies every business table present in both schemas from `source`, and
 * (whenever needed) backfills the migration-025 opening-balance journals —
 * all inside one transaction (rolled back whole if anything throws), then
 * runs the integrity checks above. Callers are expected to have already
 * called `validateUploadedDatabase` and gotten an explicit user confirmation
 * — this function does not ask, it just does the (irreversible, on the
 * target) work.
 */
export async function importDatabase(params: {
  source: DatabaseDriver;
  target: DatabaseDriver;
}): Promise<ImportSummary> {
  const { source, target } = params;
  const validation = await validateUploadedDatabase(source);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const tables: ImportTableSummary[] = [];
  let backfill: OpeningBalanceBackfillResult = {
    alreadyBackfilled: false,
    rowsBackfilled: 0,
  };
  let inventoryBaseline: InventoryBaselineBackfillResult = {
    reconciled: 0,
    totalDelta: 0,
  };

  await target.transaction(async () => {
    await wipeBusinessData(target);
    for (const table of BUSINESS_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      const present = await tableExists(source, table);
      // eslint-disable-next-line no-await-in-loop
      const rows = present ? await copyTable(source, target, table) : 0;
      tables.push({ name: table, rows });
    }

    // Always invoked, regardless of `validation.sourceMigrationVersion` —
    // NOT gated on `< 25` — deliberately: the backfill's own idempotency
    // guard (a 'Opening Balance from B/S' journal already existing) already
    // makes every call after the first a no-op, so a version-based gate
    // would only add a second way to get this wrong (an unreliable/zero
    // `sourceMigrationVersion` from a `migrations` table that's missing,
    // empty, or was hand-edited) for no behavioral gain. sources already on
    // 025+ (`sourceMigrationVersion` in [25, 29)) carry their own backfilled
    // journals from when they first ran the real migration, so the guard
    // trips immediately and this is a cheap no-op `SELECT` for them; a
    // pre-025 source is exactly the case this whole change exists for (see
    // this module's and openingBalanceBackfill.ts's doc comments). Runs
    // inside this same transaction — nested via a SAVEPOINT, see
    // `backfillOpeningBalanceJournals`'s doc comment — so a failure here
    // rolls back the copy above too; the import is never left half-applied.
    backfill = await backfillOpeningBalanceJournals(target);

    // Same class of gap, same fix pattern, for inventory: the legacy desktop
    // app maintained `inventory.quantity` as a stored counter that two
    // historical write paths (quantity entered at item creation, direct
    // quantity edits from older app versions) updated with no backing fact
    // row at all — so `inventory_quantity_view` (a pure reconstruction from
    // `inventory_opening_stock` + `invoices`/`invoice_items` +
    // `stock_adjustments`, migration 027) can come out wildly divorced from
    // the stored counter the owner actually trusts. Runs inside this same
    // transaction — nested via a SAVEPOINT, see
    // `backfillInventoryBaseline`'s doc comment — so a failure here rolls
    // back the copy above too. Ordering after the opening-balance backfill
    // is not load-bearing (the two touch disjoint tables), but keeps every
    // "make the imported data reconcile with itself" step grouped together.
    inventoryBaseline = await backfillInventoryBaseline(target);
  });

  const warnings = [
    ...validation.warnings,
    ...(await checkImportIntegrity(target, backfill)),
    // Post-reconciliation audit: after backfillInventoryBaseline, every
    // inventory row's computed quantity must equal the desktop's stored
    // one — anything this returns is a defect the user must see, per item,
    // in the import report (see verifyInventoryReconciliation's doc
    // comment for why this runs against the real file every import).
    ...(await verifyInventoryReconciliation(target)),
  ];
  if (inventoryBaseline.reconciled > 0) {
    warnings.push(
      `${inventoryBaseline.reconciled} inventory item(s) reconciled with baseline stock ` +
        `adjustments (net ${inventoryBaseline.totalDelta} units) — their stored desktop quantity ` +
        `included history (item creation, direct edits from older app versions) with no backing ` +
        `opening-stock/invoice/adjustment fact row, so each was recorded as an opening-stock entry ` +
        `dated before the imported history so the on-hand quantity shown in this app matches what ` +
        `the desktop app reported.`,
    );
  }

  return {
    tables,
    warnings,
    sourceMigrationVersion: validation.sourceMigrationVersion,
  };
}
