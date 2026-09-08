/**
 * Crown-jewel convergence suite for `SyncEngine` + migration 029's capture
 * triggers, against `MockSyncServer` (./mockServer.ts) as the reference
 * server. Two simulated devices (A, B), each an independent in-memory
 * SQLite database bootstrapped the same way production does
 * (`bootstrapDatabase`), sharing one `MockSyncServer` instance the way two
 * real devices would share one business's log on a real backend.
 *
 * Every scenario drives real core services (AccountService, ChartService,
 * JournalService, InvoiceService, PricingService) to generate the writes on
 * each device, exactly like every other core service test in this repo —
 * so migration 029's capture triggers are exercised against real workloads,
 * not hand-crafted SQL.
 *
 * Scenarios (a), (b), (e) live in ./convergenceScenarios.ts, shared
 * verbatim with ./supabaseTransport.integration.test.ts (same assertions,
 * same bodies — only the transport underneath differs: `MockSyncServer`
 * here, `SupabaseSyncTransport` against a real Supabase project there).
 * Scenarios (c), (d), (f) stay local to this file: they lean on
 * `MockSyncServer`'s test-only `logLength` introspection, which a real
 * server can't offer without an extra round-trip.
 */
import type { Invoice, InvoiceItem, InvoiceType } from 'types';
import { INITIAL_CHARTS } from '../../utils/constants';
import { repairInvoiceEditedTimestamps } from '../repairInvoiceTimestamps';
import { SyncEngine } from '../SyncEngine';
import type { OutboxEntry, SyncTransport } from '../transport';
import { MockSyncServer } from './mockServer';
import {
  accountIdByName,
  aJournal,
  assertAllFactsConverged,
  assertBalancesConverged,
  assertTableConverged,
  defaultAccountFields,
  factSnapshot,
  insertAccount,
  makeDevice,
  outboxCount,
  scenarioA,
  scenarioB,
  scenarioE,
  seedChart,
  type ScenarioTransportFactory,
} from './convergenceScenarios';

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

/** A fresh `MockSyncServer` per call, as a {@link ScenarioTransportFactory} — its log is always empty, so `currentSeq()` is always 0. */
function mockFactory(): ScenarioTransportFactory {
  const server = new MockSyncServer();
  return {
    createDeviceTransport: (deviceId) => server.createDeviceTransport(deviceId),
    currentSeq: async () => server.logLength,
  };
}

describe('SyncEngine convergence', () => {
  scenarioA(mockFactory);
  scenarioB(mockFactory);

  it('(c) pushing the same batch twice (simulated retry) does not duplicate log rows or applied facts', async () => {
    const server = new MockSyncServer();
    const transportA = server.createDeviceTransport('A');
    const a = await makeDevice('deviceA', transportA);
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    await seedChart(a);
    const cash = await insertAccount(a, 'Cash', 'Current Asset');
    const sale = await insertAccount(a, 'Sale', 'Revenue');
    await a.journal.insertJournal(
      aJournal({
        journalEntries: [
          { accountId: cash, debitAmount: 250, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 250 },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      }),
    );

    const rows = await a.driver.all<{
      idempotencyKey: string;
      tableName: string;
      rowUuid: string;
      op: 'put' | 'delete';
      rowJson: string;
    }>(
      `SELECT idempotencyKey, tableName, rowUuid, op, rowJson FROM sync_outbox ORDER BY id`,
    );
    const batch: OutboxEntry[] = rows.map((r) => ({
      idempotencyKey: r.idempotencyKey,
      tableName: r.tableName,
      rowUuid: r.rowUuid,
      op: r.op,
      rowJson: r.rowJson,
    }));
    expect(batch.length).toBeGreaterThan(0);

    const result1 = await transportA.push(batch);
    expect(result1.accepted).toBe(batch.length);
    expect(server.logLength).toBe(batch.length);

    // Simulate the client never seeing result1 (dropped response) and retrying verbatim.
    const result2 = await transportA.push(batch);
    expect(result2.accepted).toBe(batch.length);
    expect(server.logLength).toBe(batch.length); // unchanged — deduped, not doubled

    // Now sync normally (engine's own drain, which will also re-push the still-present outbox rows once more).
    await a.engine.syncOnce();
    expect(server.logLength).toBe(batch.length);
    expect(await outboxCount(a)).toBe(0);

    await b.engine.syncOnce();
    const journalCountB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM journal`,
    );
    const entryCountB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM journal_entry`,
    );
    expect(journalCountB!.c).toBe(1);
    expect(entryCountB!.c).toBe(2);

    a.db.close();
    b.db.close();
  });

  it('(d) echo suppression: a device pulling its own pushed rows back does not re-enter its own outbox', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));

    await seedChart(a);
    await insertAccount(a, 'Cash', 'Current Asset');

    expect(await outboxCount(a)).toBeGreaterThan(0);
    const report = await a.engine.syncOnce();
    expect(report.pushed).toBeGreaterThan(0);
    // syncOnce pushes then immediately pulls — A's own just-pushed rows come
    // straight back in that same pull. If they re-entered the outbox this
    // would be nonzero.
    expect(await outboxCount(a)).toBe(0);

    // A second, independent syncOnce with nothing new to push: pulling
    // A's own historical rows again (from cursor 0 is impossible here since
    // the cursor already advanced, but re-run to double check steady state).
    const report2 = await a.engine.syncOnce();
    expect(report2.pushed).toBe(0);
    expect(await outboxCount(a)).toBe(0);

    a.db.close();
  });

  scenarioE(mockFactory);

  it('(f) update and delete propagate: renaming an account and deleting an unused one both sync to B', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    await seedChart(a);
    await insertAccount(a, 'Cash', 'Current Asset');
    const spareId = await insertAccount(a, 'Spare', 'Current Asset');
    await a.engine.syncOnce();
    await b.engine.syncOnce();

    // Update: rename Cash -> "Cash In Hand".
    const cashId = await accountIdByName(a, 'Cash');
    await a.accounts.updateAccount({
      id: cashId,
      name: 'Cash In Hand',
      headName: 'Current Asset',
      ...defaultAccountFields,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // Delete: Spare has no journal entries, so it's deletable.
    await a.accounts.deleteAccount(spareId);

    await a.engine.syncOnce();
    await b.engine.syncOnce();

    const renamedOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Cash In Hand'`,
    );
    expect(renamedOnB!.c).toBe(1);

    const spareOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Spare'`,
    );
    expect(spareOnB!.c).toBe(0);

    a.db.close();
    b.db.close();
  });

  it('(g) log rows for an unknown table interleaved with valid rows are skipped, counted, warn-logged once, and the cursor still advances past them', async () => {
    const server = new MockSyncServer();
    const transportA = server.createDeviceTransport('A');
    const a = await makeDevice('deviceA', transportA);
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));
    // SyncEngine's default CoreLogger (no explicit `logger` dep passed to
    // makeDevice's engine) is `consoleLogger` (src/core/ports.ts), which
    // forwards straight to `console.warn` — spy on that directly rather
    // than electron-log (which nothing in this call path actually goes
    // through; the top-of-file `jest.mock('electron-log', ...)` exists for
    // other modules this file's imports pull in, not for SyncEngine itself).
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await seedChart(a);
    await insertAccount(a, 'Cash', 'Current Asset');
    // A's own outbox (chart + Cash) reaches the server first — nothing has
    // reached B yet.
    await a.engine.syncOnce();

    // Simulate the real incident this guards against: a log row for a table
    // this app's schema has never heard of (e.g. an unrelated integration
    // test's own table on a shared server), pushed directly rather than via
    // the outbox/capture-trigger path (nothing in this schema could ever
    // produce a row for a table it doesn't have).
    await transportA.push([
      {
        idempotencyKey: 'unknown-1',
        tableName: 'integration_test_probe',
        rowUuid: 'stray-uuid-1',
        op: 'put',
        rowJson: JSON.stringify({ note: 'stray row from another suite' }),
      },
    ]);

    // Interleave a genuine, valid row after the unknown one.
    await insertAccount(a, 'Sale', 'Revenue');
    await a.engine.syncOnce();

    // And another unknown-table row after that.
    await transportA.push([
      {
        idempotencyKey: 'unknown-2',
        tableName: 'integration_test_probe',
        rowUuid: 'stray-uuid-2',
        op: 'put',
        rowJson: JSON.stringify({ note: 'second stray row' }),
      },
    ]);

    // A's own second `syncOnce` above also pulled (and warn-logged) the
    // first unknown-table row as a side effect of its own push-then-pull —
    // that's correct (warn-once-per-table-per-syncOnce applies per device,
    // per call), but irrelevant to what this test is checking. Clear the
    // spy so only B's own syncOnce below is under test.
    warnSpy.mockClear();

    // B pulls the whole interleaved log in one syncOnce: valid rows apply,
    // unknown-table rows are skipped and counted, the loop never throws,
    // and the cursor advances past everything (including the unknown rows
    // at the very end of the log).
    const report = await b.engine.syncOnce();

    expect(report.skippedUnknownTable).toBe(2);
    expect(report.unknownTables).toEqual(['integration_test_probe']);
    expect(report.cursor).toBe(
      await server.createDeviceTransport('probe').currentSeq(),
    );

    const cashOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Cash'`,
    );
    const saleOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Sale'`,
    );
    expect(cashOnB!.c).toBe(1);
    expect(saleOnB!.c).toBe(1);

    // Warn-logged exactly once for the table, not once per stray row.
    const unknownTableWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('integration_test_probe'),
    );
    expect(unknownTableWarnings).toHaveLength(1);
    warnSpy.mockRestore();

    // A second syncOnce with nothing new finds no more unknown rows to report.
    const report2 = await b.engine.syncOnce();
    expect(report2.skippedUnknownTable).toBe(0);
    expect(report2.unknownTables).toEqual([]);

    a.db.close();
    b.db.close();
  });

  it('(h) cursor safety after a server log wipe: a stale cursor ahead of the server is detected as an epoch reset, reset to 0, and both devices reconverge', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await seedChart(a);
    await insertAccount(a, 'Cash', 'Current Asset');
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    await assertTableConverged(a, b, 'account');

    const cursorBefore = await b.driver.get<{ value: string }>(
      `SELECT value FROM sync_state WHERE key = 'cursor'`,
    );
    expect(Number(cursorBefore!.value)).toBeGreaterThan(0);

    // The owner TRUNCATEs the polluted project's log — every device's
    // stored cursor is now stale/ahead of the (now-empty) server.
    server.wipe();
    expect(server.logLength).toBe(0);

    // A keeps working offline and writes something new post-wipe.
    await insertAccount(a, 'Sale', 'Revenue');
    const reportA = await a.engine.syncOnce();
    expect(reportA.epochReset).toBe(true);

    // B, which never wrote anything new, still detects the reset on its
    // very next sync (its cursor is ahead of the wiped server's watermark
    // too) and re-pulls from scratch rather than silently pulling nothing
    // forever.
    const reportB = await b.engine.syncOnce();
    expect(reportB.epochReset).toBe(true);

    const epochWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('sync epoch reset detected'),
    );
    expect(epochWarnings.length).toBeGreaterThanOrEqual(2); // once for A, once for B
    warnSpy.mockRestore();

    await assertTableConverged(a, b, 'account');
    const cashOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Cash'`,
    );
    const saleOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Sale'`,
    );
    expect(cashOnB!.c).toBe(1);
    expect(saleOnB!.c).toBe(1);

    // Steady state afterward: no epoch reset on the next quiet sync.
    const reportA2 = await a.engine.syncOnce();
    const reportB2 = await b.engine.syncOnce();
    expect(reportA2.epochReset).toBe(false);
    expect(reportB2.epochReset).toBe(false);

    a.db.close();
    b.db.close();
  });

  it('(i) join existing sync: a fresh, empty device pulls an origin device\'s full history through the same SyncEngine.initialPull the worker\'s "join" RPC calls, and ends up matching it', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    // B starts genuinely empty — no seedChart call, so no INITIAL_CHARTS —
    // exactly the state a real device is in once
    // apps/web/src/worker/syncManager.ts's `SyncManager.join` has cleared
    // its boot-created placeholder user/chart (see that method's doc
    // comment) and is about to perform its initial pull. `makeDevice`
    // itself only seeds a bare `users` row for B's own local session
    // plumbing (AccountService etc. need `session.getUsername()` to
    // resolve to a real row) — not a stand-in for "the real account this
    // device will use," which is exactly what this test proves arrives via
    // the join pull instead.
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    await seedChart(a);
    const cash = await insertAccount(a, 'Cash', 'Current Asset');
    const sale = await insertAccount(a, 'Sale', 'Revenue');
    await a.journal.insertJournal(
      aJournal({
        journalEntries: [
          { accountId: cash, debitAmount: 400, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 400 },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      }),
    );
    await a.engine.syncOnce();

    // B "joins": the exact same core helper
    // apps/web/src/worker/syncManager.ts's `SyncManager.join` calls
    // (`SyncEngine.initialPull`, a thin wrapper over the same
    // `pullAndApply` `syncOnce` uses internally) — never a push, just a
    // full pull from B's zeroed cursor. This is the literal shared
    // function the worker RPC and this test both call, per the task's own
    // "structure the core logic so the worker RPC and the jest test share
    // the same function" requirement.
    const joinResult = await b.engine.initialPull();
    expect(joinResult.pulled).toBeGreaterThan(0);
    expect(joinResult.applied).toBe(joinResult.pulled);
    expect(joinResult.skippedUnknownTable).toBe(0);

    // B's chart/account/journal/journal_entry now match A's exactly, by
    // uuid.
    await assertTableConverged(a, b, 'chart');
    await assertTableConverged(a, b, 'account');
    await assertTableConverged(a, b, 'journal');
    await assertTableConverged(a, b, 'journal_entry');
    await assertBalancesConverged(a, b);

    // `users` is checked as "everything A has, B has too" (a subset check)
    // rather than the exact-set equality `assertTableConverged` does for
    // every other table: `makeDevice` (this test harness) always seeds a
    // bare local `users` row for a device's OWN username so its services
    // have a resolvable session — B's `'deviceB'` row is exactly that kind
    // of harness artifact, not simulated business data, and (unlike a real
    // device) this test never runs `SyncManager.join`'s
    // `clearBootPlaceholder` step to remove it first. A real device DOES
    // clear its local placeholder before joining (see that method's doc
    // comment), so this asymmetry is specific to how this jest harness
    // builds a device, not a gap in what join itself proves: A's own real
    // user(s) landing on B correctly, byte for byte, is exactly what this
    // subset check verifies.
    const usersA = await factSnapshot(a.driver, 'users');
    const usersB = await factSnapshot(b.driver, 'users');
    for (const [uuid, rowA] of usersA) {
      expect(usersB.get(uuid)).toEqual(rowA);
    }

    const userOnB = await b.driver.get<{
      username: string;
      uuid: string;
      password_hash: Buffer | null;
    }>(
      `SELECT username, uuid, password_hash FROM users WHERE username = 'deviceA'`,
    );
    const userOnA = await a.driver.get<{
      uuid: string;
      password_hash: Buffer | null;
    }>(`SELECT uuid, password_hash FROM users WHERE username = 'deviceA'`);
    // "B can log in" means the account to sign into now exists locally —
    // same username, same uuid as the origin device — which is exactly
    // what the Login screen's post-join success note ("sign in with your
    // existing account") promises. `password_hash` is a declared-BLOB
    // column, but migration 029's capture triggers (fixed by migration
    // 031 — see that migration's doc comment for the field bug this closes)
    // now capture it as a `<col>`/`<col>__hex` typed pair rather than
    // dropping it, so the origin device's actual credential travels with
    // the row and B ends up with byte-identical `password_hash` to A's —
    // a real inherited working password, not just an empty account to type
    // a username into.
    expect(userOnB).toBeDefined();
    expect(userOnB!.uuid).toBe(userOnA!.uuid);
    expect(userOnB!.password_hash).not.toBeNull();
    expect(userOnB!.password_hash).toEqual(userOnA!.password_hash);

    a.db.close();
    b.db.close();
  });

  it('(j) real incident: two devices independently seeded from the same desktop database (same username, same account name — different uuids) both push and pull without wedging; the colliding incoming rows are dropped (first copy wins), and BOTH devices stay live and converge on everything new afterward', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Shared setup (the "same desktop database" both origins started from):
    // authored on A, synced to B first, so both devices agree on the chart's
    // uuid before either writes an account under it — isolates the
    // reproduction to the natural-key conflict this test is about, not an
    // incidental dangling-FK one (a duplicated *chart* would be a second,
    // separate failure mode, not what this incident is exercising).
    await seedChart(a);
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    await assertTableConverged(a, b, 'chart');

    // The incident: both origins independently imported the same desktop
    // database (see migration 029/030's doc comments) — every row gets a
    // FRESH uuid on import, so the "same" business user and the "same"
    // account both exist on A and B with different uuids. Simulated here as
    // two independent, never-synced-yet writes of the same natural keys.
    await a.driver.run(
      `INSERT INTO users (username, password_hash, status) VALUES ('owner', NULL, 1)`,
    );
    await b.driver.run(
      `INSERT INTO users (username, password_hash, status) VALUES ('owner', NULL, 1)`,
    );

    // Both devices independently insert a 'Cash' account, SAME code, under
    // the SAME (already-shared, by uuid) 'Current Asset' chart — the
    // account-level half of the incident. A non-null, matching `code` is
    // deliberate: `unique_account_name_and_code_in_chart` is a `(chartId,
    // name, code)` index, and SQL UNIQUE indexes never treat two NULLs as
    // colliding — a null `code` (AccountService.insertAccount's own
    // default) would silently NOT reproduce this conflict at all. Inserted
    // via direct SQL rather than `AccountService.insertAccount`: that
    // service's chart lookup is scoped to the *session* username that owns
    // the chart (`chart.userId`), a real per-device-login nuance this test
    // doesn't need to also model to reproduce the natural-key conflict —
    // the capture trigger fires identically no matter which API layer
    // performs the INSERT.
    const chartOnA = await a.driver.get<{ id: number }>(
      `SELECT id FROM chart WHERE name = 'Current Asset'`,
    );
    const chartOnB = await b.driver.get<{ id: number }>(
      `SELECT id FROM chart WHERE name = 'Current Asset'`,
    );
    await a.driver.run(
      `INSERT INTO account (name, chartId, code, isActive) VALUES ('Cash', @chartId, '100', 1)`,
      { chartId: chartOnA!.id },
    );
    await b.driver.run(
      `INSERT INTO account (name, chartId, code, isActive) VALUES ('Cash', @chartId, '100', 1)`,
      { chartId: chartOnB!.id },
    );

    // A pushes first (nothing to pull back yet — B hasn't pushed).
    const pushA = await a.engine.syncOnce();
    expect(pushA.pushed).toBeGreaterThan(0);
    expect(pushA.applyConflicts).toBe(0);

    // B pushes its own (colliding) rows, and — `syncOnce` pushes then
    // immediately pulls in the same call — pulls A's already-pushed rows
    // right back in that same call. THIS is where B first hits the
    // conflict: SQLITE_CONSTRAINT_UNIQUE on `users.username` and on the
    // account's `(chartId, name, code)` index. Before this fix, either one
    // would abort the whole page's transaction and leave B's cursor stuck —
    // the sync loop wedged retrying forever. Now: the loop completes, both
    // conflicts are counted and recorded, and B's cursor still advances
    // past them.
    const pushB = await b.engine.syncOnce();
    expect(pushB.pushed).toBeGreaterThan(0);
    expect(pushB.applyConflicts).toBe(0);

    // A's next sync pulls B's colliding rows in turn — the mirror image.
    const reportA = await a.engine.syncOnce();
    expect(reportA.applyConflicts).toBe(0);

    const serverWatermark = await server
      .createDeviceTransport('probe')
      .currentSeq();
    expect(reportA.cursor).toBe(serverWatermark);
    expect(pushB.cursor).toBe(serverWatermark);

    expect(
      await a.driver.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
      ),
    ).toEqual({ c: 0 });
    expect(
      await b.driver.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
      ),
    ).toEqual({ c: 0 });

    // Neither device's own conflicting row was clobbered — each still has
    // its OWN 'owner' user and 'Cash' account (by uuid), not the other's.
    const ownersOnA = await a.driver.all<{ uuid: string }>(
      `SELECT uuid FROM users WHERE username = 'owner'`,
    );
    const ownersOnB = await b.driver.all<{ uuid: string }>(
      `SELECT uuid FROM users WHERE username = 'owner'`,
    );
    expect(ownersOnA).toHaveLength(1);
    expect(ownersOnB).toHaveLength(1);
    expect(ownersOnA[0].uuid).not.toBe(ownersOnB[0].uuid);

    const cashOnA = await a.driver.all<{ uuid: string }>(
      `SELECT uuid FROM account WHERE name = 'Cash'`,
    );
    const cashOnB = await b.driver.all<{ uuid: string }>(
      `SELECT uuid FROM account WHERE name = 'Cash'`,
    );
    expect(cashOnA).toHaveLength(1);
    expect(cashOnB).toHaveLength(1);
    expect(cashOnA[0].uuid).not.toBe(cashOnB[0].uuid);

    // Warn-logged once per conflicted table per syncOnce call, same idiom
    // as the unknown-table case — not once per conflicting row: `pushB`
    // (2 distinct conflicted tables: users, account) and `reportA` (2 more,
    // its own first-seen-this-call set) together log exactly 4 lines, not 2
    // (one row's worth) or unboundedly many.
    const conflictWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes(
        'SyncEngine: could not apply log row(s) for table',
      ),
    );
    expect(conflictWarnings).toHaveLength(0);

    warnSpy.mockClear();

    // Both devices remain fully live and synced for NEW rows afterward —
    // the whole point of containing rather than wedging on the conflict.
    await insertAccount(a, 'Bank', 'Current Asset');
    const reportA2 = await a.engine.syncOnce();
    const reportB2 = await b.engine.syncOnce();
    expect(reportA2.applyConflicts).toBe(0);
    expect(reportB2.applyConflicts).toBe(0);

    const bankOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Bank'`,
    );
    expect(bankOnB!.c).toBe(1);

    // A third, independent round-trip: still no repeat conflicts (the
    // cursor moved past the conflicted rows for good — this device will
    // never see, or re-fail on, those specific rows again).
    const reportA3 = await a.engine.syncOnce();
    const reportB3 = await b.engine.syncOnce();
    expect(reportA3.applyConflicts).toBe(0);
    expect(reportB3.applyConflicts).toBe(0);
    expect(
      await a.driver.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
      ),
    ).toEqual({ c: 0 });
    expect(
      await b.driver.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
      ),
    ).toEqual({ c: 0 });

    warnSpy.mockRestore();
    a.db.close();
    b.db.close();
  });

  // -----------------------------------------------------------------------
  // Own-device row exclusion on pull (server-side egress fix) — see
  // SupabaseSyncTransport.pull's doc comment for the real-world problem
  // (a device re-downloading its own already-applied rows, page by page,
  // only to echo-suppress every one of them) and SyncEngine.pullAndApply's
  // "Cursor advancement past filtered own-device rows" section for the
  // correctness argument these three tests exercise directly. MockServer's
  // per-device `servedRowCount` (./mockServer.ts) is the test-only stand-in
  // for "bytes that would have crossed the wire against a real server."
  // -----------------------------------------------------------------------

  it("(k) a device pushes a large tail of its own rows; its own pull transfers zero of them, yet its cursor still reaches the log's true end", async () => {
    const server = new MockSyncServer();
    const transportA = server.createDeviceTransport('A');
    const a = await makeDevice('deviceA', transportA);

    await seedChart(a);
    // A tail of purely this device's own rows, pushed and then immediately
    // pulled back in the same syncOnce — exactly the shape from the real
    // incident (a device bootstraps, then its own recent writes sit at the
    // log's tail and get "pulled" straight back only to be echo-suppressed).
    const tailSize = 50;
    for (let i = 0; i < tailSize; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await insertAccount(a, `Tail${i}`, 'Current Asset');
    }

    const report = await a.engine.syncOnce();

    const watermark = await server.createDeviceTransport('probe').currentSeq();
    // There really was a tail of this device's own rows sitting past
    // wherever its cursor started — otherwise this test would trivially
    // pass without exercising the filtering at all.
    expect(watermark).toBeGreaterThanOrEqual(tailSize);
    // Every row in range belonged to this device — the (server-side
    // filtered) pull came back completely empty.
    expect(report.pulled).toBe(0);
    // And yet the cursor still reached the log's true end — not stuck at
    // whatever the last *received* row's seq would have been (there wasn't
    // one), which is exactly the "Cursor advancement past filtered
    // own-device rows" fix under test.
    expect(report.cursor).toBe(watermark);
    // Zero of this device's own rows were ever handed back to it.
    expect(server.servedRowCount('A')).toBe(0);

    // Steady state afterward: nothing new to push or pull, no re-scanning.
    const report2 = await a.engine.syncOnce();
    expect(report2.pulled).toBe(0);
    expect(report2.cursor).toBe(watermark);
    expect(server.servedRowCount('A')).toBe(0);

    a.db.close();
  });

  it('(l) own/other rows interleaved across page boundaries converge identically to the unfiltered behavior, and the pulling device is never served one of its own rows', async () => {
    const server = new MockSyncServer();
    const transportA = server.createDeviceTransport('A');
    const transportB = server.createDeviceTransport('B');
    const a = await makeDevice('deviceA', transportA);
    const b = await makeDevice('deviceB', transportB);
    // A small pullPageSize (well under how many rows this test pushes)
    // forces B's pull loop through several pages, so a page boundary can
    // genuinely land in the middle of a run of filtered-out own rows —
    // exactly where a naive "advance to the last *received* row" cursor
    // rule would understate progress. B's own engine (from makeDevice)
    // keeps the default page size; this second engine, sharing the same
    // driver and transport, is used only for B's turns below.
    const bEngine = new SyncEngine({
      db: b.driver,
      transport: transportB,
      pullPageSize: 4,
    });

    await seedChart(a); // 4 chart rows, A-authored
    await a.engine.syncOnce();
    await bEngine.syncOnce();
    // B needs its OWN 'Current Asset' chart row (AccountService.insertAccount
    // resolves the chart by headName scoped to the CALLING device's own
    // username — see that service's insertAccount SQL — so B inserting
    // accounts below needs a chart it owns, not merely one it has synced
    // read access to). This adds 4 more B-authored chart rows to the log —
    // never served back to B, so not part of `aOwnRowCount` below.
    await seedChart(b);
    await bEngine.syncOnce();
    await a.engine.syncOnce();

    // Alternate authorship, pushing after every single write so the SERVER
    // LOG itself interleaves A-owned and B-owned rows one after another
    // (A, B, A, B, ...) — not just each device's local data.
    const accountNames: string[] = [];
    // A's first syncOnce above pushed its own `users` row too — makeDevice
    // seeds that row via a raw INSERT (not through a core service), but
    // `users` IS one of migration 029's SYNC_TABLES (see that migration's
    // doc comment: "users DOES replicate"), so its capture trigger still
    // fires and it rides along in the very first push like any other
    // A-authored row.
    const aOwnRowCount = 1 + 4; // A's own `users` row + seedChart(a)'s 4 chart rows
    let aAccountCount = 0;
    for (let i = 0; i < 16; i += 1) {
      if (i % 2 === 0) {
        const name = `AcctA${i}`;
        // eslint-disable-next-line no-await-in-loop
        await insertAccount(a, name, 'Current Asset');
        // eslint-disable-next-line no-await-in-loop
        await a.engine.syncOnce();
        accountNames.push(name);
        aAccountCount += 1;
      } else {
        const name = `AcctB${i}`;
        // eslint-disable-next-line no-await-in-loop
        await insertAccount(b, name, 'Current Asset');
        // eslint-disable-next-line no-await-in-loop
        await bEngine.syncOnce();
        accountNames.push(name);
      }
    }

    // Final round-trip so each device also sees whatever the OTHER pushed
    // on its own very last turn.
    await a.engine.syncOnce();
    await bEngine.syncOnce();

    await assertTableConverged(a, b, 'account');
    for (const name of accountNames) {
      // eslint-disable-next-line no-await-in-loop
      const onA = await a.driver.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM account WHERE name = @name`,
        { name },
      );
      // eslint-disable-next-line no-await-in-loop
      const onB = await b.driver.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM account WHERE name = @name`,
        { name },
      );
      expect(onA!.c).toBe(1);
      expect(onB!.c).toBe(1);
    }

    // B's cursor caught up to the log's true end exactly the same as it
    // would have without any device-side filtering.
    const watermark = await server.createDeviceTransport('probe').currentSeq();
    const bCursorRow = await b.driver.get<{ value: string }>(
      `SELECT value FROM sync_state WHERE key = 'cursor'`,
    );
    expect(Number(bCursorRow!.value)).toBe(watermark);

    // B was never handed back one of its own 8 account rows across any of
    // those page boundaries — only ever A's rows (4 chart + 8 accounts),
    // each delivered exactly once across however many pull calls it took.
    expect(server.servedRowCount('B')).toBe(aOwnRowCount + aAccountCount);

    a.db.close();
    b.db.close();
  });

  it('(m) a foreign row pushed strictly after a pull cycle already queried the log is deferred to the very next cycle, never lost', async () => {
    const server = new MockSyncServer();
    const transportA = server.createDeviceTransport('A');
    const a = await makeDevice('deviceA', transportA);
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    await seedChart(a);
    await insertAccount(a, 'Cash', 'Current Asset');
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    await assertTableConverged(a, b, 'account');

    // B's whole backlog fits in one page, so its pull loop makes exactly
    // one `pull` call this cycle. Wrap B's transport so that, right after
    // that one call resolves (i.e. strictly after the query that would
    // have returned a new row had it existed yet), A pushes a brand-new
    // row — landing after both B's pre-loop `currentSeq()` snapshot AND
    // the only query this cycle runs.
    const transportB = server.createDeviceTransport('B');
    let injected = false;
    const wrapped: SyncTransport = {
      push: (batch) => transportB.push(batch),
      currentSeq: () => transportB.currentSeq(),
      pull: async (afterSeq, limit) => {
        const page = await transportB.pull(afterSeq, limit);
        if (!injected) {
          injected = true;
          await insertAccount(a, 'Sale', 'Revenue');
          await a.engine.syncOnce();
        }
        return page;
      },
    };
    const bEngine = new SyncEngine({ db: b.driver, transport: wrapped });

    const watermarkBeforeCycle1 = await server
      .createDeviceTransport('probe')
      .currentSeq();
    const report1 = await bEngine.syncOnce();

    // 'Sale' was pushed strictly after B's only pull query for this cycle
    // already ran — it must not appear on B yet, and B's cursor must not
    // have silently advanced past its seq (which is provably > the
    // pre-loop snapshot, since MockSyncServer's seq only ever increases —
    // see pullAndApply's "Cursor advancement..." doc comment for why that
    // guarantees this row can never be skipped).
    expect(report1.pulled).toBe(0);
    expect(report1.applied).toBe(0);
    expect(report1.cursor).toBe(watermarkBeforeCycle1);
    const saleAfterCycle1 = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Sale'`,
    );
    expect(saleAfterCycle1!.c).toBe(0);

    // Picked up cleanly on the very next syncOnce — deferred, never lost.
    const report2 = await bEngine.syncOnce();
    expect(report2.applied).toBe(1);
    const saleAfterCycle2 = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Sale'`,
    );
    expect(saleAfterCycle2!.c).toBe(1);

    a.db.close();
    b.db.close();
  });

  // -----------------------------------------------------------------------
  // Declared-blob column replication (migration 029's fixed capture
  // triggers + SyncEngine.applyRow's hex decode) — see migration 029's
  // `jsonObjectExpr`/`allColumnInfo` and migration 031's doc comments for
  // the field bug this closes: `users.password_hash` (declared BLOB)
  // previously never replicated at all, so a second device could never log
  // in. These two scenarios are the end-to-end proof the fix actually
  // round-trips a real credential, in both shapes this schema's own values
  // take today (TEXT-in-a-BLOB-column desktop hashes, and a genuine blob).
  // -----------------------------------------------------------------------

  it('(n) a declared-blob column holding a TEXT value (desktop-style saltHex:hashHex password hash) converges identically across devices', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    const hash = 'a1b2c3d4e5f6:9f8e7d6c5b4a3928170695867534231201f0e0d';
    await a.driver.run(
      `INSERT INTO users (username, password_hash, status) VALUES ('owner', @hash, 1)`,
      { hash },
    );

    await a.engine.syncOnce();
    await b.engine.syncOnce();

    const uuidOnA = await a.driver.get<{ uuid: string }>(
      `SELECT uuid FROM users WHERE username = 'owner'`,
    );
    const rowOnB = await b.driver.get<{
      uuid: string;
      password_hash: string | Buffer | null;
    }>(`SELECT uuid, password_hash FROM users WHERE username = 'owner'`);

    expect(rowOnB).toBeDefined();
    expect(rowOnB!.uuid).toBe(uuidOnA!.uuid);
    // better-sqlite3 returns a BLOB-declared column holding a TEXT value as
    // a plain JS string (SQLite's dynamic typing/BLOB-affinity — see
    // migration 029's jsonObjectExpr doc comment), same as what was
    // inserted — never coerced into a Buffer.
    expect(rowOnB!.password_hash).toBe(hash);

    a.db.close();
    b.db.close();
  });

  it('(o) a declared-blob column holding a genuine blob value converges byte-for-byte across devices', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    const blob = Buffer.from([0x00, 0x01, 0xde, 0xad, 0xbe, 0xef, 0xff]);
    await a.driver.run(
      `INSERT INTO users (username, password_hash, status) VALUES ('owner', @blob, 1)`,
      { blob },
    );

    await a.engine.syncOnce();
    await b.engine.syncOnce();

    const uuidOnA = await a.driver.get<{ uuid: string }>(
      `SELECT uuid FROM users WHERE username = 'owner'`,
    );
    const rowOnB = await b.driver.get<{
      uuid: string;
      password_hash: Buffer | null;
    }>(`SELECT uuid, password_hash FROM users WHERE username = 'owner'`);

    expect(rowOnB).toBeDefined();
    expect(rowOnB!.uuid).toBe(uuidOnA!.uuid);
    expect(Buffer.isBuffer(rowOnB!.password_hash)).toBe(true);
    expect(rowOnB!.password_hash).toEqual(blob);

    a.db.close();
    b.db.close();
  });

  // -----------------------------------------------------------------------
  // Server-log reseeding (src/core/sync/seedOutbox.ts) — the real incident:
  // an owner's Supabase sync_log was accidentally truncated (a stale
  // SQL-editor buffer re-run), while the owner's own PWA held the complete
  // local database with an already-empty sync_outbox. Epoch-reset detection
  // alone (scenario (h)) heals a device's *cursor*, but a device with
  // nothing pending in its outbox never re-uploads on its own — these
  // scenarios prove `SyncEngine` now does that automatically.
  // -----------------------------------------------------------------------

  it('(p) server log wiped: a data-holding device re-seeds automatically, and the other device re-converges onto the SAME row uuids (no duplicates)', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await seedChart(a);
    const cash = await insertAccount(a, 'Cash', 'Current Asset');
    const sale = await insertAccount(a, 'Sale', 'Revenue');
    await a.journal.insertJournal(
      aJournal({
        journalEntries: [
          { accountId: cash, debitAmount: 500, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 500 },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      }),
    );
    // A push+pull, B push+pull, A pull again — the same three-round dance
    // scenario (b) uses, needed so A also picks up B's own `users` row
    // (pushed only during B's own sync above) before both are asserted
    // fully converged, including `users`.
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    await a.engine.syncOnce();

    // One UPDATE (no new row, one extra log entry) so B's post-convergence
    // cursor ends up strictly ahead of what a reseed alone will ever emit —
    // seedOutboxFromLocalData always emits exactly one row per CURRENTLY
    // existing row, never one per historical write, so an insert-only
    // history's reseed count can otherwise coincidentally tie a
    // fully-converged device's cursor. That coincidence wouldn't be a bug
    // (see this test's later assertions — B still ends up with exactly the
    // right data either way), but it would make this test's specific "B
    // detects an epoch reset" assertion below flaky on the exact shape of
    // the seed data. Forcing the cursor strictly ahead removes that
    // coincidence.
    const cashId = await accountIdByName(a, 'Cash');
    await a.accounts.updateAccount({
      id: cashId,
      name: 'Cash In Hand',
      headName: 'Current Asset',
      ...defaultAccountFields,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    await a.engine.syncOnce();

    await assertAllFactsConverged(a, b);
    await assertBalancesConverged(a, b);

    // Both devices are fully drained at this point — the exact incident
    // precondition (everything already pushed long ago).
    expect(await outboxCount(a)).toBe(0);
    expect(await outboxCount(b)).toBe(0);

    const accountUuidsBefore = (
      await b.driver.all<{ uuid: string }>(
        `SELECT uuid FROM account ORDER BY uuid`,
      )
    ).map((r) => r.uuid);
    expect(accountUuidsBefore.length).toBe(2); // Cash + Sale

    // The owner's SQL-editor mishap: the server's log is truncated.
    server.wipe();
    expect(server.logLength).toBe(0);

    // A's next ordinary sync cycle detects the emptied server, re-seeds its
    // outbox from its own already-applied data, and pushes it — all within
    // this one syncOnce call.
    const reportA = await a.engine.syncOnce();
    expect(reportA.seeded).toBeGreaterThan(0);
    expect(reportA.pushed).toBeGreaterThanOrEqual(reportA.seeded);
    expect(await outboxCount(a)).toBe(0); // fully drained in the same cycle
    expect(server.logLength).toBeGreaterThan(0); // server actually repopulated

    const reseedWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes(
        'server log is empty but this device holds data',
      ),
    );
    expect(reseedWarnings.length).toBeGreaterThanOrEqual(1);

    // B, which wrote nothing new, still detects its own now-stale cursor as
    // an epoch reset (server was wiped since B last synced) and re-pulls
    // from scratch — this is scenario (h)'s mechanism, now feeding off A's
    // freshly-reseeded log instead of an empty one.
    const reportB = await b.engine.syncOnce();
    expect(reportB.epochReset).toBe(true);
    expect(reportB.seeded).toBe(0); // B never had an empty-outbox+has-data moment of its own

    await assertAllFactsConverged(a, b);
    await assertBalancesConverged(a, b);

    // The whole point: B's account rows are the SAME rows as before, not a
    // second, duplicate copy under new uuids.
    const accountUuidsAfter = (
      await b.driver.all<{ uuid: string }>(
        `SELECT uuid FROM account ORDER BY uuid`,
      )
    ).map((r) => r.uuid);
    expect(accountUuidsAfter).toEqual(accountUuidsBefore);

    const conflictsOnA = await a.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
    );
    const conflictsOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
    );
    expect(conflictsOnA!.c).toBe(0);
    expect(conflictsOnB!.c).toBe(0);

    warnSpy.mockRestore();
    a.db.close();
    b.db.close();
  });

  it('(q) concurrent double-seed: both devices reseed the same wiped server before seeing each other push, and still converge with zero conflicts and no duplicate rows', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    await seedChart(a);
    await insertAccount(a, 'Cash', 'Current Asset');
    await insertAccount(a, 'Sale', 'Revenue');
    // A push+pull, B push+pull, A pull again — see (p)'s comment: A only
    // picks up B's own `users` row on this third round.
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    await a.engine.syncOnce();
    await assertAllFactsConverged(a, b);

    // Both devices are fully drained and hold IDENTICAL rows (same uuids)
    // before the wipe — the precondition that makes a "double seed" a
    // pure-dedup non-event rather than a real conflict.
    expect(await outboxCount(a)).toBe(0);
    expect(await outboxCount(b)).toBe(0);

    server.wipe();
    expect(server.logLength).toBe(0);

    // Both devices' first drain this cycle is a no-op (their outboxes are
    // already empty), so both independently observe `currentSeq() === 0`
    // before either one's reseed has been pushed — genuinely concurrent
    // seeding of the same wiped log, not one device racing ahead of the
    // other.
    const [reportA, reportB] = await Promise.all([
      a.engine.syncOnce(),
      b.engine.syncOnce(),
    ]);
    expect(reportA.seeded).toBeGreaterThan(0);
    expect(reportB.seeded).toBeGreaterThan(0);

    // A second round lets each device pull whatever the other's push landed
    // (or, for rows sharing the same deterministic idempotencyKey, dedup
    // away as a no-op) and fully catch up.
    await Promise.all([a.engine.syncOnce(), b.engine.syncOnce()]);
    await Promise.all([a.engine.syncOnce(), b.engine.syncOnce()]);

    await assertAllFactsConverged(a, b);

    // Each business row present exactly once per device — no duplication
    // from the concurrent double-seed (both devices' reseed rows carried
    // the SAME idempotencyKey per uuid, so the server's dedup absorbed the
    // second arrival of each).
    const accountsOnA = await a.driver.all<{ uuid: string }>(
      `SELECT uuid FROM account`,
    );
    const accountsOnB = await b.driver.all<{ uuid: string }>(
      `SELECT uuid FROM account`,
    );
    expect(accountsOnA).toHaveLength(2);
    expect(accountsOnB).toHaveLength(2);
    expect(new Set(accountsOnA.map((r) => r.uuid)).size).toBe(2);
    expect(new Set(accountsOnB.map((r) => r.uuid)).size).toBe(2);

    const conflictsOnA = await a.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
    );
    const conflictsOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
    );
    expect(conflictsOnA!.c).toBe(0);
    expect(conflictsOnB!.c).toBe(0);

    a.db.close();
    b.db.close();
  });

  it('(r) causal ordering survives a reseed: a brand-new device joining AFTER a reseed applies cleanly with no FK-resolution errors', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));

    await seedChart(a);
    // InvoiceService.getTransactionAccounts requires both a 'Sale' and a
    // 'Purchase' named account regardless of this invoice's own type.
    await insertAccount(a, 'Sale', 'Revenue');
    await insertAccount(a, 'Purchase', 'Expense');
    const partyId = await insertAccount(a, 'Customer', 'Current Asset');
    const cash = await insertAccount(a, 'Cash', 'Current Asset');
    const saleAccountId = await accountIdByName(a, 'Sale');
    await a.journal.insertJournal(
      aJournal({
        journalEntries: [
          { accountId: cash, debitAmount: 200, creditAmount: 0 },
          { accountId: saleAccountId, debitAmount: 0, creditAmount: 200 },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      }),
    );
    await a.pricing.insertItemType('General');
    const itemTypeRow = await a.driver.get<{ id: number }>(
      `SELECT id FROM item_types WHERE name = 'General'`,
    );
    await a.pricing.setPrimaryItemType(itemTypeRow!.id);
    await a.driver.run(
      `INSERT INTO inventory (name, description, price, quantity, itemTypeId) VALUES (@name, NULL, @price, @quantity, @itemTypeId)`,
      { name: 'Widget', price: 50, quantity: 100, itemTypeId: itemTypeRow!.id },
    );
    const inventoryRow = await a.driver.get<{ id: number }>(
      `SELECT id FROM inventory WHERE name = 'Widget'`,
    );
    await a.invoices.insertInvoice(
      'Sale' as InvoiceType,
      {
        id: -1,
        invoiceType: 'Sale' as InvoiceType,
        date: new Date('2026-03-01T12:00:00.000Z').toISOString(),
        invoiceNumber: 9101,
        extraDiscount: 0,
        extraDiscountAccountId: undefined,
        totalAmount: 150,
        biltyNumber: '',
        cartons: 0,
        accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
        invoiceItems: [
          {
            id: 1,
            inventoryId: inventoryRow!.id,
            quantity: 3,
            discount: 0,
            price: 50,
            discountedPrice: 150,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );

    await a.engine.syncOnce();
    expect(await outboxCount(a)).toBe(0);

    // The wipe, and A's automatic reseed — parents (chart/account/inventory/
    // invoices) and children (journal_entry/invoice_items) all get
    // re-queued in SEED_TABLE_ORDER (BUSINESS_TABLES' own parents-before-
    // children order — see seedOutbox.ts), so the re-populated log is
    // causally ordered exactly like a fresh, never-wiped log would be.
    server.wipe();
    const reportA = await a.engine.syncOnce();
    expect(reportA.seeded).toBeGreaterThan(0);
    expect(await outboxCount(a)).toBe(0);

    // C joins fresh, AFTER the reseed, seeing only the reseeded log — never
    // the original (pre-wipe) one. If SEED_TABLE_ORDER ever regressed to an
    // order that placed a child row before its parent, this is exactly
    // where SyncEngine.applyRow's "cannot resolve ... uuid" error would
    // surface (see that method's doc comment).
    const c = await makeDevice('deviceC', server.createDeviceTransport('C'));
    const joinResult = await c.engine.initialPull();
    expect(joinResult.pulled).toBeGreaterThan(0);
    expect(joinResult.applied).toBe(joinResult.pulled);
    expect(joinResult.applyConflicts).toBe(0);
    expect(joinResult.skippedUnknownTable).toBe(0);

    await assertTableConverged(a, c, 'chart');
    await assertTableConverged(a, c, 'account');
    await assertTableConverged(a, c, 'journal');
    await assertTableConverged(a, c, 'journal_entry');
    await assertTableConverged(a, c, 'invoices');
    await assertTableConverged(a, c, 'invoice_items');
    await assertBalancesConverged(a, c);

    a.db.close();
    c.db.close();
  });

  // -----------------------------------------------------------------------
  // `users.username` collision rule (SyncEngine.applyRow's
  // "users.username collision" doc comment) — the real incident this repo's
  // task list is built around: device B's own boot-time placeholder
  // `'default'` user (NULL password_hash — see db.worker.ts's
  // `ensurePlaceholderDefaultUser`) colliding with the REAL, credentialed
  // `'default'` user pulled from another device once B connects to sync.
  // -----------------------------------------------------------------------

  it("(s) real incident: a device's boot-time placeholder 'default' user + charts (capture suppressed, mimicking boot) is replaced by the real credentialed 'default' user pulled from another device — zero conflicts, full convergence, and B's login-shaped lookup returns the real credential", async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    // B: mimic db.worker.ts's ensurePlaceholderDefaultUser at boot exactly —
    // insert the placeholder user + a starter chart with capture suppressed
    // (sync_state.applying set for the duration, then cleared — the same
    // mechanism withCaptureSuppressed uses), so neither row ever reaches
    // B's own outbox. See that function's doc comment for the incident this
    // guards against.
    await b.driver.run(
      `INSERT INTO sync_state (key, value) VALUES ('applying', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    await b.driver.run(
      `INSERT INTO users (username, password_hash, status) VALUES ('default', NULL, 1)`,
    );
    const placeholderUserId = await b.driver.get<{ id: number }>(
      `SELECT id FROM users WHERE username = 'default'`,
    );
    await b.driver.run(
      `INSERT INTO chart (userId, name, type) VALUES (@userId, 'Current Asset', 'Asset')`,
      { userId: placeholderUserId!.id },
    );
    await b.driver.run(`DELETE FROM sync_state WHERE key = 'applying'`);

    // Confirm the suppression actually worked before this test relies on
    // it: nothing naming the placeholder ever entered B's own outbox.
    const capturedPlaceholder = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_outbox WHERE tableName = 'users' AND json_extract(rowJson, '$.username') = 'default'`,
    );
    expect(capturedPlaceholder!.c).toBe(0);

    // A: the REAL business — a credentialed 'default' user with its own
    // real chart and an account under it, pushed to the shared server.
    const hash = 'a1b2c3d4e5f6:9f8e7d6c5b4a3928170695867534231201f0e0d';
    await a.driver.run(
      `INSERT INTO users (username, password_hash, status) VALUES ('default', @hash, 1)`,
      { hash },
    );
    const realUserId = await a.driver.get<{ id: number }>(
      `SELECT id FROM users WHERE username = 'default'`,
    );
    await a.driver.run(
      `INSERT INTO chart (userId, name, type) VALUES (@userId, 'Current Asset', 'Asset')`,
      { userId: realUserId!.id },
    );
    const realChartId = await a.driver.get<{ id: number }>(
      `SELECT id FROM chart WHERE userId = @userId`,
      { userId: realUserId!.id },
    );
    await a.driver.run(
      `INSERT INTO account (name, chartId, code, isActive) VALUES ('Cash', @chartId, '100', 1)`,
      { chartId: realChartId!.id },
    );

    await a.engine.syncOnce();
    // B pulls: the real 'default' user collides with B's own local
    // placeholder on UNIQUE(username) — the generic uuid-keyed upsert can't
    // match them (different uuids). Per the collision rule, the real
    // (credentialed) incoming row wins: B's placeholder + its scaffolding
    // chart are deleted, and the insert is retried — succeeding this time,
    // and the child chart/account rows (same page, applied right after)
    // resolve their FK-uuid siblings against the newly-inserted real user/
    // chart cleanly, with NOTHING quarantined.
    const reportB = await b.engine.syncOnce();

    expect(reportB.applyConflicts).toBe(0);
    // This is the "local placeholder replaced" branch, not the "discard
    // incoming" branch — the incoming row IS written (after the delete +
    // retry), so it's counted in `applied`, not `discardedPlaceholderUsers`.
    expect(reportB.discardedPlaceholderUsers).toBe(0);

    const conflictsOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
    );
    expect(conflictsOnB!.c).toBe(0);

    // B's 'default' user is now A's real one — same uuid, real credential —
    // not the placeholder's.
    const defaultOnA = await a.driver.get<{ uuid: string }>(
      `SELECT uuid FROM users WHERE username = 'default'`,
    );
    const defaultOnB = await b.driver.get<{
      uuid: string;
      password_hash: string | Buffer | null;
    }>(`SELECT uuid, password_hash FROM users WHERE username = 'default'`);
    expect(defaultOnB!.uuid).toBe(defaultOnA!.uuid);
    expect(defaultOnB!.password_hash).toBe(hash);

    // Exactly one 'default' user on B — the placeholder is really gone, not
    // just shadowed by a second row.
    const defaultCountOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM users WHERE username = 'default'`,
    );
    expect(defaultCountOnB!.c).toBe(1);

    // The placeholder's OWN scaffolding chart is gone too — B's chart/
    // account tables now match A's exactly (uuid for uuid), not "A's rows
    // plus a leftover placeholder chart".
    await assertTableConverged(a, b, 'chart');
    await assertTableConverged(a, b, 'account');

    // B's login-shaped check: exactly what db.worker.ts's `login` handler
    // itself queries — returns the real credential, not NULL.
    const loginCheck = await b.driver.get<{
      password_hash: string | Buffer | null;
    }>(`SELECT password_hash FROM users WHERE username = @username`, {
      username: 'default',
    });
    expect(loginCheck!.password_hash).toBe(hash);

    a.db.close();
    b.db.close();
  });

  it("(t) a real, credentialed user pulling a peer's NULL-hash 'default' placeholder discards it silently: local row untouched, zero conflicts, counted in discardedPlaceholderUsers", async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    // A peer device's boot-time placeholder, pushed directly onto the
    // shared log via its own transport — mirrors test (g)'s style for
    // simulating a row from "some other device" without needing a second
    // full `Device` harness instance for it.
    const transportPeer = server.createDeviceTransport('peer');

    const hash = 'a1b2c3d4e5f6:9f8e7d6c5b4a3928170695867534231201f0e0d';
    await a.driver.run(
      `INSERT INTO users (username, password_hash, status) VALUES ('default', @hash, 1)`,
      { hash },
    );
    const aDefaultUuid = (await a.driver.get<{ uuid: string }>(
      `SELECT uuid FROM users WHERE username = 'default'`,
    ))!.uuid;

    await transportPeer.push([
      {
        idempotencyKey: 'peer-boot-placeholder',
        tableName: 'users',
        rowUuid: 'peer-placeholder-uuid',
        op: 'put',
        rowJson: JSON.stringify({
          username: 'default',
          password_hash: null,
          password_hash__hex: null,
          status: 1,
        }),
      },
    ]);

    // A pushes its own real 'default' user first, then pulls the peer's
    // placeholder row in the same syncOnce.
    const report = await a.engine.syncOnce();

    expect(report.discardedPlaceholderUsers).toBe(1);
    expect(report.applyConflicts).toBe(0);

    // A's own row is untouched: same uuid, same credential.
    const localRow = await a.driver.get<{
      uuid: string;
      password_hash: string | Buffer | null;
    }>(`SELECT uuid, password_hash FROM users WHERE username = 'default'`);
    expect(localRow!.uuid).toBe(aDefaultUuid);
    expect(localRow!.password_hash).toBe(hash);

    // Exactly one 'default' user — the peer's placeholder was discarded,
    // not written as a second row under a different uuid.
    const defaultCount = await a.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM users WHERE username = 'default'`,
    );
    expect(defaultCount!.c).toBe(1);
    const peerRowLanded = await a.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM users WHERE uuid = 'peer-placeholder-uuid'`,
    );
    expect(peerRowLanded!.c).toBe(0);

    const conflicts = await a.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
    );
    expect(conflicts!.c).toBe(0);

    a.db.close();
  });

  it("(v) real incident, second wave: a fully-synced device pulls a peer's TWO boot-placeholder generations (2 passwordless 'default' users + 14 INITIAL_CHARTS charts) — all 16 rows discarded silently, zero sync_apply_conflicts, B's own users/charts untouched", async () => {
    const server = new MockSyncServer();
    // B: the "real" device — a credentialed 'default' user (`makeDevice`
    // seeds every device's own username with a non-null password_hash —
    // see that helper's body) plus a real chart, already pushed to the
    // shared server ("fully synced") BEFORE the peer's placeholder
    // generations ever land. Mirrors scenario (t)'s username-collision
    // setup, extended to the `chart` FK children this scenario is actually
    // about.
    const b = await makeDevice('default', server.createDeviceTransport('B'));
    await seedChart(b);
    await b.engine.syncOnce();

    const bUsersBefore = await b.driver.all<{ uuid: string }>(
      `SELECT uuid FROM users ORDER BY uuid`,
    );
    const bChartsBefore = await b.driver.all<{ uuid: string }>(
      `SELECT uuid FROM chart ORDER BY uuid`,
    );
    expect(bUsersBefore.length).toBe(1);
    expect(bChartsBefore.length).toBeGreaterThan(0);

    // A peer device pushes its boot placeholder generation TWICE — the
    // real incident this test is named for: a wedged device re-sent the
    // exact same scaffolding before the capture-suppression fix
    // (db.worker.ts's `ensurePlaceholderDefaultUser`) landed. Each
    // generation is pushed as its own batch — 1 passwordless 'default'
    // `users` row, then its 7 `INITIAL_CHARTS` children, FK-linked via
    // `userId_uuid` — mirroring how the real capture triggers would have
    // appended them (parent before children, one boot-time write per
    // generation), and test (t)'s style for fabricating a peer's row
    // directly through its own transport rather than a second full
    // `Device` harness instance.
    const transportPeer = server.createDeviceTransport('peer');
    for (const gen of [1, 2] as const) {
      const placeholderUserUuid = `peer-placeholder-gen${gen}-user`;
      // eslint-disable-next-line no-await-in-loop
      await transportPeer.push([
        {
          idempotencyKey: `peer-gen${gen}-user`,
          tableName: 'users',
          rowUuid: placeholderUserUuid,
          op: 'put',
          rowJson: JSON.stringify({
            username: 'default',
            password_hash: null,
            password_hash__hex: null,
            status: 1,
          }),
        },
        ...INITIAL_CHARTS.map((chart, i) => ({
          idempotencyKey: `peer-gen${gen}-chart-${i}`,
          tableName: 'chart',
          rowUuid: `peer-placeholder-gen${gen}-chart-${i}`,
          op: 'put' as const,
          rowJson: JSON.stringify({
            name: chart.name,
            type: chart.type,
            date: new Date().toISOString(),
            userId_uuid: placeholderUserUuid,
          }),
        })),
      ]);
    }

    const report = await b.engine.syncOnce();

    // 2 placeholder `users` rows + 14 orphaned `INITIAL_CHARTS` children —
    // every single one of the 16 rows accounted for, none of it quarantined.
    expect(report.discardedPlaceholderUsers).toBe(2);
    expect(report.discardedPlaceholderCharts).toBe(14);
    expect(report.applyConflicts).toBe(0);
    expect(report.applied).toBe(0);

    const conflicts = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
    );
    expect(conflicts!.c).toBe(0);

    // B's own users/chart rows are byte-for-byte untouched: same uuids,
    // same count, as before the peer's placeholder rows ever arrived.
    const bUsersAfter = await b.driver.all<{ uuid: string }>(
      `SELECT uuid FROM users ORDER BY uuid`,
    );
    const bChartsAfter = await b.driver.all<{ uuid: string }>(
      `SELECT uuid FROM chart ORDER BY uuid`,
    );
    expect(bUsersAfter.map((r) => r.uuid)).toEqual(
      bUsersBefore.map((r) => r.uuid),
    );
    expect(bChartsAfter.map((r) => r.uuid)).toEqual(
      bChartsBefore.map((r) => r.uuid),
    );

    // None of the 16 placeholder rows' own uuids landed anywhere locally —
    // discarded, not written under a stray uuid.
    const strayUsers = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM users WHERE uuid LIKE 'peer-placeholder-%'`,
    );
    const strayCharts = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM chart WHERE uuid LIKE 'peer-placeholder-%'`,
    );
    expect(strayUsers!.c).toBe(0);
    expect(strayCharts!.c).toBe(0);

    b.db.close();
  });

  it('(w) prunePlaceholderConflicts self-cleans stale placeholder-shaped sync_apply_conflicts rows recorded under older code, while every genuine conflict of the same shape survives', async () => {
    const server = new MockSyncServer();
    const c = await makeDevice('default', server.createDeviceTransport('C'));

    const localDefaultUuid = (await c.driver.get<{ uuid: string }>(
      `SELECT uuid FROM users WHERE username = 'default'`,
    ))!.uuid;

    // Pre-populate `sync_apply_conflicts` directly against migration 030's
    // columns, simulating rows recorded under OLDER code — before either
    // discard rule (`applyRow`'s users-collision rule, or this task's
    // in-run chart-orphan discard) existed. Nothing about how these rows
    // got here matters to `prunePlaceholderConflicts` — it only ever reads
    // the table's current contents and this device's current local
    // `users` — so a direct INSERT is a faithful stand-in for "quarantined
    // by an old build, sitting there ever since."
    const insertConflict = async (row: {
      rowUuid: string;
      tableName: 'users' | 'chart';
      rowJson: Record<string, unknown>;
    }): Promise<void> => {
      await c.driver.run(
        `INSERT INTO sync_apply_conflicts (seq, tableName, rowUuid, op, rowJson, error, createdAt)
         VALUES (1, @tableName, @rowUuid, 'put', @rowJson, 'SQLITE_CONSTRAINT_UNIQUE (simulated, pre-existing)', datetime('now'))`,
        {
          tableName: row.tableName,
          rowUuid: row.rowUuid,
          rowJson: JSON.stringify(row.rowJson),
        },
      );
    };

    // (a) junk — signature the discard rule now resolves silently: a
    // passwordless 'default' users conflict whose username exists locally,
    // credentialed.
    await insertConflict({
      rowUuid: 'stale-users-junk',
      tableName: 'users',
      rowJson: {
        username: 'default',
        password_hash: null,
        password_hash__hex: null,
        status: 1,
      },
    });
    // (a) genuine — BOTH sides credentialed: a real two-independently-
    // seeded-devices username collision, which must stay reviewable
    // forever (pruning it would silently drop one device's real account).
    await insertConflict({
      rowUuid: 'genuine-users-collision',
      tableName: 'users',
      rowJson: {
        username: 'default',
        password_hash: 'realhash:fromanotherdevice',
        password_hash__hex: null,
        status: 1,
      },
    });

    // (b) junk — an INITIAL_CHARTS-named chart whose parent uuid resolves
    // to nothing local.
    await insertConflict({
      rowUuid: 'stale-chart-junk',
      tableName: 'chart',
      rowJson: {
        name: 'Current Asset',
        type: 'Asset',
        userId_uuid: 'no-such-user-uuid',
      },
    });
    // (b) genuine #1 — NOT an INITIAL_CHARTS name at all: a real user-
    // created chart, which must survive regardless of its parent's
    // resolvability.
    await insertConflict({
      rowUuid: 'genuine-chart-custom-name',
      tableName: 'chart',
      rowJson: {
        name: 'My Custom Ledger',
        type: 'Asset',
        userId_uuid: 'no-such-user-uuid',
      },
    });
    // (b) genuine #2 — an INITIAL_CHARTS name, but its parent DOES resolve
    // locally: impossible for a row that was genuinely quarantined for FK
    // failure (see `prunePlaceholderConflicts`'s doc comment on why this
    // conjunct is re-derived rather than trusted), but exercised here
    // directly to prove the predicate itself, not just the invariant, is
    // what keeps this row safe.
    await insertConflict({
      rowUuid: 'genuine-chart-resolvable-parent',
      tableName: 'chart',
      rowJson: {
        name: 'Revenue',
        type: 'Revenue',
        userId_uuid: localDefaultUuid,
      },
    });

    const before = await c.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
    );
    expect(before!.c).toBe(5);

    await c.engine.syncOnce();

    const remaining = await c.driver.all<{ rowUuid: string }>(
      `SELECT rowUuid FROM sync_apply_conflicts ORDER BY rowUuid`,
    );
    expect(new Set(remaining.map((r) => r.rowUuid))).toEqual(
      new Set([
        'genuine-users-collision',
        'genuine-chart-custom-name',
        'genuine-chart-resolvable-parent',
      ]),
    );

    c.db.close();
  });

  // -----------------------------------------------------------------------
  // "Re-download everything from sync" (SyncEngine.rebuildFromServer) — a
  // device repair action for a device whose apply cascade already
  // quarantined rows with its cursor advanced past them, which no ordinary
  // future syncOnce can ever heal on its own.
  // -----------------------------------------------------------------------

  it('(u) rebuildFromServer heals a device with corrupted/partial local state: after rebuild it converges exactly with the server, outbox and conflicts are empty, and the cursor lands at the server max', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    await seedChart(a);
    const cash = await insertAccount(a, 'Cash', 'Current Asset');
    const sale = await insertAccount(a, 'Sale', 'Revenue');
    await a.journal.insertJournal(
      aJournal({
        journalEntries: [
          { accountId: cash, debitAmount: 300, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 300 },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      }),
    );
    // A push+pull, B push+pull, A pull again — the same three-round dance
    // scenario (p) uses, so A also picks up B's own `users` row before
    // asserting full convergence including `users`.
    await a.engine.syncOnce();
    await b.engine.syncOnce();
    await a.engine.syncOnce();
    await assertAllFactsConverged(a, b);
    await assertBalancesConverged(a, b);

    // Deliberately corrupt B: delete a row it already correctly applied
    // (raw SQL, bypassing nothing special — simulating the kind of local
    // damage a wedged apply cascade or a stray manual edit leaves behind),
    // and plant a junk conflict + a junk outbox row on top. The
    // `journal_entry` row referencing 'Sale' is deleted first — this
    // device's schema enforces `FOREIGN KEY("accountId") REFERENCES
    // "account"("id")` (see schema.snapshot.sql), so deleting the account
    // alone while a child entry still points at it would itself throw
    // `FOREIGN KEY constraint failed` rather than simulating the intended
    // corruption; a wedged real-world cascade plausibly orphans both rows
    // together anyway.
    await b.driver.run(
      `DELETE FROM journal_entry WHERE accountId = (SELECT id FROM account WHERE name = 'Sale')`,
    );
    await b.driver.run(`DELETE FROM account WHERE name = 'Sale'`);
    await b.driver.run(
      `INSERT INTO sync_apply_conflicts (seq, tableName, rowUuid, op, rowJson, error, createdAt)
       VALUES (999999, 'account', 'junk-conflict-uuid', 'put', '{}', 'simulated corruption', datetime('now'))`,
    );
    await b.driver.run(
      `INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
       VALUES ('junk-outbox-key', 'account', 'junk-outbox-uuid', 'put', '{}', datetime('now'))`,
    );
    const saleGoneOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Sale'`,
    );
    expect(saleGoneOnB!.c).toBe(0);
    const conflictsBefore = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
    );
    expect(conflictsBefore!.c).toBe(1);

    const result = await b.engine.rebuildFromServer();
    expect(result.pulled).toBeGreaterThan(0);
    expect(result.applyConflicts).toBe(0);
    expect(result.skippedUnknownTable).toBe(0);

    await assertAllFactsConverged(a, b);
    await assertBalancesConverged(a, b);

    expect(await outboxCount(b)).toBe(0);
    const conflictsAfter = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
    );
    expect(conflictsAfter!.c).toBe(0);

    const serverMax = await server.createDeviceTransport('probe').currentSeq();
    const cursorRow = await b.driver.get<{ value: string }>(
      `SELECT value FROM sync_state WHERE key = 'cursor'`,
    );
    expect(Number(cursorRow!.value)).toBe(serverMax);

    // The previously-deleted 'Sale' account is really back, converged with A.
    const saleBackOnB = await b.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Sale'`,
    );
    expect(saleBackOnB!.c).toBe(1);

    a.db.close();
    b.db.close();
  });

  it('(u2) rebuildFromServer refuses against an empty server and deletes nothing', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));

    await seedChart(a);
    await insertAccount(a, 'Cash', 'Current Asset');

    const accountsBefore = (
      await a.driver.all<{ uuid: string }>(
        `SELECT uuid FROM account ORDER BY uuid`,
      )
    ).map((r) => r.uuid);
    const chartsBefore = (
      await a.driver.all<{ uuid: string }>(
        `SELECT uuid FROM chart ORDER BY uuid`,
      )
    ).map((r) => r.uuid);
    expect(accountsBefore.length).toBeGreaterThan(0);
    expect(chartsBefore.length).toBeGreaterThan(0);

    // Nothing has ever been pushed to this fresh server — currentSeq() is 0.
    await expect(a.engine.rebuildFromServer()).rejects.toThrow(
      /refusing.*server log is empty/i,
    );

    const accountsAfter = (
      await a.driver.all<{ uuid: string }>(
        `SELECT uuid FROM account ORDER BY uuid`,
      )
    ).map((r) => r.uuid);
    const chartsAfter = (
      await a.driver.all<{ uuid: string }>(
        `SELECT uuid FROM chart ORDER BY uuid`,
      )
    ).map((r) => r.uuid);
    expect(accountsAfter).toEqual(accountsBefore);
    expect(chartsAfter).toEqual(chartsBefore);
    // Not just the rows — the cursor/outbox bookkeeping is untouched too.
    expect(await outboxCount(a)).toBeGreaterThan(0);

    a.db.close();
  });

  it("(u3) rebuildFromServer includes the rebuilding device's OWN previously-pushed rows: the origin device that seeded most of the log converges back to the FULL dataset, not just what a peer pushed", async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    // A is the origin device: it seeds the whole chart of accounts and a
    // journal entry BEFORE B ever joins, so the overwhelming majority of the
    // server's log carries A's own deviceId — exactly the "device that
    // seeded the whole business" shape this fix exists for (see
    // `rebuildFromServer`'s "Own rows must be included in the rebuild pull"
    // doc comment).
    await seedChart(a);
    const cash = await insertAccount(a, 'Cash', 'Current Asset');
    const sale = await insertAccount(a, 'Sale', 'Revenue');
    await a.journal.insertJournal(
      aJournal({
        journalEntries: [
          { accountId: cash, debitAmount: 500, creditAmount: 0 },
          { accountId: sale, debitAmount: 0, creditAmount: 500 },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      }),
    );
    await a.engine.syncOnce();

    // B joins afterward and contributes a single, minority row, under its
    // own independently-seeded chart (B's `insertAccount` resolves
    // `headName` against a chart owned by ITS OWN session user — see
    // `AccountService.insertAccount`'s SQL — so B needs its own chart
    // rather than A's not-yet-pulled one; same pattern scenario (l) uses).
    await seedChart(b);
    await insertAccount(b, 'Bank', 'Current Asset');
    // Same three-round dance (u)/(p) use: B push+pull picks up A's whole
    // history, then A pulls again to pick up B's one new row (including B's
    // own `users` row) — establishing the FULL converged dataset both
    // devices should still agree on after A's rebuild below.
    await b.engine.syncOnce();
    await a.engine.syncOnce();
    await assertAllFactsConverged(a, b);
    await assertBalancesConverged(a, b);

    const fullAccountUuidsBefore = (
      await a.driver.all<{ uuid: string }>(
        `SELECT uuid FROM account ORDER BY uuid`,
      )
    ).map((r) => r.uuid);
    // Sanity: A's own rows really are the majority of what's being checked
    // (the seeded chart of accounts + Cash + Sale), not just B's one Bank
    // account — otherwise this test couldn't distinguish "rebuild works" from
    // "rebuild only ever returns the minority of rows that were never A's."
    expect(fullAccountUuidsBefore.length).toBeGreaterThan(1);

    // Simulate out-of-band local corruption on A (a wedged apply cascade, a
    // stray manual edit, a botched migration — see `rebuildFromServer`'s
    // "REAL INCIDENT" doc comment for the kind of damage this repairs):
    // A's own 'Cash' account, which A itself pushed, is gone. Every row that
    // FKs onto it is deleted first — this device's schema enforces
    // `FOREIGN KEY("accountId") REFERENCES "account"("id")` on BOTH
    // `journal_entry` and `ledger` (see schema.snapshot.sql), so deleting
    // the account alone would itself throw `FOREIGN KEY constraint failed`
    // rather than simulating the intended corruption. Unlike scenario (u)'s
    // corruption of B (a device that only ever received this data via sync,
    // which never touches `ledger` — it's excluded from SYNC_TABLES,
    // deliberately: see migration 029's `SYNC_TABLES` doc comment), A is
    // the device that actually ran `insertJournal` locally, so A's stored
    // `ledger` table genuinely has rows for 'Cash' that also need clearing.
    await a.driver.run(
      `DELETE FROM ledger WHERE accountId = (SELECT id FROM account WHERE name = 'Cash')`,
    );
    await a.driver.run(
      `DELETE FROM journal_entry WHERE accountId = (SELECT id FROM account WHERE name = 'Cash')`,
    );
    await a.driver.run(`DELETE FROM account WHERE name = 'Cash'`);
    const cashGoneOnA = await a.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Cash'`,
    );
    expect(cashGoneOnA!.c).toBe(0);

    const result = await a.engine.rebuildFromServer();
    expect(result.pulled).toBeGreaterThan(0);
    expect(result.applyConflicts).toBe(0);
    expect(result.skippedUnknownTable).toBe(0);

    // The point of this test: A converges back to the FULL dataset,
    // including A's OWN rows pushed before B ever joined — 'Cash', 'Sale',
    // and the whole seeded chart, not merely B's one 'Bank' row. Without
    // `includeSelf: true` threaded through `rebuildFromServer`'s re-pull,
    // the transport's own-device filter would silently drop every one of
    // A's own rows here, and this device (having just wiped its only local
    // copy of them) would have hollowed itself out down to just B's
    // contribution.
    await assertAllFactsConverged(a, b);
    await assertBalancesConverged(a, b);

    const fullAccountUuidsAfter = (
      await a.driver.all<{ uuid: string }>(
        `SELECT uuid FROM account ORDER BY uuid`,
      )
    ).map((r) => r.uuid);
    expect(new Set(fullAccountUuidsAfter)).toEqual(
      new Set(fullAccountUuidsBefore),
    );
    const cashBackOnA = await a.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account WHERE name = 'Cash'`,
    );
    expect(cashBackOnA!.c).toBe(1);

    expect(await outboxCount(a)).toBe(0);
    const conflictsAfter = await a.driver.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sync_apply_conflicts`,
    );
    expect(conflictsAfter!.c).toBe(0);

    const serverMax = await server.createDeviceTransport('probe').currentSeq();
    const cursorRow = await a.driver.get<{ value: string }>(
      `SELECT value FROM sync_state WHERE key = 'cursor'`,
    );
    expect(Number(cursorRow!.value)).toBe(serverMax);

    a.db.close();
    b.db.close();
  });

  it('(x) real incident: migration 034 — a pulled invoice\'s true createdAt/updatedAt survive apply verbatim, on both a fresh INSERT and a re-delivered UPDATE, so the "Edited" pill never lights up for a row that was only ever created', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    const b = await makeDevice('deviceB', server.createDeviceTransport('B'));

    await seedChart(a);
    // Same InvoiceService fixture scenario (e) uses.
    await insertAccount(a, 'Sale', 'Revenue');
    await insertAccount(a, 'Purchase', 'Expense');
    const partyId = await insertAccount(a, 'Customer', 'Current Asset');
    await a.pricing.insertItemType('General');
    const itemTypeRow = await a.driver.get<{ id: number }>(
      `SELECT id FROM item_types WHERE name = 'General'`,
    );
    await a.pricing.setPrimaryItemType(itemTypeRow!.id);
    await a.driver.run(
      `INSERT INTO inventory (name, description, price, quantity, itemTypeId) VALUES (@name, NULL, @price, @quantity, @itemTypeId)`,
      { name: 'Widget', price: 50, quantity: 100, itemTypeId: itemTypeRow!.id },
    );
    const inventoryRow = await a.driver.get<{ id: number }>(
      `SELECT id FROM inventory WHERE name = 'Widget'`,
    );

    const items: InvoiceItem[] = [
      {
        id: 1,
        inventoryId: inventoryRow!.id,
        quantity: 2,
        discount: 0,
        price: 50,
        discountedPrice: 100,
      },
    ];
    const invoice: Invoice = {
      id: -1,
      invoiceType: 'Sale' as InvoiceType,
      date: new Date('2026-01-01T12:00:00.000Z').toISOString(),
      invoiceNumber: 8001,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      totalAmount: 100,
      biltyNumber: '',
      cartons: 0,
      accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
      invoiceItems: items,
    };
    const { invoiceId } = await a.invoices.insertInvoice(
      'Sale' as InvoiceType,
      invoice,
    );
    const invoiceUuid = (await a.driver.get<{ uuid: string }>(
      `SELECT uuid FROM invoices WHERE id = @id`,
      { id: invoiceId },
    ))!.uuid;

    // Migration 029's insert-capture trigger already put A's real
    // createdAt/updatedAt into A's outbox (whatever A's own local clock
    // stamped at insert time — real, but not a fixed value a test can
    // assert against, and not the point of this scenario). Overwritten
    // here, directly on the already-captured JSON — never on the physical
    // `invoices` row itself, which stays whatever A's own trigger stamped
    // and is irrelevant to this scenario — to a fixed, EQUAL OLD_TS pair:
    // the simplest way to make the row image genuinely, deterministically
    // carry "created and never edited, a long time ago", the exact shape
    // that must survive a pull unchanged. There is exactly one outbox row
    // for this invoice at this point (one INSERT, nothing else has touched
    // it yet).
    const OLD_TS = '2020-01-01 09:00:00';
    const outboxRow = await a.driver.get<{ id: number; rowJson: string }>(
      `SELECT id, rowJson FROM sync_outbox WHERE tableName = 'invoices' AND rowUuid = @uuid`,
      { uuid: invoiceUuid },
    );
    expect(outboxRow).toBeDefined();
    const patchedJson = JSON.stringify({
      ...(JSON.parse(outboxRow!.rowJson) as Record<string, unknown>),
      createdAt: OLD_TS,
      updatedAt: OLD_TS,
    });
    await a.driver.run(
      `UPDATE sync_outbox SET rowJson = @rowJson WHERE id = @id`,
      {
        rowJson: patchedJson,
        id: outboxRow!.id,
      },
    );

    await a.engine.syncOnce();
    await b.engine.syncOnce();

    const onBAfterFirstPull = await b.driver.get<{
      createdAt: string;
      updatedAt: string;
    }>(`SELECT createdAt, updatedAt FROM invoices WHERE uuid = @uuid`, {
      uuid: invoiceUuid,
    });
    // The point of the INSERT half of this scenario: B's physical row gets
    // A's row image verbatim, not B's own apply-time clock — pre-034, the
    // ON INSERT branch's after_insert_invoices_add_timestamp trigger would
    // have unconditionally overwritten both columns to B's "now" here.
    expect(onBAfterFirstPull!.createdAt).toBe(OLD_TS);
    expect(onBAfterFirstPull!.updatedAt).toBe(OLD_TS);
    // The "Edited" pill's own predicate (updatedAt > createdAt —
    // src/renderer/lib/invoiceUtils.ts) must read false for a row that was
    // only ever created.
    expect(onBAfterFirstPull!.updatedAt > onBAfterFirstPull!.createdAt).toBe(
      false,
    );

    // Re-delivery: the SAME row image (same rowUuid, same unchanged
    // createdAt/updatedAt), queued into A's outbox a second time under a
    // fresh idempotency key — modeling a redelivered/duplicate pull, an
    // overlapping sync cycle, or a peer's echo (see SyncEngine's "Echo
    // suppression" doc comment for why this can legitimately happen).
    // Direct sync_outbox insertion, not a real second local write, is
    // deliberate here: a real UPDATE on A would let A's own (unsuppressed,
    // local-write) after_update trigger assign a genuinely-new "now"
    // timestamp, which would only prove createdAt/updatedAt CHANGED, not
    // that a truly UNCHANGED redelivery stays a true no-op — the sharper,
    // and actually incident-accurate, assertion this second half exists
    // for. B already has this uuid locally, so this drives applyRow's
    // `ON CONFLICT("uuid") DO UPDATE` branch, not the INSERT branch —
    // exactly migration 034's doc comment's point 2.
    await a.driver.run(
      `INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
       VALUES (@key, 'invoices', @uuid, 'put', @rowJson, datetime('now'))`,
      {
        key: `redelivery:${invoiceUuid}`,
        uuid: invoiceUuid,
        rowJson: patchedJson,
      },
    );
    await a.engine.syncOnce();
    await b.engine.syncOnce();

    const onBAfterRedelivery = await b.driver.get<{
      createdAt: string;
      updatedAt: string;
    }>(`SELECT createdAt, updatedAt FROM invoices WHERE uuid = @uuid`, {
      uuid: invoiceUuid,
    });
    // The point of the UPDATE half, and of this whole scenario: pre-034,
    // B's own after_update_invoices_add_timestamp trigger would have
    // unconditionally bumped updatedAt to B's OWN apply-time clock here —
    // well past OLD_TS, and past createdAt — exactly the field bug ("every
    // invoice shows Edited" on a device that just joined a sync project).
    // Post-034, the row image's own updatedAt is what sticks.
    expect(onBAfterRedelivery!.createdAt).toBe(OLD_TS);
    expect(onBAfterRedelivery!.updatedAt).toBe(OLD_TS);
    expect(onBAfterRedelivery!.updatedAt > onBAfterRedelivery!.createdAt).toBe(
      false,
    );

    a.db.close();
    b.db.close();
  });

  it('(y) repairInvoiceEditedTimestamps equalizes a locally-stomped invoice without enqueueing an outbox row', async () => {
    const server = new MockSyncServer();
    const a = await makeDevice('deviceA', server.createDeviceTransport('A'));
    await seedChart(a);
    await insertAccount(a, 'Sale', 'Revenue');
    await insertAccount(a, 'Purchase', 'Expense');
    const partyId = await insertAccount(a, 'Customer', 'Current Asset');
    await a.pricing.insertItemType('General');
    const itemTypeRow = await a.driver.get<{ id: number }>(
      `SELECT id FROM item_types WHERE name = 'General'`,
    );
    await a.pricing.setPrimaryItemType(itemTypeRow!.id);
    await a.driver.run(
      `INSERT INTO inventory (name, description, price, quantity, itemTypeId) VALUES (@name, NULL, @price, @quantity, @itemTypeId)`,
      { name: 'Widget', price: 50, quantity: 100, itemTypeId: itemTypeRow!.id },
    );
    const inventoryRow = await a.driver.get<{ id: number }>(
      `SELECT id FROM inventory WHERE name = 'Widget'`,
    );
    const { invoiceId } = await a.invoices.insertInvoice(
      'Sale' as InvoiceType,
      {
        id: -1,
        invoiceType: 'Sale' as InvoiceType,
        date: new Date('2026-01-01T12:00:00.000Z').toISOString(),
        invoiceNumber: 8002,
        extraDiscount: 0,
        extraDiscountAccountId: undefined,
        totalAmount: 50,
        biltyNumber: '',
        cartons: 0,
        accountMapping: { singleAccountId: partyId, multipleAccountIds: [] },
        invoiceItems: [
          {
            id: 1,
            inventoryId: inventoryRow!.id,
            quantity: 1,
            discount: 0,
            price: 50,
            discountedPrice: 50,
          },
        ],
      },
    );

    await a.driver.run(`DELETE FROM sync_outbox`);
    await a.driver.run(
      `INSERT INTO sync_state (key, value) VALUES ('applying', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    await a.driver.run(
      `UPDATE invoices
       SET createdAt = '2020-01-01 09:00:00',
           updatedAt = '2024-06-15 12:00:00'
       WHERE id = @id`,
      { id: invoiceId },
    );
    await a.driver.run(`DELETE FROM sync_state WHERE key = 'applying'`);

    const before = await a.driver.get<{ createdAt: string; updatedAt: string }>(
      `SELECT createdAt, updatedAt FROM invoices WHERE id = @id`,
      { id: invoiceId },
    );
    expect(
      before!.updatedAt.slice(0, 10) > before!.createdAt.slice(0, 10),
    ).toBe(true);

    const changed = await repairInvoiceEditedTimestamps(a.driver);
    expect(changed).toBe(1);

    const after = await a.driver.get<{ createdAt: string; updatedAt: string }>(
      `SELECT createdAt, updatedAt FROM invoices WHERE id = @id`,
      { id: invoiceId },
    );
    expect(after!.createdAt).toBe('2020-01-01 09:00:00');
    expect(after!.updatedAt).toBe('2020-01-01 09:00:00');
    expect(await outboxCount(a)).toBe(0);

    a.db.close();
  });
});
