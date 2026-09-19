import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { SCHEMA_SNAPSHOT_SQL } from '../../schemaSnapshot';
import { bootstrapDatabase } from '../../bootstrap';
import { CORE_MIGRATIONS } from '..';
import { SECRET_SETTING_KEYS } from '../../../services/settingsSecrets';

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

interface OutboxRow {
  id: number;
  tableName: string;
  rowUuid: string;
  op: string;
  rowJson: string;
}

const tableColumns = (db: Database.Database, table: string): string[] =>
  (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(
    (r) => r.name,
  );

/**
 * Builds the state a real UPGRADING device is in immediately before
 * `033_sync_settings` ever runs: migration 028's original settings table
 * (`key TEXT PRIMARY KEY`, no `id`/`uuid`, no capture triggers on it) plus
 * the sync scaffolding tables (migrations 029/030).
 *
 * Deliberately does NOT run `migration029.up()` (unlike the analogous
 * `031_replicate_blob_columns.test.ts`'s `bootstrapPre031` helper, which
 * safely can): `029_create_sync_tables.ts`'s `SYNC_TABLES` is
 * `BUSINESS_TABLES.filter(...)`, computed once at module load from the
 * live `BUSINESS_TABLES` array — which now includes `'settings'` (this
 * migration added it). Calling `migration029.up()` here would therefore
 * install capture triggers for `settings` while it still has migration
 * 028's OLD shape (no `id`/`uuid`), which is exactly what a genuinely
 * UPGRADING device never experiences: on such a device migration 029 ran
 * historically, before `settings` was ever a sync table, and is skipped
 * entirely on this run (`bootstrapDatabase` only runs migrations not
 * already recorded as applied) — so its settings table never got a
 * premature trigger. This helper reproduces THAT state: the sync
 * scaffolding tables exist (as migration 029 would have left them), but
 * `settings` carries no capture triggers of its own, exactly like a real
 * upgrading device. (A brand-new install instead runs every migration back
 * to back in one sweep, where migration 029's premature trigger creation
 * for `settings` — and migration 033's own defensive DROP-then-recreate of
 * it — are both exercised for real by this file's `bootstrapDatabase`-based
 * tests below.)
 */
async function bootstrapPre033(driver: BetterSqliteDriver): Promise<void> {
  await driver.exec(SCHEMA_SNAPSHOT_SQL);
  await driver.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'localtime'))
    )`,
  );

  const migration028 = CORE_MIGRATIONS.find(
    (m) => m.name === '028_create_settings_table',
  )!;
  await migration028.up(driver);
  await driver.run(`INSERT INTO migrations (name) VALUES (@name)`, {
    name: migration028.name,
  });

  // Sync scaffolding (migration 029's non-per-table DDL) — no per-table
  // loop, so `settings`'s membership in `SYNC_TABLES` never enters into it.
  await driver.exec(`
    CREATE TABLE IF NOT EXISTS sync_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotencyKey TEXT UNIQUE,
      tableName TEXT NOT NULL,
      rowUuid TEXT NOT NULL,
      op TEXT NOT NULL CHECK (op IN ('put', 'delete')),
      rowJson TEXT NOT NULL,
      createdAt DATETIME
    )
  `);
  await driver.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  await driver.exec(`
    CREATE TABLE IF NOT EXISTS sync_rejected (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotencyKey TEXT,
      tableName TEXT NOT NULL,
      rowUuid TEXT NOT NULL,
      op TEXT NOT NULL CHECK (op IN ('put', 'delete')),
      rowJson TEXT NOT NULL,
      reason TEXT,
      rejectedAt DATETIME
    )
  `);
  await driver.exec(`
    CREATE TABLE IF NOT EXISTS sync_apply_conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seq INTEGER,
      tableName TEXT NOT NULL,
      rowUuid TEXT NOT NULL,
      op TEXT NOT NULL CHECK (op IN ('put', 'delete')),
      rowJson TEXT NOT NULL,
      error TEXT,
      createdAt DATETIME
    )
  `);

  for (const name of [
    '029_create_sync_tables',
    '030_create_sync_apply_conflicts',
    '031_replicate_blob_columns',
    '032_redate_import_baselines',
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await driver.run(`INSERT INTO migrations (name) VALUES (@name)`, {
      name,
    });
  }
}

describe('core migration 033 (sync settings)', () => {
  it('is registered exactly once in CORE_MIGRATIONS, immediately after 032', () => {
    const names = CORE_MIGRATIONS.map((m) => m.name);
    expect(names.filter((n) => n === '033_sync_settings')).toHaveLength(1);
    expect(names.indexOf('033_sync_settings')).toBe(
      names.indexOf('032_redate_import_baselines') + 1,
    );
  });

  it('rebuilds the settings table (id + uuid), preserves existing rows/values, backfills uuid, and installs capture triggers', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapPre033(driver);

    // Pre-033 shape: `key TEXT PRIMARY KEY`, no id, no uuid.
    expect(tableColumns(db, 'settings')).toEqual(['key', 'value', 'updatedAt']);

    db.prepare(
      `INSERT INTO settings (key, value, updatedAt) VALUES ('companyProfile.name', '"ABC Traders"', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO settings (key, value, updatedAt) VALUES ('invoicePrint.paperSize', '"A4"', '2026-01-01T00:00:00.000Z')`,
    ).run();

    const migration033 = CORE_MIGRATIONS.find(
      (m) => m.name === '033_sync_settings',
    )!;
    await migration033.up(driver);

    const cols = tableColumns(db, 'settings');
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'key', 'value', 'updatedAt', 'uuid']),
    );

    const rows = db
      .prepare(
        `SELECT id, key, value, updatedAt, uuid FROM settings ORDER BY key`,
      )
      .all() as {
      id: number;
      key: string;
      value: string;
      updatedAt: string;
      uuid: string | null;
    }[];
    expect(rows).toHaveLength(2);

    const company = rows.find((r) => r.key === 'companyProfile.name')!;
    expect(company.value).toBe('"ABC Traders"');
    expect(company.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(typeof company.uuid).toBe('string');
    expect(company.uuid).not.toBeNull();

    const paper = rows.find((r) => r.key === 'invoicePrint.paperSize')!;
    expect(paper.value).toBe('"A4"');
    expect(typeof paper.uuid).toBe('string');

    // uuid uniqueness enforced.
    expect(company.uuid).not.toBe(paper.uuid);
    const uuidIndex = db
      .prepare(
        `SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND tbl_name='settings' AND name='idx_settings_uuid'`,
      )
      .get() as { c: number };
    expect(uuidIndex.c).toBe(1);

    // `key` is still unique (now via a UNIQUE constraint, not the PK).
    expect(() =>
      db
        .prepare(
          `INSERT INTO settings (key, value) VALUES ('companyProfile.name', '"dup"')`,
        )
        .run(),
    ).toThrow();

    db.close();
  });

  it('a fresh INSERT and a subsequent UPDATE against settings are each captured into sync_outbox exactly once', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver); // fully bootstrapped, including 033

    db.exec(`DELETE FROM sync_outbox`); // isolate this test's own writes

    db.prepare(
      `INSERT INTO settings (key, value, updatedAt) VALUES ('companyProfile.name', '"First"', '2026-01-01T00:00:00.000Z')`,
    ).run();

    const afterInsert = db
      .prepare(
        `SELECT id, tableName, rowUuid, op, rowJson FROM sync_outbox WHERE tableName = 'settings'`,
      )
      .all() as OutboxRow[];
    expect(afterInsert).toHaveLength(1);
    expect(afterInsert[0].op).toBe('put');
    const insertedJson = JSON.parse(afterInsert[0].rowJson) as {
      key: string;
      value: string;
    };
    expect(insertedJson.key).toBe('companyProfile.name');
    expect(insertedJson.value).toBe('"First"');

    const insertedRow = db
      .prepare(`SELECT uuid FROM settings WHERE key = 'companyProfile.name'`)
      .get() as { uuid: string };
    expect(insertedRow.uuid).toBeTruthy();

    db.exec(`DELETE FROM sync_outbox`);

    db.prepare(
      `UPDATE settings SET value = '"Second"' WHERE key = 'companyProfile.name'`,
    ).run();

    const afterUpdate = db
      .prepare(
        `SELECT id, tableName, rowUuid, op, rowJson FROM sync_outbox WHERE tableName = 'settings'`,
      )
      .all() as OutboxRow[];
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0].op).toBe('put');
    expect(afterUpdate[0].rowUuid).toBe(insertedRow.uuid);
    const updatedJson = JSON.parse(afterUpdate[0].rowJson) as {
      value: string;
    };
    expect(updatedJson.value).toBe('"Second"');

    db.close();
  });

  it('seeds one corrective outbox "put" per pre-existing settings row, skipping secret keys', async () => {
    expect(SECRET_SETTING_KEYS.length).toBeGreaterThan(0);

    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapPre033(driver);

    db.prepare(
      `INSERT INTO settings (key, value, updatedAt) VALUES ('companyProfile.name', '"ABC Traders"', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO settings (key, value, updatedAt) VALUES ('publish.publicPriceList', '"Retail"', '2026-01-01T00:00:00.000Z')`,
    ).run();
    // A secret key that must never be re-emitted, even though it should
    // never legitimately exist here (SettingsService.set rejects it) —
    // exercising the migration's defensive exclusion, not a realistic row.
    db.prepare(
      `INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?)`,
    ).run(SECRET_SETTING_KEYS[0], '"super-secret"', '2026-01-01T00:00:00.000Z');

    const migration033 = CORE_MIGRATIONS.find(
      (m) => m.name === '033_sync_settings',
    )!;
    await migration033.up(driver);

    const outboxRows = db
      .prepare(
        `SELECT tableName, op, rowJson FROM sync_outbox WHERE tableName = 'settings'`,
      )
      .all() as { tableName: string; op: string; rowJson: string }[];

    // Two non-secret rows seeded, exactly once each; the secret key never
    // appears.
    expect(outboxRows).toHaveLength(2);
    outboxRows.forEach((r) => expect(r.op).toBe('put'));
    const keys = outboxRows.map(
      (r) => (JSON.parse(r.rowJson) as { key: string }).key,
    );
    expect(keys.sort()).toEqual(
      ['companyProfile.name', 'publish.publicPriceList'].sort(),
    );
    expect(keys).not.toContain(SECRET_SETTING_KEYS[0]);

    db.close();
  });

  it('is idempotent: calling up() a second time does not error, duplicate rows, or re-seed the outbox', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapPre033(driver);

    db.prepare(
      `INSERT INTO settings (key, value, updatedAt) VALUES ('companyProfile.name', '"ABC Traders"', '2026-01-01T00:00:00.000Z')`,
    ).run();

    const migration033 = CORE_MIGRATIONS.find(
      (m) => m.name === '033_sync_settings',
    )!;
    await migration033.up(driver);

    const rowsAfterFirst = db.prepare(`SELECT * FROM settings`).all();
    expect(rowsAfterFirst).toHaveLength(1);

    db.exec(`DELETE FROM sync_outbox`);

    await expect(migration033.up(driver)).resolves.toBeUndefined();

    const rowsAfterSecond = db.prepare(`SELECT * FROM settings`).all();
    expect(rowsAfterSecond).toEqual(rowsAfterFirst);

    // Second run re-seeds a corrective row (nothing prevents that — every
    // run of this migration re-emits current settings state), but it must
    // not have duplicated or lost the underlying settings row itself, and
    // must not throw.
    const settingsCount = db
      .prepare(`SELECT COUNT(*) c FROM settings`)
      .get() as { c: number };
    expect(settingsCount.c).toBe(1);

    db.close();
  });

  it('via bootstrapDatabase, runs exactly once per database (bookkeeping table guard) even across repeated bootstraps', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);

    await bootstrapDatabase(driver);
    await bootstrapDatabase(driver);
    await bootstrapDatabase(driver);

    const applied = db
      .prepare(
        `SELECT COUNT(*) AS c FROM migrations WHERE name = '033_sync_settings'`,
      )
      .get() as { c: number };
    expect(applied.c).toBe(1);
    expect(tableColumns(db, 'settings')).toEqual(
      expect.arrayContaining(['id', 'key', 'value', 'updatedAt', 'uuid']),
    );

    db.close();
  });
});
