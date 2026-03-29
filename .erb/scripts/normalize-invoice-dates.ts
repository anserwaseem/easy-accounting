/**
 * Rewrites invoices.date to yyyy-MM-dd using the same rules as normalizeToSqliteDate
 * (US M/D/YYYY slashes, ISO with optional time, etc.) so SQLite datetime() works.
 *
 * Run against a copy first if unsure. Requires EASY_ACCOUNTING_DB_PATH (same as import:historic).
 *
 *   EASY_ACCOUNTING_DB_PATH=release/app/database.db npm run normalize:invoice-dates
 *
 * Dry run (no writes):
 *   EASY_ACCOUNTING_DB_PATH=... npm run normalize:invoice-dates -- --dry-run
 *
 * By default, any row where normalizeToSqliteDate(date) !== date is updated. That includes values
 * SQLite already understands (e.g. 2025-10-08T19:00:00.000Z → 2025-10-08), so you may see
 * "would update" for every row if all are ISO-with-time. To touch only rows SQLite cannot parse
 * (typical MM/DD/YYYY), add --only-unparseable.
 *
 *   ... npm run normalize:invoice-dates -- --dry-run --only-unparseable
 *
 * While applying updates, the script temporarily drops after_update_invoices_add_timestamp so
 * updatedAt (and createdAt) are not touched—only date changes. Trigger DDL must stay in sync
 * with src/sql/schema.sql (invoices after_update_invoices_add_timestamp).
 */

import fs from 'fs';
import path from 'path';
import { DatabaseService } from '../../src/main/services/Database.service';
import { normalizeToSqliteDate } from '../../src/main/utils/general';

const dryRun = process.argv.includes('--dry-run');
const onlyUnparseable = process.argv.includes('--only-unparseable');

/** keep in sync with schema.sql — used to restore after batch date fixes */
const INVOICES_AFTER_UPDATE_TRIGGER_SQL = `
CREATE TRIGGER IF NOT EXISTS after_update_invoices_add_timestamp
AFTER UPDATE ON invoices
BEGIN
  UPDATE invoices SET
    updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
  WHERE id = NEW.id;
END;
`;

if (!process.env.EASY_ACCOUNTING_DB_PATH?.trim()) {
  console.error('Set EASY_ACCOUNTING_DB_PATH to your SQLite database file.');
  process.exit(1);
}
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(logsDir, `normalize-invoice-dates-${ts}.log`);
function logLine(message: string) {
  fs.appendFileSync(logFile, `${message}\n`, 'utf8');
}

DatabaseService.resetInstance();
const db = DatabaseService.getInstance().getDatabase();

const stmSqliteDatetime = db.prepare('SELECT datetime(@value) AS dt');

/** true when SQLite can turn the stored string into a datetime (excludes typical MM/DD/YYYY). */
const sqliteDatetimeParses = (value: string): boolean => {
  const row = stmSqliteDatetime.get({ value }) as { dt: string | null };
  const dt = row?.dt;
  return dt != null && dt !== '';
};

type Row = { id: number; date: string };
const rows = db.prepare('SELECT id, date FROM invoices').all() as Row[];

let wouldUpdate = 0;
let unchanged = 0;
let skippedAlreadyParsable = 0;
const failures: Array<{ id: number; date: string; error: string }> = [];
const pendingUpdates: Array<{ id: number; date: string }> = [];

for (const row of rows) {
  try {
    const raw = String(row.date ?? '');
    if (onlyUnparseable && sqliteDatetimeParses(raw)) {
      skippedAlreadyParsable += 1;
      continue;
    }
    const next = normalizeToSqliteDate(raw);
    if (next !== row.date) {
      wouldUpdate += 1;
      if (!dryRun) {
        pendingUpdates.push({ id: row.id, date: next });
      }
    } else {
      unchanged += 1;
    }
  } catch (e) {
    failures.push({
      id: row.id,
      date: row.date,
      error: String(e),
    });
  }
}

if (!dryRun && pendingUpdates.length > 0) {
  let triggerDropped = false;
  try {
    logLine(
      'temporarily dropping after_update_invoices_add_timestamp so updatedAt is preserved',
    );
    db.exec('DROP TRIGGER IF EXISTS after_update_invoices_add_timestamp');
    triggerDropped = true;
    const upd = db.prepare('UPDATE invoices SET date = @date WHERE id = @id');
    db.transaction(() => {
      for (const u of pendingUpdates) {
        upd.run(u);
      }
    })();
    logLine('recreated after_update_invoices_add_timestamp');
  } catch (e) {
    logLine(`batch update failed: ${String(e)}`);
    throw e;
  } finally {
    if (triggerDropped) {
      db.exec(INVOICES_AFTER_UPDATE_TRIGGER_SQL);
    }
  }
}

logLine('='.repeat(60));
logLine(`normalize-invoice-dates ${new Date().toISOString()}`);
logLine(`DB: ${process.env.EASY_ACCOUNTING_DB_PATH}`);
logLine(`dryRun: ${String(dryRun)}`);
logLine(`onlyUnparseable: ${String(onlyUnparseable)}`);
logLine(`rows: ${rows.length}`);
logLine(`updated (or would update): ${wouldUpdate}`);
logLine(`unchanged: ${unchanged}`);
logLine(`skippedAlreadyParsable: ${skippedAlreadyParsable}`);
logLine(`failed: ${failures.length}`);
if (failures.length > 0) {
  logLine('failures:');
  failures.slice(0, 200).forEach((f) => {
    logLine(`  id=${f.id} date=${JSON.stringify(f.date)} ${f.error}`);
  });
  if (failures.length > 200) {
    logLine(`  ... and ${failures.length - 200} more`);
  }
}
logLine('='.repeat(60));

console.log(`Log: ${logFile}`);
const skipMsg =
  onlyUnparseable && skippedAlreadyParsable > 0
    ? `, ${skippedAlreadyParsable} skipped (SQLite already parses date)`
    : '';
console.log(
  dryRun
    ? `[dry-run] would update ${wouldUpdate} of ${rows.length} invoices (${unchanged} already canonical${skipMsg})`
    : `updated ${wouldUpdate} of ${rows.length} invoices (${unchanged} unchanged${skipMsg})`,
);
if (!dryRun && wouldUpdate > 0) {
  console.log(
    'invoices.updatedAt was left unchanged (update trigger was dropped for this batch only)',
  );
}
if (!onlyUnparseable && wouldUpdate === rows.length && rows.length > 0) {
  console.log(
    'tip: if you only need to fix MM/DD/YYYY (unparseable) rows, rerun with --only-unparseable',
  );
}
if (failures.length > 0) {
  console.error(`failed to parse ${failures.length} row(s); see log`);
  process.exit(1);
}
