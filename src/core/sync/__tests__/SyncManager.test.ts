import { SyncManager, type SyncKv } from '../SyncManager';
import type { DatabaseDriver } from '../../db/driver';

describe('SyncManager', () => {
  const createMockKv = (): SyncKv & { store: Map<string, unknown> } => {
    const store = new Map<string, unknown>();
    return {
      store,
      get: (key: string) => store.get(key),
      setAwaited: async (key: string, value: unknown) => {
        store.set(key, value);
      },
      deleteAwaited: async (key: string) => {
        store.delete(key);
      },
    };
  };

  const createMockDriver = (): DatabaseDriver => {
    return {
      exec: async () => {},
      run: async () => ({ changes: 0, lastInsertRowid: 0 }),
      get: async () => undefined,
      all: async () => [],
      transaction: async <T>(fn: () => Promise<T>) => fn(),
    };
  };

  it('generates a valid UUID for deviceId and reuses it on subsequent calls', async () => {
    const kv = createMockKv();
    const manager = new SyncManager({
      db: createMockDriver(),
      kv,
      notify: () => {},
    });

    // calling connect with mock: true exercises ensureDeviceId
    const connectPromise = manager.connect({
      url: 'http://localhost:54321',
      anonKey: 'dummy-anon-key',
      mock: true,
    });
    const result = await connectPromise;
    expect(result.ok).toBe(true);

    const storedDeviceId = kv.get('sync.deviceId');
    expect(typeof storedDeviceId).toBe('string');
    // should match RFC4122 v4 UUID format
    expect(storedDeviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const status = await manager.getStatus();
    expect(status.connected).toBe(true);

    // calling connect again reuses the existing deviceId from kv
    await manager.disconnect();
    const reconnectResult = await manager.connect({
      url: 'http://localhost:54321',
      anonKey: 'dummy-anon-key',
      mock: true,
    });
    expect(reconnectResult.ok).toBe(true);
    expect(kv.get('sync.deviceId')).toBe(storedDeviceId);

    await manager.disconnect();
  });

  it('generates deviceId cleanly even when globalThis.crypto is undefined', async () => {
    const kv = createMockKv();
    const manager = new SyncManager({
      db: createMockDriver(),
      kv,
      notify: () => {},
    });

    // temporarily remove globalThis.crypto to simulate environment where WebCrypto is not present
    const originalCrypto = globalThis.crypto;
    try {
      delete (globalThis as { crypto?: unknown }).crypto;

      const result = await manager.connect({
        url: 'http://localhost:54321',
        anonKey: 'dummy-anon-key',
        mock: true,
      });
      expect(result.ok).toBe(true);

      const storedDeviceId = kv.get('sync.deviceId');
      expect(typeof storedDeviceId).toBe('string');
      expect(storedDeviceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    } finally {
      if (typeof originalCrypto !== 'undefined') {
        Object.defineProperty(globalThis, 'crypto', {
          value: originalCrypto,
          configurable: true,
          writable: true,
        });
      }
    }

    await manager.disconnect();
  });
});
