/**
 * Generates the frozen schema snapshot used to bootstrap fresh databases
 * (web / SQLite-wasm) without running the historical `src/main/migrations/*.js`
 * files, which use better-sqlite3's synchronous API and cannot run in a browser.
 *
 * Unified chain (post schema-merge):
 *   - `scripts/frozen-web-schema/schema.sql` (shared 001-era CREATE TABLEs)
 *   - `src/main/migrations/001.js`–`026.js` (shared 001–023 + desktop
 *     invoice-date / vendor-stock / Urdu)
 *   - `src/main/migrations/027.js`–`030.js` (uuid, opening-balance→journal,
 *     lookup indexes, ledger/inventory quantity *views* — additive; the
 *     `ledger` table remains, so Electron services can still INSERT into it)
 *
 * Core 028+ (`src/core/db/migrations`, plus JS twins 031.js–038.js) are NOT
 * baked into this snapshot — `bootstrapDatabase` applies those on top.
 *
 * Two artifacts are written from a single build:
 *   - src/core/db/schema.snapshot.sql
 *   - src/core/db/schemaSnapshot.ts
 *
 * Regenerate with:
 *   npx ts-node scripts/generate-schema-snapshot.ts
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const ROOT_DIR = path.join(__dirname, '..');
const FROZEN_WEB_DIR = path.join(ROOT_DIR, 'scripts/frozen-web-schema');
const SCHEMA_SQL_PATH = path.join(FROZEN_WEB_DIR, 'schema.sql');
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'src/main/migrations');
const SNAPSHOT_SQL_PATH = path.join(
  ROOT_DIR,
  'src/core/db/schema.snapshot.sql',
);
const SNAPSHOT_TS_PATH = path.join(ROOT_DIR, 'src/core/db/schemaSnapshot.ts');

/** The migration range this snapshot freezes (filename numbers 001–030). */
export const FROZEN_MIGRATION_RANGE = '001-030';

export interface LoadedMigration {
  name: string;
  up: (db: Database.Database) => unknown;
  fileName: string;
}

function loadMigrationFile(dir: string, fileName: string): LoadedMigration {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const mod = require(path.join(dir, fileName));
  const migration = mod.default || mod;
  return { ...migration, fileName };
}

/**
 * Historical JS migrations baked into the snapshot: 001–030.
 * 031.js–038.js are core 028–035 twins and must NOT run here.
 */
export function loadMigrations(): LoadedMigration[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^(00[1-9]|01\d|02\d|030)\.js$/.test(f))
    .sort()
    .map((fileName) => loadMigrationFile(MIGRATIONS_DIR, fileName));
}

/**
 * Applies the frozen base schema.sql + migrations 001–030 onto `db`
 * and records those names in `migrations`.
 *
 * `upToInclusive` (filename number) stops after that migration — used by
 * import tests that replay a historical desktop-format file.
 */
export function applyFrozenWebSchema(
  db: Database.Database,
  upToInclusive = 30,
): void {
  const schemaSql = fs.readFileSync(SCHEMA_SQL_PATH, 'utf-8');
  db.exec(schemaSql);

  db.prepare(
    `CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'localtime'))
    )`,
  ).run();

  for (const migration of loadMigrations()) {
    const num = Number(
      migration.fileName.slice(0, migration.fileName.indexOf('.')),
    );
    if (num > upToInclusive) break;
    const result = migration.up(db);
    if (result !== true) {
      throw new Error(
        `Migration ${migration.name} (${migration.fileName}) did not return ` +
          'true while applying the frozen web schema.',
      );
    }
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
  }
}

/**
 * Builds an in-memory database via the frozen web bootstrap.
 * Exported so bootstrap.test.ts can build the same reference database.
 */
export function buildProductionDatabase(): Database.Database {
  const db = new Database(':memory:');
  applyFrozenWebSchema(db);
  return db;
}

interface SchemaObject {
  type: string;
  name: string;
  sql: string;
}

/** Creation order: tables first (no FK-ordering issues in this schema), then
 * indexes and triggers (which reference tables only), then views. Within a
 * type, alphabetical is deterministic and — for this schema — also
 * satisfies view-on-view dependencies: journal_entry_pairs < ledger_lines <
 * ledger_view alphabetically, which is also their dependency order. */
const TYPE_ORDER = ['table', 'index', 'trigger', 'view'];

export function extractSnapshotObjects(db: Database.Database): SchemaObject[] {
  const rows = db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`,
    )
    .all() as SchemaObject[];

  return [...rows].sort((a, b) => {
    const typeDiff = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
    if (typeDiff !== 0) return typeDiff;
    return a.name.localeCompare(b.name);
  });
}

function sqliteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildSnapshotSql(db: Database.Database): string {
  const objects = extractSnapshotObjects(db);
  const migrationNames = (
    db.prepare('SELECT name FROM migrations ORDER BY id').all() as {
      name: string;
    }[]
  ).map((r) => r.name);

  const header = `-- AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
-- Generated by scripts/generate-schema-snapshot.ts
-- Regenerate with: npx ts-node scripts/generate-schema-snapshot.ts
--
-- Frozen schema snapshot for migrations ${FROZEN_MIGRATION_RANGE}
-- (scripts/frozen-web-schema/schema.sql + src/main/migrations/001.js..030.js).
--
-- Bootstraps a fresh database (web, and eventually new desktop installs) to
-- the exact schema state produced by running that schema.sql followed by
-- migrations 001-030 through the historical (better-sqlite3-sync)
-- MigrationRunner. Includes the \`migrations\` bookkeeping table, pre-seeded
-- with those names, so that if the desktop MigrationRunner ever opens a
-- database bootstrapped from this snapshot, it treats them as already
-- applied and does not attempt to re-run them.
--
-- Future schema changes belong in src/core/db/migrations (028+), written
-- platform-free against DatabaseDriver -- NOT in this file. Existing
-- Electron installs still get 028-035 via src/main/migrations/031.js..038.js
-- twins (same recorded names).
`;

  const body = objects.map((o) => `${o.sql.trim()};`).join('\n\n');

  const migrationInserts = migrationNames
    .map(
      (name) =>
        `INSERT INTO migrations (name) VALUES (${sqliteStringLiteral(name)});`,
    )
    .join('\n');

  return (
    `${header}\n${body}\n\n` +
    `-- Mark migrations ${FROZEN_MIGRATION_RANGE} as already applied.\n${migrationInserts}\n`
  );
}

function escapeTemplateLiteral(sql: string): string {
  return sql
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function buildSnapshotTsModule(sql: string): string {
  return `// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Generated by scripts/generate-schema-snapshot.ts together with
// schema.snapshot.sql -- regenerate both with:
//   npx ts-node scripts/generate-schema-snapshot.ts
//
// src/core cannot read schema.snapshot.sql off disk at runtime (no \`fs\` on
// the web target), so the same SQL is embedded here as a string constant.
// schema.snapshot.sql remains the human-diffable copy; this module is what
// bootstrap.ts actually imports. The two are always generated together and
// must never be edited independently.

export const SCHEMA_SNAPSHOT_SQL = \`${escapeTemplateLiteral(sql)}\`;
`;
}

export function writeSnapshotFiles(sql: string): void {
  fs.writeFileSync(SNAPSHOT_SQL_PATH, sql, 'utf-8');
  fs.writeFileSync(SNAPSHOT_TS_PATH, buildSnapshotTsModule(sql), 'utf-8');
}

function main(): void {
  const db = buildProductionDatabase();
  try {
    const sql = buildSnapshotSql(db);
    writeSnapshotFiles(sql);

    const objects = extractSnapshotObjects(db);
    const counts = objects.reduce<Record<string, number>>((acc, o) => {
      acc[o.type] = (acc[o.type] || 0) + 1;
      return acc;
    }, {});
    const lineCount = sql.split('\n').length;

    console.log('Schema snapshot regenerated:');
    console.log(`  ${SNAPSHOT_SQL_PATH}`);
    console.log(`  ${SNAPSHOT_TS_PATH}`);
    console.log(
      `  tables=${counts.table || 0} indexes=${counts.index || 0} ` +
        `triggers=${counts.trigger || 0} views=${counts.view || 0} ` +
        `lines=${lineCount}`,
    );
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main();
}
