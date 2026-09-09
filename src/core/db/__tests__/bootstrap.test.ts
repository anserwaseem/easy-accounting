import Database from 'better-sqlite3';
import type { SessionContext } from '../../ports';
import { AccountService } from '../../services/AccountService';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../bootstrap';
import { buildProductionDatabase } from '../../../../scripts/generate-schema-snapshot';

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

interface SchemaObject {
  type: string;
  name: string;
  sql: string;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/** {type, name, normalized sql} for every table/index/trigger/view, sorted
 * deterministically — a schema "fingerprint" independent of statement
 * ordering or incidental whitespace. */
function schemaSignature(db: Database.Database): SchemaObject[] {
  const rows = db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
         AND type IN ('table', 'index', 'trigger', 'view')`,
    )
    .all() as SchemaObject[];

  return rows
    .map((r) => ({ type: r.type, name: r.name, sql: normalizeSql(r.sql) }))
    .sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`));
}

function migrationsSignature(db: Database.Database): string[] {
  return (db.prepare('SELECT name FROM migrations').all() as { name: string }[])
    .map((r) => r.name)
    .sort();
}

describe('bootstrapDatabase', () => {
  it('produces a schema equivalent to the frozen snapshot plus CORE_MIGRATIONS', async () => {
    // Reference: snapshot (001-030) then the same 028+ core migrations
    // bootstrapDatabase applies on an already-populated DB.
    const referenceDb = buildProductionDatabase();
    await bootstrapDatabase(new BetterSqliteDriver(referenceDb));

    const bootstrappedDb = new Database(':memory:');
    await bootstrapDatabase(new BetterSqliteDriver(bootstrappedDb));

    expect(schemaSignature(bootstrappedDb)).toEqual(
      schemaSignature(referenceDb),
    );
    expect(migrationsSignature(bootstrappedDb)).toEqual(
      migrationsSignature(referenceDb),
    );

    referenceDb.close();
    bootstrappedDb.close();
  });

  it('is a no-op the second time', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);

    await bootstrapDatabase(driver);
    const schemaBefore = schemaSignature(db);
    const migrationsBefore = migrationsSignature(db);

    await bootstrapDatabase(driver);

    expect(schemaSignature(db)).toEqual(schemaBefore);
    expect(migrationsSignature(db)).toEqual(migrationsBefore);

    db.close();
  });

  it('smoke: core AccountService can insert and read an account after bootstrap', async () => {
    const db = new Database(':memory:');
    const driver = new BetterSqliteDriver(db);
    await bootstrapDatabase(driver);

    const username = 'testuser';
    db.prepare(
      `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
    ).run(username, Buffer.from('x'));
    const userId = (
      db.prepare(`SELECT id FROM users WHERE username = ?`).get(username) as {
        id: number;
      }
    ).id;
    db.prepare(
      `INSERT INTO chart (date, name, type, userId) VALUES (?, ?, ?, ?)`,
    ).run('2025-01-01', 'Current Asset', 'Asset', userId);

    const session: SessionContext = { getUsername: () => username };
    const accounts = new AccountService({ db: driver, session });

    expect(
      await accounts.insertAccount({
        name: 'Customer A',
        headName: 'Current Asset',
        code: 101,
        address: null,
        phone1: null,
        phone2: null,
        goodsName: null,
        discountProfileId: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ).toBe(true);

    const all = await accounts.getAccounts();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Customer A');
    expect(all[0].headName).toBe('Current Asset');

    db.close();
  });
});
