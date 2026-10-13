import { SyncEngine } from '../SyncEngine';
import {
  REPULL_CURSOR_KEY,
  REPULL_TABLES_KEY,
  scheduleTableRepull,
} from '../tableRepull';
import type { SyncTransport } from '../transport';
import {
  insertAccount,
  makeDevice,
  seedChart,
  type Device,
} from './convergenceScenarios';
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

const stateValue = async (device: Device, key: string) =>
  (
    await device.driver.get<{ value: string }>(
      `SELECT value FROM sync_state WHERE key = @key`,
      { key },
    )
  )?.value;

const count = async (device: Device, sql: string) =>
  (await device.driver.get<{ c: number }>(sql))?.c ?? 0;

/** drops B's local accounts the way the 044 incident did: rows B should hold but never applied */
const dropLocalAccounts = async (device: Device) => {
  await device.driver.transaction(async () => {
    await device.driver.run(
      `INSERT INTO sync_state (key, value) VALUES ('applying', '1')`,
    );
    await device.driver.run(`DELETE FROM account`);
    await device.driver.run(`DELETE FROM sync_state WHERE key = 'applying'`);
  });
};

/** A holds a chart and three accounts; B has fully synced them. */
const twoSyncedDevices = async () => {
  const server = new MockSyncServer();
  const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
  const b = await makeDevice('deviceB', server.createDeviceTransport('B'));
  await seedChart(a);
  await insertAccount(a, 'Cash', 'Current Asset');
  await insertAccount(a, 'Bank', 'Current Asset');
  await insertAccount(a, 'Loan', 'Current Liability');
  const accountRows = await count(
    a,
    `SELECT COUNT(*) AS c FROM sync_outbox WHERE tableName = 'account'`,
  );
  await a.engine.syncOnce();
  await b.engine.syncOnce();
  return { server, a, b, accountRows };
};

describe('scheduleTableRepull', () => {
  it('is a no-op on a device that has never synced', async () => {
    const device = await makeDevice(
      'fresh',
      new MockSyncServer().createDeviceTransport('fresh'),
    );

    expect(await scheduleTableRepull(device.driver, ['account'])).toBe(false);
    expect(await stateValue(device, REPULL_TABLES_KEY)).toBeUndefined();
  });

  it('rejects tables that are not replicated', async () => {
    const { b } = await twoSyncedDevices();

    await expect(scheduleTableRepull(b.driver, ['ledger'])).rejects.toThrow(
      /not replicated tables: ledger/,
    );
  });

  it('merges table lists and restarts from 0 when called twice', async () => {
    const { b } = await twoSyncedDevices();
    await scheduleTableRepull(b.driver, ['account']);
    await b.driver.run(`UPDATE sync_state SET value = '7' WHERE key = @key`, {
      key: REPULL_CURSOR_KEY,
    });

    await scheduleTableRepull(b.driver, ['chart', 'account']);

    expect(await stateValue(b, REPULL_TABLES_KEY)).toBe(
      JSON.stringify(['account', 'chart']),
    );
    expect(await stateValue(b, REPULL_CURSOR_KEY)).toBe('0');
  });
});

describe('scheduled table re-pull in syncOnce', () => {
  it('restores dropped rows by fetching only the scheduled table, leaving the main cursor alone', async () => {
    const { server, b, accountRows } = await twoSyncedDevices();
    await dropLocalAccounts(b);
    const mainCursor = await stateValue(b, 'cursor');
    const servedBefore = server.servedRowCount('B');

    expect(await scheduleTableRepull(b.driver, ['account'])).toBe(true);
    const report = await b.engine.syncOnce();

    expect(await count(b, `SELECT COUNT(*) AS c FROM account`)).toBe(
      accountRows,
    );
    // only account rows crossed the wire, not the chart/user rows
    expect(server.servedRowCount('B') - servedBefore).toBe(accountRows);
    expect(report.applied).toBe(accountRows);
    expect(await stateValue(b, 'cursor')).toBe(mainCursor);
    expect(await stateValue(b, REPULL_TABLES_KEY)).toBeUndefined();
    expect(await stateValue(b, REPULL_CURSOR_KEY)).toBeUndefined();

    // nothing left to do: the next cycle transfers nothing
    const servedAfter = server.servedRowCount('B');
    await b.engine.syncOnce();
    expect(server.servedRowCount('B')).toBe(servedAfter);
  });

  it('resumes from its own cursor after a pull fails part-way', async () => {
    const { server, b, accountRows } = await twoSyncedDevices();
    await dropLocalAccounts(b);
    await scheduleTableRepull(b.driver, ['account']);

    const inner = server.createDeviceTransport('B');
    let pulls = 0;
    const flaky: SyncTransport = {
      push: (batch) => inner.push(batch),
      currentSeq: () => inner.currentSeq(),
      pull: async (afterSeq, limit, opts) => {
        pulls += 1;
        if (pulls === 2) throw new TypeError('Load failed');
        return inner.pull(afterSeq, limit, opts);
      },
    };
    const engine = new SyncEngine({
      db: b.driver,
      transport: flaky,
      pullPageSize: 1,
    });
    const servedBefore = server.servedRowCount('B');

    await expect(engine.syncOnce()).rejects.toThrow('Load failed');
    expect(await count(b, `SELECT COUNT(*) AS c FROM account`)).toBe(1);
    expect(Number(await stateValue(b, REPULL_CURSOR_KEY))).toBeGreaterThan(0);

    await engine.syncOnce();

    expect(await count(b, `SELECT COUNT(*) AS c FROM account`)).toBe(
      accountRows,
    );
    // the page applied before the failure is not downloaded twice
    expect(server.servedRowCount('B') - servedBefore).toBe(accountRows);
    expect(await stateValue(b, REPULL_TABLES_KEY)).toBeUndefined();
  });
});
