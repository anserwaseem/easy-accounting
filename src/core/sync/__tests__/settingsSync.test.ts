/**
 * Cross-device convergence tests for the `settings` table (migration 033 —
 * src/core/db/migrations/033_sync_settings.ts) — the per-key
 * last-writer-wins pre-step `SyncEngine.applyRow` implements for
 * `NATURAL_KEY_TABLES` (see that method's doc comment). Follows the same
 * two-simulated-devices-sharing-one-`MockSyncServer` pattern as
 * `SyncEngine.test.ts`, but exercises `SettingsService`/raw `settings`
 * writes directly rather than the accounting services — `settings` is not
 * one of `FACT_TABLES` (./convergenceScenarios.ts), so it isn't covered by
 * that file's shared scenarios.
 *
 * Scenarios that need a specific, unambiguous write-time ordering between
 * the two devices write directly into `settings` with an explicit
 * `updatedAt` (rather than going through `SettingsService.set`, which
 * always stamps "now") — this is the row shape `SettingsService.set` itself
 * produces, just with a controlled timestamp so the test proves the
 * resolution is genuinely last-writer-wins rather than merely "the two
 * devices happen to agree by luck". Migration 029's INSERT-capture trigger
 * fires on any INSERT regardless of caller (application code or a test's
 * raw SQL), so this is a faithful exercise of the real capture path.
 */
import { SettingsService } from '../../services/SettingsService';
import { MockSyncServer } from './mockServer';
import { makeDevice } from './convergenceScenarios';

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

async function conflictCount(driver: {
  get: (sql: string) => Promise<unknown>;
}): Promise<number> {
  const row = (await driver.get(
    `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
  )) as { c: number };
  return row.c;
}

describe('settings sync convergence', () => {
  it('device A sets a setting, syncs, and device B receives it', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    const settingsA = new SettingsService({ db: a.driver });
    const settingsB = new SettingsService({ db: b.driver });

    await settingsA.set('companyProfile.name', 'Acme Traders');

    await a.engine.syncOnce();
    await b.engine.syncOnce();

    expect(await settingsB.get<string>('companyProfile.name')).toBe(
      'Acme Traders',
    );
    expect(await conflictCount(a.driver)).toBe(0);
    expect(await conflictCount(b.driver)).toBe(0);

    a.db.close();
    b.db.close();
  });

  it('A and B independently set the SAME key to different values before ever syncing — both converge to the later write, with zero sync_apply_conflicts rows', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    const settingsA = new SettingsService({ db: a.driver });
    const settingsB = new SettingsService({ db: b.driver });

    // Both devices set the same key before either has ever synced — B's
    // write is deliberately the later one (explicit `updatedAt`s, not
    // reliance on real wall-clock timing within the test).
    await a.driver.run(
      `INSERT INTO settings (key, value, updatedAt) VALUES ('companyProfile.name', @value, @updatedAt)`,
      {
        value: JSON.stringify('From A'),
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    );
    await b.driver.run(
      `INSERT INTO settings (key, value, updatedAt) VALUES ('companyProfile.name', @value, @updatedAt)`,
      {
        value: JSON.stringify('From B'),
        updatedAt: '2026-01-01T00:00:01.000Z',
      },
    );

    // Interleave exactly the way that (before this fix) produced a
    // permanent split-brain — see SyncEngine.applyRow's doc comment for the
    // full trace this reproduces and resolves: A syncs first (push, then an
    // empty pull), then B syncs (push, then pulls A's now-older row), then
    // A syncs again (pulls B's now-later row).
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    await a.engine.syncOnce();
    // One more round each so a real deployment's "keep syncing" behavior is
    // exercised too — must be a no-op given the log has nothing left.
    await b.engine.syncOnce();

    const finalA = await settingsA.get<string>('companyProfile.name');
    const finalB = await settingsB.get<string>('companyProfile.name');

    expect(finalA).toBe('From B'); // the later write (2026-01-01T00:00:01.000Z)
    expect(finalB).toBe('From B');
    expect(finalA).toBe(finalB);

    // Exactly one row per device — the natural-key UNIQUE(key) constraint
    // was never violated, and nothing was quarantined.
    const rowCountA = await a.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM settings WHERE key = 'companyProfile.name'`,
    );
    const rowCountB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM settings WHERE key = 'companyProfile.name'`,
    );
    expect(rowCountA!.c).toBe(1);
    expect(rowCountB!.c).toBe(1);

    expect(await conflictCount(a.driver)).toBe(0);
    expect(await conflictCount(b.driver)).toBe(0);

    a.db.close();
    b.db.close();
  });

  it('an older incoming row never clobbers a newer local one, even on a single one-way sync', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    const settingsB = new SettingsService({ db: b.driver });

    await a.driver.run(
      `INSERT INTO settings (key, value, updatedAt) VALUES ('invoicePrint.paperSize', @value, @updatedAt)`,
      { value: JSON.stringify('A4'), updatedAt: '2020-01-01T00:00:00.000Z' },
    );
    await b.driver.run(
      `INSERT INTO settings (key, value, updatedAt) VALUES ('invoicePrint.paperSize', @value, @updatedAt)`,
      {
        value: JSON.stringify('Letter'),
        updatedAt: '2030-01-01T00:00:00.000Z',
      },
    );

    await a.engine.syncOnce(); // pushes A's (older) row
    await b.engine.syncOnce(); // pushes B's (newer) row, then pulls A's older row

    // B's own, newer local value must survive the incoming older row.
    expect(await settingsB.get<string>('invoicePrint.paperSize')).toBe(
      'Letter',
    );
    expect(await conflictCount(b.driver)).toBe(0);

    a.db.close();
    b.db.close();
  });
});
