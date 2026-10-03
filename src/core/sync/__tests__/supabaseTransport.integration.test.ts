/**
 * @jest-environment node
 */
/**
 * ============================================================================
 * DO NOT point this suite at a shared Supabase project that holds real
 * business data. The project this suite targets today (via SUPABASE_URL /
 * SUPABASE_ANON_KEY) now holds the OWNER'S REAL synced data — it must not be
 * written to by this suite, by any other test run, or by anything else that
 * isn't the owner's own devices. This file's own tests only ever touch a
 * throwaway `integration_test_probe` "table" (a `tableName` string in
 * `sync_log` rows, not a real schema table) and randomly-generated
 * business-fact rows scoped to fresh random uuids (see the isolation
 * strategy in this file's own doc comment and in ./convergenceScenarios.ts),
 * which is exactly the kind of pollution that caused Issue 1's real
 * incident (a client crashing on a log row for a table it didn't know
 * about) — do not run this suite against SUPABASE_URL/SUPABASE_ANON_KEY
 * unless you are certain the target project is a disposable test project,
 * never the owner's real one.
 * ============================================================================
 *
 * Live integration test for {@link ../SupabaseSyncTransport} against a real
 * Supabase project (server side: `supabase/setup.sql` at the repo root).
 * Two things this suite proves that unit tests against `MockSyncServer`
 * (./mockServer.ts) cannot:
 *   (i) `SupabaseSyncTransport` actually speaks PostgREST correctly — real
 *       HTTP, real headers, real JSON shapes on the wire, mapped onto
 *       exactly what `SyncEngine` expects (see transport.ts's PushResult).
 *   (ii) the full convergence story (scenarios (a), (b), (e) from
 *       ./convergenceScenarios.ts, shared verbatim with SyncEngine.test.ts)
 *       holds against `sync_push`/`sync_log` as actually specified in
 *       `supabase/setup.sql`, not just against the in-process reference.
 *
 * ## Skip conditions
 *
 * This suite needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the
 * environment (a real, reachable Supabase project) AND that project must
 * already have `supabase/setup.sql` applied (via the Supabase SQL Editor —
 * there is no programmatic DDL path available to an anon key, by design).
 * Either condition failing prints a loud console message explaining
 * exactly what's missing and `describe.skip`s the whole file — this file
 * intentionally never *fails* for either reason, only skips, so it's safe
 * to run in a CI/dev environment that has neither configured.
 *
 * The env-var check is synchronous. The "is setup.sql applied" check is
 * not — normally that would mean an unavoidable `await` before deciding
 * `describe` vs `describe.skip`, but Jest registers `describe` blocks
 * synchronously when a test file loads, and this file compiles as
 * CommonJS (no top-level `await` available). {@link probeSetup} works
 * around that by shelling out to a short-lived `node -e` child process
 * that performs the two async `fetch` probes and reports back over stdout
 * as one blocking `execFileSync` call — a synchronous HTTP probe, in
 * effect, using Node's own `fetch` rather than an extra dependency.
 *
 * ## Isolation against the shared/disposable test project
 *
 * See ./convergenceScenarios.ts's doc comment for the full strategy
 * (cursor-seeding + uuid-keyed convergence assertions). This file's own
 * direct transport-level tests (section 1 below) use the same
 * `currentSeq()`-then-compare-only-what-we-just-pushed approach, plus
 * fresh random idempotency keys per run (`crypto.randomUUID()`), so
 * re-running this file against the same live project never needs manual
 * cleanup.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  SupabaseSyncTransport,
  TransportError,
} from '../SupabaseSyncTransport';

import type { OutboxEntry } from '../transport';
import {
  scenarioA,
  scenarioB,
  scenarioE,
  type ScenarioTransportFactory,
} from './convergenceScenarios';

const fetchImpl = fetch;

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

const { SUPABASE_URL } = process.env;
const { SUPABASE_ANON_KEY } = process.env;

interface ProbeResult {
  tableOk: boolean;
  functionOk: boolean;
  tableStatus: number;
  tableBody: string;
  functionStatus: number;
  functionBody: string;
  spawnError?: string;
}

/**
 * Synchronously (see this file's header comment on why) checks whether
 * `supabase/setup.sql` has been applied to `url`: a `select` probe against
 * `sync_log` and a harmless `sync_push` call with an empty `mutations`
 * array (no side effects either way — an empty batch is a no-op per
 * `supabase/setup.sql`'s `sync_push`). Both must succeed (2xx) for the
 * project to be considered ready.
 *
 * A `tableStatus`/`functionStatus` of `0` means the request never got an
 * HTTP response at all (DNS/TLS/network failure — see `spawnError`-shaped
 * detail folded into `tableBody`/`functionBody`), which reads the same as
 * "not applied" here on purpose: either way, this suite has nothing to run
 * against.
 */
function probeSetup(url: string, anonKey: string): ProbeResult {
  const base = url.replace(/\/+$/, '');
  const script = `
    (async () => {
      const base = ${JSON.stringify(base)};
      const anonKey = ${JSON.stringify(anonKey)};
      const fetch = globalThis.fetch;
      const headers = { apikey: anonKey, Authorization: 'Bearer ' + anonKey };
      const out = {};
      const describeErr = (err) => {
        const causeMsg = err && err.cause && err.cause.message ? ' (cause: ' + err.cause.message + ')' : '';
        return String(err && err.message ? err.message : err) + causeMsg;
      };
      try {
        const tableRes = await fetch(base + '/rest/v1/sync_log?select=seq&limit=1', { headers });
        out.tableStatus = tableRes.status;
        out.tableBody = await tableRes.text();
      } catch (err) {
        out.tableStatus = 0;
        out.tableBody = describeErr(err);
      }
      try {
        const fnRes = await fetch(base + '/rest/v1/rpc/sync_push', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
          body: JSON.stringify({ mutations: [] }),
        });
        out.functionStatus = fnRes.status;
        out.functionBody = await fnRes.text();
      } catch (err) {
        out.functionStatus = 0;
        out.functionBody = describeErr(err);
      }
      process.stdout.write(JSON.stringify(out));
    })();
  `;
  try {
    const stdout = execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      timeout: 20000,
    });
    const parsed = JSON.parse(stdout) as {
      tableStatus: number;
      tableBody: string;
      functionStatus: number;
      functionBody: string;
    };
    return {
      tableOk: parsed.tableStatus >= 200 && parsed.tableStatus < 300,
      functionOk: parsed.functionStatus >= 200 && parsed.functionStatus < 300,
      ...parsed,
    };
  } catch (err) {
    return {
      tableOk: false,
      functionOk: false,
      tableStatus: 0,
      tableBody: '',
      functionStatus: 0,
      functionBody: '',
      spawnError: err instanceof Error ? err.message : String(err),
    };
  }
}

function loud(lines: string[]): void {
  const bar = '='.repeat(78);
  console.warn(['', bar, ...lines, bar, ''].join('\n'));
}

let skipReason: string | undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  skipReason =
    'SUPABASE_URL and/or SUPABASE_ANON_KEY are not set in the environment.';
  loud([
    'SKIPPING supabaseTransport.integration.test.ts',
    skipReason,
    'This is expected in the default test run — this suite only runs against',
    'a real Supabase test project. To run it: source the env file with',
    'SUPABASE_URL and SUPABASE_ANON_KEY set, then re-run this test file.',
  ]);
} else {
  const probe = probeSetup(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!probe.tableOk || !probe.functionOk) {
    skipReason = `supabase/setup.sql has not been applied to this project yet (or is incomplete) — sync_log select returned ${
      probe.tableStatus
    }, sync_push RPC returned ${probe.functionStatus}${
      probe.spawnError ? `, probe error: ${probe.spawnError}` : ''
    }.`;
    loud([
      'SKIPPING supabaseTransport.integration.test.ts',
      skipReason,
      '',
      'ACTION NEEDED: apply supabase/setup.sql in the SQL editor first.',
      '  1. Open this Supabase project in the dashboard → SQL Editor.',
      '  2. Paste the entire contents of supabase/setup.sql (repo root).',
      '  3. Run it. It is idempotent — safe to paste again later too.',
      '  4. Re-run this test file with SUPABASE_URL / SUPABASE_ANON_KEY set.',
      '',
      `sync_log select probe:  HTTP ${
        probe.tableStatus
      }  ${probe.tableBody.slice(0, 300)}`,
      `sync_push RPC probe:    HTTP ${
        probe.functionStatus
      }  ${probe.functionBody.slice(0, 300)}`,
    ]);
  }
}

const describeLive = skipReason ? describe.skip : describe;

describeLive('SupabaseSyncTransport (live Supabase project)', () => {
  const url = SUPABASE_URL as string;
  const anonKey = SUPABASE_ANON_KEY as string;

  /**
   * Current max `seq` in the live log, via a throwaway probe transport — see
   * convergenceScenarios.ts's doc comment on why every scenario needs this
   * against a shared/disposable server. Delegates to
   * `SupabaseSyncTransport.currentSeq` (the same `SyncTransport.currentSeq`
   * port method `SyncEngine`'s epoch-reset detection calls in production)
   * rather than hand-rolling the same PostgREST query a second time here.
   */
  function currentSeq(): Promise<number> {
    return new SupabaseSyncTransport({
      url,
      anonKey,
      fetchImpl,
      deviceId: 'seq-probe',
    }).currentSeq();
  }

  function supabaseFactory(): ScenarioTransportFactory {
    return {
      createDeviceTransport: (deviceId: string) =>
        new SupabaseSyncTransport({ url, anonKey, fetchImpl, deviceId }),
      currentSeq,
    };
  }

  // -------------------------------------------------------------------
  // 1. Direct transport round-trip: push, pull, idempotency.
  // -------------------------------------------------------------------
  describe('push/pull/idempotency round-trip', () => {
    it('pushes a batch, dedups a verbatim retry, and a DIFFERENT device pulls it back unchanged', async () => {
      // Two distinct deviceIds: `pull` now excludes the pulling device's
      // OWN rows server-side (`device_id=neq.<deviceId>` — see
      // SupabaseSyncTransport.pull's doc comment for why), so proving
      // "what got pushed comes back on a pull" requires pulling as a
      // *different* device than the one that pushed — exactly the shape a
      // real second device joining/syncing has, and the shape this whole
      // fix targets (a device's own rows are the ones that must NOT come
      // back on ITS OWN pull).
      const pusher = new SupabaseSyncTransport({
        url,
        anonKey,
        fetchImpl,
        deviceId: 'integration-pusher',
      });
      const puller = new SupabaseSyncTransport({
        url,
        anonKey,
        fetchImpl,
        deviceId: 'integration-puller',
      });
      const startCursor = await currentSeq();
      const runId = randomUUID();

      const batch: OutboxEntry[] = [
        {
          idempotencyKey: randomUUID(),
          tableName: 'integration_test_probe',
          rowUuid: randomUUID(),
          op: 'put',
          rowJson: JSON.stringify({ runId, seq: 1, note: 'first row' }),
        },
        {
          idempotencyKey: randomUUID(),
          tableName: 'integration_test_probe',
          rowUuid: randomUUID(),
          op: 'put',
          rowJson: JSON.stringify({ runId, seq: 2, note: 'second row' }),
        },
      ];

      const result1 = await pusher.push(batch);
      expect(result1.accepted).toBe(batch.length);
      expect(result1.rejected).toEqual([]);
      expect(result1.newSeq).toBeGreaterThanOrEqual(startCursor + batch.length);

      // Verbatim retry (simulated dropped response) — idempotent no-op:
      // still reports every entry accepted, but newSeq does not advance.
      const result2 = await pusher.push(batch);
      expect(result2.accepted).toBe(batch.length);
      expect(result2.rejected).toEqual([]);
      expect(result2.newSeq).toBe(result1.newSeq);

      const pulled = await puller.pull(startCursor, 100);
      expect(pulled).toHaveLength(batch.length);
      // ascending seq order
      expect(pulled.map((r) => r.seq)).toEqual(
        [...pulled.map((r) => r.seq)].sort((x, y) => x - y),
      );
      for (const entry of batch) {
        const row = pulled.find((r) => r.rowUuid === entry.rowUuid);
        expect(row).toBeDefined();
        expect(row!.tableName).toBe(entry.tableName);
        expect(row!.op).toBe(entry.op);
        expect(JSON.parse(row!.rowJson)).toEqual(JSON.parse(entry.rowJson));
        expect(row!.deviceId).toBe('integration-pusher');
      }

      // Nothing beyond what we just pushed.
      const empty = await puller.pull(result1.newSeq, 100);
      expect(empty).toEqual([]);

      // The pushing device's OWN pull, in contrast, never sees these rows
      // at all — this is the actual fix under test, not incidental to it.
      const ownPull = await pusher.pull(startCursor, 100);
      for (const entry of batch) {
        expect(ownPull.some((r) => r.rowUuid === entry.rowUuid)).toBe(false);
      }
    });

    it('a delete op round-trips with a null-ish row image, to a different device', async () => {
      const pusher = new SupabaseSyncTransport({
        url,
        anonKey,
        fetchImpl,
        deviceId: 'integration-pusher',
      });
      const puller = new SupabaseSyncTransport({
        url,
        anonKey,
        fetchImpl,
        deviceId: 'integration-puller',
      });
      const startCursor = await currentSeq();
      const entry: OutboxEntry = {
        idempotencyKey: randomUUID(),
        tableName: 'integration_test_probe',
        rowUuid: randomUUID(),
        op: 'delete',
        rowJson: JSON.stringify({ deleted: true }),
      };

      const result = await pusher.push([entry]);
      expect(result.accepted).toBe(1);

      const pulled = await puller.pull(startCursor, 10);
      const row = pulled.find((r) => r.rowUuid === entry.rowUuid);
      expect(row).toBeDefined();
      expect(row!.op).toBe('delete');
    });

    it("pull excludes the pulling device's own rows server-side (device_id=neq filter), the fix this whole suite exists for", async () => {
      const deviceId = `integration-own-row-${randomUUID()}`;
      const transport = new SupabaseSyncTransport({
        url,
        anonKey,
        fetchImpl,
        deviceId,
      });
      const startCursor = await currentSeq();
      const entry: OutboxEntry = {
        idempotencyKey: randomUUID(),
        tableName: 'integration_test_probe',
        rowUuid: randomUUID(),
        op: 'put',
        rowJson: JSON.stringify({ note: 'own-row exclusion probe' }),
      };

      const result = await transport.push([entry]);
      expect(result.accepted).toBe(1);
      expect(result.newSeq).toBeGreaterThan(startCursor);

      // This SAME device pulling from before its own push: the row it just
      // pushed must never come back — not merely be discarded client-side
      // after arriving, but never transferred at all.
      const ownPull = await transport.pull(startCursor, 100);
      expect(ownPull.find((r) => r.rowUuid === entry.rowUuid)).toBeUndefined();

      // A different device pulling the exact same range sees it normally —
      // proving the row really was written (this isn't "the push silently
      // failed"), and that the exclusion is specific to the OWN device_id,
      // not a general filter.
      const otherTransport = new SupabaseSyncTransport({
        url,
        anonKey,
        fetchImpl,
        deviceId: `${deviceId}-observer`,
      });
      const otherPull = await otherTransport.pull(startCursor, 100);
      const row = otherPull.find((r) => r.rowUuid === entry.rowUuid);
      expect(row).toBeDefined();
      expect(row!.deviceId).toBe(deviceId);
    });

    it('currentSeq reflects the log watermark before and after a push, matching pull-based expectations', async () => {
      const transport = new SupabaseSyncTransport({
        url,
        anonKey,
        fetchImpl,
        deviceId: 'integration-direct',
      });
      const before = await transport.currentSeq();
      const entry: OutboxEntry = {
        idempotencyKey: randomUUID(),
        tableName: 'integration_test_probe',
        rowUuid: randomUUID(),
        op: 'put',
        rowJson: JSON.stringify({ note: 'currentSeq probe row' }),
      };
      const result = await transport.push([entry]);
      const after = await transport.currentSeq();
      expect(after).toBe(result.newSeq);
      expect(after).toBeGreaterThan(before);
    });

    it('throws TransportError with the response status+body on a bad anon key', async () => {
      const transport = new SupabaseSyncTransport({
        url,
        anonKey: 'not-a-real-anon-key',
        fetchImpl,
        deviceId: 'integration-direct',
      });
      const err: unknown = await transport.pull(0, 1).then(
        () => undefined,
        (caught: unknown) => caught,
      );

      expect(err).toBeInstanceOf(TransportError);
      const transportErr = err as TransportError;
      expect(transportErr.status).toBeGreaterThanOrEqual(400);
      expect(transportErr.body.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------
  // 2. Full convergence suite, shared verbatim with SyncEngine.test.ts —
  //    same assertions, same scenario bodies, real Supabase transport.
  // -------------------------------------------------------------------
  describe('convergence (real backend)', () => {
    scenarioA(supabaseFactory);
    scenarioB(supabaseFactory);
    scenarioE(supabaseFactory);
  });
});
