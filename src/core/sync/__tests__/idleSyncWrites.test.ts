import Database from 'better-sqlite3';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { bootstrapDatabase } from '../../db/bootstrap';
import { SyncEngine } from '../SyncEngine';
import { SyncManager, type SyncKv } from '../SyncManager';
import { MockSyncServer } from './mockServer';

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

describe('SyncEngine idle cycle', () => {
  it('makes no writes when there is nothing to push, pull, prune or repair', async () => {
    const driver = new BetterSqliteDriver(new Database(':memory:'));
    await bootstrapDatabase(driver);
    const server = new MockSyncServer();
    // a non-empty server log keeps the empty-server reseed branch out of play
    await server.createDeviceTransport('peer').push([
      {
        idempotencyKey: 'peer:settings',
        tableName: 'settings',
        rowUuid: 'b0000000-0000-4000-8000-000000000001',
        op: 'put',
        rowJson: JSON.stringify({
          key: 'peer',
          value: '1',
          uuid: 'b0000000-0000-4000-8000-000000000001',
        }),
      },
    ]);
    const engine = new SyncEngine({
      db: driver,
      transport: server.createDeviceTransport('self'),
    });
    await engine.syncOnce();

    let mutations = 0;
    driver.setMutationListener(() => {
      mutations += 1;
    });
    await engine.syncOnce();

    expect(mutations).toBe(0);
  });
});

/**
 * any write the engine makes (applying pulled rows, sync_state, repairs)
 * fires the driver's mutation listener exactly like a user write, so a
 * debounce that reacts to every mutation re-triggers sync ~3s after each
 * cycle forever — ~10x the steady 30s poll in Supabase requests.
 */
describe('SyncManager write-triggered sync', () => {
  const createKv = (): SyncKv => {
    const store = new Map<string, unknown>();
    return {
      get: (key) => store.get(key),
      setAwaited: async (key, value) => {
        store.set(key, value);
      },
      deleteAwaited: async (key) => {
        store.delete(key);
      },
    };
  };

  const setup = async () => {
    const driver = new BetterSqliteDriver(new Database(':memory:'));
    await bootstrapDatabase(driver);
    const manager = new SyncManager({
      db: driver,
      kv: createKv(),
      notify: () => {},
    });
    driver.setMutationListener(() => manager.scheduleDebouncedSync());
    const syncOnce = jest.spyOn(SyncEngine.prototype, 'syncOnce');
    return { driver, manager, syncOnce };
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('does not re-trigger itself from its own bookkeeping writes when idle', async () => {
    const { manager, syncOnce } = await setup();
    await manager.connect({ url: '', anonKey: '', mock: true });

    await jest.advanceTimersByTimeAsync(65_000);

    // connect + the 30s and 60s ticks
    expect(syncOnce).toHaveBeenCalledTimes(3);
    await manager.disconnect();
  });

  it('still syncs shortly after a local write that queued outbox rows', async () => {
    const { driver, manager, syncOnce } = await setup();
    await manager.connect({ url: '', anonKey: '', mock: true });
    await jest.advanceTimersByTimeAsync(1_000);
    syncOnce.mockClear();

    await driver.run(
      `INSERT INTO settings (key, value) VALUES ('idle-test', '1')`,
    );
    expect((await manager.getStatus()).pendingOutboxCount).toBeGreaterThan(0);

    await jest.advanceTimersByTimeAsync(5_000);

    expect(syncOnce).toHaveBeenCalledTimes(1);
    expect((await manager.getStatus()).pendingOutboxCount).toBe(0);
    await manager.disconnect();
  });
});
