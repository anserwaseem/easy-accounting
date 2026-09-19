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

interface OutboxRow {
  rowJson: string;
}

/**
 * Migration 029's fixed capture triggers, exercised directly at the SQL
 * level (no `SyncEngine` involved) — the field bug this closes was in the
 * row image itself, not in how it's later applied. See
 * `031_replicate_blob_columns.test.ts` for the migration-031 upgrade path,
 * and `SyncEngine.test.ts`'s convergence scenarios for the end-to-end
 * round-trip through two devices.
 */
describe('migration 029 capture triggers: declared-blob columns (users.password_hash)', () => {
  it('captures a TEXT value stored in a declared-blob column as plain JSON text, with a null __hex sibling', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run('desktop-user', 'deadbeefsalt:deadbeefhash');

    const row = db
      .prepare(
        `SELECT rowJson FROM sync_outbox WHERE tableName = 'users' ORDER BY id DESC LIMIT 1`,
      )
      .get() as OutboxRow;
    const parsed = JSON.parse(row.rowJson) as {
      password_hash: string | null;
      password_hash__hex: string | null;
    };

    expect(parsed.password_hash).toBe('deadbeefsalt:deadbeefhash');
    expect(parsed.password_hash__hex).toBeNull();

    db.close();
  });

  it('captures a real blob value as hex, with a null plain sibling', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    const blob = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run('blob-user', blob);

    const row = db
      .prepare(
        `SELECT rowJson FROM sync_outbox WHERE tableName = 'users' ORDER BY id DESC LIMIT 1`,
      )
      .get() as OutboxRow;
    const parsed = JSON.parse(row.rowJson) as {
      password_hash: string | null;
      password_hash__hex: string | null;
    };

    expect(parsed.password_hash).toBeNull();
    expect(parsed.password_hash__hex).toBe('DEADBEEF');

    db.close();
  });

  it('a NULL password_hash captures as null on both keys (not mistaken for an empty blob)', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run('no-hash-user', null);

    const row = db
      .prepare(
        `SELECT rowJson FROM sync_outbox WHERE tableName = 'users' ORDER BY id DESC LIMIT 1`,
      )
      .get() as OutboxRow;
    const parsed = JSON.parse(row.rowJson) as {
      password_hash: string | null;
      password_hash__hex: string | null;
    };

    expect(parsed.password_hash).toBeNull();
    expect(parsed.password_hash__hex).toBeNull();

    db.close();
  });
});

/**
 * Direct proof of the `sync_state.applying` echo-suppression mechanism
 * every capture trigger's `APPLYING_GUARD` gates on — the SAME mechanism
 * `apps/web/src/worker/db.worker.ts`'s `withCaptureSuppressed` (wrapping
 * `ensurePlaceholderDefaultUser`'s boot-time placeholder insert — see that
 * function's doc comment for the real cross-device username-collision
 * incident this closes) and `SyncEngine.rebuildFromServer`'s wholesale wipe
 * both rely on, set directly via SQL rather than through a `SyncEngine`
 * instance (neither caller has one at the point it needs this). A worker
 * (wasm) environment can't be driven directly from jest, so this is the
 * closest a unit test gets to the boot-time suppression path itself — see
 * this repo's task-list "Worker-level placeholder suppression" note for why
 * this substitutes for a true worker-level test, plus e2e coverage for the
 * rest of the boot path.
 */
describe('migration 029 capture triggers: sync_state.applying suppression', () => {
  it('a write made while sync_state.applying is set produces no sync_outbox rows, for INSERT, UPDATE, and DELETE alike', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    db.prepare(
      `INSERT INTO sync_state (key, value) VALUES ('applying', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();

    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run('suppressed-user', 'irrelevant-hash');
    db.prepare(`UPDATE users SET status = 0 WHERE username = ?`).run(
      'suppressed-user',
    );
    db.prepare(`DELETE FROM users WHERE username = ?`).run('suppressed-user');

    const outboxCount = db
      .prepare(`SELECT COUNT(*) AS c FROM sync_outbox`)
      .get() as { c: number };
    expect(outboxCount.c).toBe(0);

    // Clearing the flag (the other half of the same suppression window —
    // withCaptureSuppressed's `finally`) restores normal capture, proving
    // the zero count above was really the flag's doing, not some unrelated
    // reason nothing got captured (e.g. a broken trigger).
    db.prepare(`DELETE FROM sync_state WHERE key = 'applying'`).run();
    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run('unsuppressed-user', 'irrelevant-hash');

    const outboxCountAfter = db
      .prepare(`SELECT COUNT(*) AS c FROM sync_outbox`)
      .get() as { c: number };
    expect(outboxCountAfter.c).toBeGreaterThan(0);

    db.close();
  });
});
