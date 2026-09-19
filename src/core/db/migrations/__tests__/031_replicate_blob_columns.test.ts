import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../../main/adapters/BetterSqliteDriver';
import { SCHEMA_SNAPSHOT_SQL } from '../../schemaSnapshot';
import { bootstrapDatabase } from '../../bootstrap';
import { CORE_MIGRATIONS } from '..';
import { UUID_V4_SQL_EXPR } from '../029_create_sync_tables';

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

/**
 * `APPLYING_GUARD` copied verbatim (not exported by 029, and this file only
 * needs it to hand-build the *pre-031* buggy trigger below).
 */
const APPLYING_GUARD = `(SELECT value FROM sync_state WHERE key = 'applying') IS NULL`;

/**
 * Runs every {@link CORE_MIGRATIONS} entry up to (and NOT including)
 * `031_replicate_blob_columns`, against a freshly schema-snapshotted
 * database — i.e. the exact state a real device is in immediately before
 * migration 031 ever runs. Mirrors `bootstrapDatabase`'s own loop
 * (src/core/db/bootstrap.ts) rather than calling it directly, since
 * `bootstrapDatabase` always runs every `CORE_MIGRATIONS` entry including
 * 031 itself.
 */
async function bootstrapPre031(driver: BetterSqliteDriver): Promise<void> {
  await driver.exec(SCHEMA_SNAPSHOT_SQL);
  await driver.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT (DATETIME(CURRENT_TIMESTAMP, 'localtime'))
    )`,
  );
  for (const migration of CORE_MIGRATIONS) {
    if (migration.name === '031_replicate_blob_columns') continue;
    // eslint-disable-next-line no-await-in-loop
    await migration.up(driver);
    // eslint-disable-next-line no-await-in-loop
    await driver.run(`INSERT INTO migrations (name) VALUES (@name)`, {
      name: migration.name,
    });
  }
}

/**
 * Rebuilds migration 029's `trg_sync_capture_users_insert` in its
 * *pre-031* (buggy) form — the one that excludes every declared-BLOB column
 * (`password_hash`) from the row image entirely, rather than the fixed
 * `<col>`/`<col>__hex` typed-pair form this task adds. Used to put a test
 * database into exactly the state migration 031 exists to repair: sync
 * tables and `users` rows already present, but captured under the old,
 * credential-losing trigger — the same starting point a real pre-031
 * install is in (its 029 ran before this fix existed).
 */
async function installPre031UsersInsertTrigger(
  driver: BetterSqliteDriver,
): Promise<void> {
  await driver.exec(`DROP TRIGGER IF EXISTS "trg_sync_capture_users_insert"`);
  await driver.exec(`
    CREATE TRIGGER "trg_sync_capture_users_insert"
    AFTER INSERT ON "users"
    WHEN ${APPLYING_GUARD}
    BEGIN
      UPDATE "users" SET "uuid" = ${UUID_V4_SQL_EXPR}
        WHERE "id" = NEW."id" AND "uuid" IS NULL;

      INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
      SELECT ${UUID_V4_SQL_EXPR}, 'users', t."uuid", 'put',
        json_object('id', t."id", 'username', t."username", 'status', t."status", 'uuid', t."uuid"),
        datetime('now')
      FROM "users" t
      WHERE t."id" = NEW."id";
    END;
  `);
}

describe('core migration 031 (replicate declared-blob columns)', () => {
  it('is registered exactly once in CORE_MIGRATIONS, immediately after 030', () => {
    const names = CORE_MIGRATIONS.map((m) => m.name);
    expect(
      names.filter((n) => n === '031_replicate_blob_columns'),
    ).toHaveLength(1);
    expect(names.indexOf('031_replicate_blob_columns')).toBe(
      names.indexOf('030_create_sync_apply_conflicts') + 1,
    );
  });

  it('re-emits exactly one corrective users row (the hashed one, not the NULL-hash one), and recreates the capture trigger so a fresh INSERT captures password_hash', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapPre031(driver);
    await installPre031UsersInsertTrigger(driver);

    // Two pre-existing users, inserted under the old buggy trigger: one
    // with a real (TEXT-in-a-BLOB-column) password hash, one with none —
    // exactly the two cases the corrective re-emission has to tell apart.
    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run('hashed-user', 'saltHex:hashHex');
    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run('hashless-user', null);

    const hashedUuid = (
      db
        .prepare(`SELECT uuid FROM users WHERE username = 'hashed-user'`)
        .get() as { uuid: string }
    ).uuid;

    // Isolate migration 031's own effect from whatever the old trigger
    // captured on insert above.
    db.exec(`DELETE FROM sync_outbox`);

    const migration031 = CORE_MIGRATIONS.find(
      (m) => m.name === '031_replicate_blob_columns',
    )!;
    await migration031.up(driver);

    const outboxRows = db
      .prepare(`SELECT id, tableName, rowUuid, op, rowJson FROM sync_outbox`)
      .all() as OutboxRow[];
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].tableName).toBe('users');
    expect(outboxRows[0].op).toBe('put');
    expect(outboxRows[0].rowUuid).toBe(hashedUuid);

    const corrected = JSON.parse(outboxRows[0].rowJson) as {
      password_hash: string | null;
      password_hash__hex: string | null;
    };
    // A TEXT value in the BLOB-declared column travels as plain JSON text,
    // not hex — see migration 029's jsonObjectExpr doc comment.
    expect(corrected.password_hash).toBe('saltHex:hashHex');
    expect(corrected.password_hash__hex).toBeNull();

    // Triggers were recreated: a brand-new INSERT now captures
    // password_hash, which the pre-031 trigger installed above never did.
    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run('new-user', 'newSalt:newHash');
    const newRow = db
      .prepare(
        `SELECT rowJson FROM sync_outbox WHERE tableName = 'users' AND rowJson LIKE '%new-user%'`,
      )
      .get() as { rowJson: string } | undefined;
    expect(newRow).toBeDefined();
    const newParsed = JSON.parse(newRow!.rowJson) as {
      password_hash: string | null;
    };
    expect(newParsed.password_hash).toBe('newSalt:newHash');

    db.close();
  });

  it('re-emits MULTIPLE hashed users with distinct idempotency keys (regression: a non-correlated uuid subquery evaluates once per statement, so a bulk seed used to give every row the same key and violate sync_outbox UNIQUE)', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapPre031(driver);
    await installPre031UsersInsertTrigger(driver);

    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run('owner', 'ownerSalt:ownerHash');
    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run('employee', 'empSalt:empHash');
    db.exec(`DELETE FROM sync_outbox`);

    const migration031 = CORE_MIGRATIONS.find(
      (m) => m.name === '031_replicate_blob_columns',
    )!;
    // Before the fix this threw: UNIQUE constraint failed on
    // sync_outbox.idempotencyKey (same generated key for both rows).
    await migration031.up(driver);

    const rows = db
      .prepare(
        `SELECT idempotencyKey, rowUuid FROM sync_outbox WHERE tableName = 'users'`,
      )
      .all() as Array<{ idempotencyKey: string; rowUuid: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].idempotencyKey).not.toBe(rows[1].idempotencyKey);
    rows.forEach((r) =>
      expect(r.idempotencyKey).toBe(`${r.rowUuid}:corrective-031`),
    );

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
        `SELECT COUNT(*) AS c FROM migrations WHERE name = '031_replicate_blob_columns'`,
      )
      .get() as { c: number };
    expect(applied.c).toBe(1);

    db.close();
  });
});
