import Database from 'better-sqlite3';
import { SettingsService } from '../SettingsService';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../db/bootstrap';
import { SECRET_SETTING_KEYS } from '../settingsSecrets';

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
 * In-memory driver pattern: a real better-sqlite3 `:memory:` database behind
 * the platform-free `BetterSqliteDriver`, brought up through the same
 * `bootstrapDatabase` every platform uses — so the `settings` table these
 * tests exercise exists exactly the way it does in production (migration
 * 028, src/core/db/migrations/index.ts), not a hand-rolled substitute.
 */
async function makeService(): Promise<{
  service: SettingsService;
  db: Database.Database;
}> {
  const db = new Database(':memory:');
  const driver = new BetterSqliteDriver(db);
  await bootstrapDatabase(driver);
  return { service: new SettingsService({ db: driver }), db };
}

describe('SettingsService', () => {
  it('returns undefined for a key that was never set', async () => {
    const { service, db } = await makeService();
    expect(await service.get('nope')).toBeUndefined();
    db.close();
  });

  it('round-trips a string value', async () => {
    const { service, db } = await makeService();
    await service.set('companyProfile.name', 'ABC Traders');
    expect(await service.get<string>('companyProfile.name')).toBe(
      'ABC Traders',
    );
    db.close();
  });

  it('round-trips a boolean value', async () => {
    const { service, db } = await makeService();
    await service.set('publish.publishWithoutImages', true);
    expect(await service.get<boolean>('publish.publishWithoutImages')).toBe(
      true,
    );
    db.close();
  });

  it('round-trips an object value', async () => {
    const { service, db } = await makeService();
    const value = { a: 1, b: ['x', 'y'], c: null };
    await service.set('some.object', value);
    expect(await service.get('some.object')).toEqual(value);
    db.close();
  });

  it('overwrites an existing key on a second set (upsert)', async () => {
    const { service, db } = await makeService();
    await service.set('key', 'first');
    await service.set('key', 'second');
    expect(await service.get<string>('key')).toBe('second');
    const rowCount = db
      .prepare(`SELECT COUNT(*) AS c FROM settings WHERE key = 'key'`)
      .get() as { c: number };
    expect(rowCount.c).toBe(1);
    db.close();
  });

  it('stamps updatedAt on write', async () => {
    const { service, db } = await makeService();
    await service.set('key', 'value');
    const row = db
      .prepare(`SELECT updatedAt FROM settings WHERE key = 'key'`)
      .get() as { updatedAt: string | null };
    expect(row.updatedAt).toEqual(expect.any(String));
    expect(row.updatedAt).not.toBeNull();
    db.close();
  });

  it('delete removes the key; a subsequent get is undefined', async () => {
    const { service, db } = await makeService();
    await service.set('key', 'value');
    await service.delete('key');
    expect(await service.get('key')).toBeUndefined();
    db.close();
  });

  it('delete on a never-set key is a harmless no-op', async () => {
    const { service, db } = await makeService();
    await expect(service.delete('nope')).resolves.toBeUndefined();
    db.close();
  });

  it('getAll returns every stored setting, parsed, keyed by name', async () => {
    const { service, db } = await makeService();
    await service.set('a', '1');
    await service.set('b', 2);
    await service.set('c', { nested: true });
    expect(await service.getAll()).toEqual({
      a: '1',
      b: 2,
      c: { nested: true },
    });
    db.close();
  });

  it('getAll returns an empty object when nothing is stored', async () => {
    const { service, db } = await makeService();
    expect(await service.getAll()).toEqual({});
    db.close();
  });

  it('refuses to write a secret setting key — the settings table syncs, so secrets can never live here', async () => {
    expect(SECRET_SETTING_KEYS.length).toBeGreaterThan(0);
    const { service, db } = await makeService();
    for (const key of SECRET_SETTING_KEYS) {
      // eslint-disable-next-line no-await-in-loop
      await expect(service.set(key, 'super-secret-value')).rejects.toThrow(
        /secret/i,
      );
    }
    const rowCount = db.prepare(`SELECT COUNT(*) AS c FROM settings`).get() as {
      c: number;
    };
    expect(rowCount.c).toBe(0);
    db.close();
  });

  it('an ordinary (non-secret) key round-trips normally, unaffected by the secret-key guard', async () => {
    const { service, db } = await makeService();
    await service.set('companyProfile.name', 'ABC Traders');
    expect(await service.get<string>('companyProfile.name')).toBe(
      'ABC Traders',
    );
    db.close();
  });

  it('tolerates a hand-written non-JSON value already in the table', async () => {
    const { service, db } = await makeService();
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('legacy', 'not-json')`,
    ).run();
    expect(await service.get<string>('legacy')).toBe('not-json');
    db.close();
  });
});
