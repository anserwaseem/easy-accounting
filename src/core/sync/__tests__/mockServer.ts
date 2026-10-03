import type {
  LogRow,
  OutboxEntry,
  PushResult,
  SyncTransport,
} from '../transport';

/**
 * In-process reference implementation of the server half of the sync
 * protocol, for exercising `SyncEngine` end-to-end without a real backend.
 * One `MockSyncServer` instance is "one business's" append-only change log;
 * each simulated device gets its own {@link SyncTransport} via
 * {@link MockSyncServer.createDeviceTransport}, all bound to the same
 * shared log/seq counter — exactly the shape the real (Supabase, later
 * increment) server presents: one Postgres table per business, one
 * monotonic `seq`, many devices pushing/pulling against it concurrently.
 *
 * What this reference implementation actually guarantees, matching the
 * protocol design document:
 *   - **Strict serialization**: every `push`/`pull` call across every
 *     device transport is queued through one promise chain
 *     ({@link MockSyncServer.serialize}), so two devices "pushing at the
 *     same time" (e.g. via `Promise.all`) never interleave — the same
 *     guarantee a real server gets from a per-business Postgres advisory
 *     lock around the push handler.
 *   - **Seq assignment**: every accepted entry gets the next integer in one
 *     global counter, assigned in the order entries are processed —
 *     never reused, never assigned out of order.
 *   - **Idempotency-key dedup**: pushing the exact same `idempotencyKey`
 *     twice (a client retry after a dropped response, the exact scenario
 *     idempotency keys exist for) is a no-op the second time — no second
 *     log row, no second `seq` consumed — while still reporting the entry
 *     as accepted (a retry succeeding silently is the point; the caller
 *     should not have to distinguish "accepted just now" from "already
 *     accepted").
 *   - **Per-batch atomicity**: a `push` call either records every new
 *     entry in the batch or (on a thrown error) records none of them —
 *     there is no code path that appends part of a batch. Nothing in this
 *     reference implementation currently throws mid-batch, but the
 *     property holds by construction (the whole batch is processed inside
 *     one synchronous callback on the serialization queue).
 *   - **Causality-preserving log order**: log rows are appended in exactly
 *     the order their entries appear across pushed batches, and `pull`
 *     returns them in that same (ascending `seq`) order. Combined with
 *     `SyncEngine` always draining its own outbox in insertion order (see
 *     SyncEngine's doc comment), this is what makes "a parent row's log
 *     entry always precedes its children's" hold in these tests.
 *   - **Own-device row exclusion on pull**: exactly like
 *     {@link ../SupabaseSyncTransport.pull}'s `device_id=neq.<deviceId>`
 *     PostgREST filter — mock and real must stay equivalent here, since a
 *     test asserting "zero own rows transferred" against this mock is only
 *     meaningful if the real transport is proven (by its own doc comment
 *     and the integration test) to filter identically. See
 *     {@link servedRowCount} for the per-device instrumentation this
 *     enables tests to assert egress savings with.
 *
 * What this reference implementation deliberately does **not** do —
 * explicitly Phase-3 (real) server work, not an oversight:
 *   - **No validation/refereeing of pushed rows at all.** A real server
 *     needs to at minimum check a pushed row's shape against the schema it
 *     expects, and eventually referee genuine conflicts (e.g. two devices
 *     editing the same row while both offline) — this mock accepts
 *     anything with a well-formed `OutboxEntry` shape unconditionally.
 *     `rejected` is therefore always empty here; `SyncEngine`'s
 *     `sync_rejected` handling exists and is exercised structurally (see
 *     its own tests) but this mock never actually populates it.
 *   - **No auth/business-scoping.** One `MockSyncServer` instance already
 *     models "one business," so there is nothing here enforcing that only
 *     devices belonging to that business can push/pull against it — a real
 *     server obviously must.
 *   - **No persistence.** The log lives in a plain in-memory array for the
 *     lifetime of the instance.
 */
export class MockSyncServer {
  private log: LogRow[] = [];

  private seq = 0;

  /** idempotencyKey -> seq it was (first) recorded at, for dedup. */
  private readonly seenIdempotencyKeys = new Map<string, number>();

  /**
   * Test-only instrumentation: total log rows actually returned (i.e. that
   * would have crossed the wire against a real server) to each device's
   * `pull`, across every call against this instance — the mock-side stand-in
   * for "egress." Keyed by the same `deviceId` string passed to
   * {@link createDeviceTransport}. See {@link servedRowCount}.
   */
  private readonly servedRowCounts = new Map<string, number>();

  private queue: Promise<unknown> = Promise.resolve();

  /** Runs `fn` after every previously-queued call has settled — the advisory-lock stand-in described in this class's doc comment. */
  private serialize<T>(fn: () => T): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** A `SyncTransport` bound to one simulated device, sharing this server's one log/seq counter with every other device's transport. */
  createDeviceTransport(deviceId: string): SyncTransport {
    return {
      push: (batch) => this.push(deviceId, batch),
      pull: (afterSeq, limit, opts) =>
        this.pull(deviceId, afterSeq, limit, opts),
      currentSeq: () => this.serialize<number>(() => this.seq),
    };
  }

  /** Total log rows recorded so far — test-only introspection, not part of {@link SyncTransport}. */
  get logLength(): number {
    return this.log.length;
  }

  /**
   * Test-only: total rows this device's `pull` has ever actually been
   * handed back, across every call — i.e. rows that, against a real server,
   * would have been transferred as egress. Own-device rows are excluded
   * before this count is incremented (see {@link pull}), so this is exactly
   * the number to assert stays flat (relative to a would-be-unfiltered
   * baseline) when a device pulls a backlog dominated by its own rows.
   * Returns 0 for a device that never called `pull` (as well as one that
   * did but was only ever handed empty pages) — both are indistinguishable
   * here on purpose, since neither transferred anything.
   */
  servedRowCount(deviceId: string): number {
    return this.servedRowCounts.get(deviceId) ?? 0;
  }

  /**
   * Test-only: simulates the server-side log being wiped — the real-world
   * incident `SyncEngine`'s epoch-reset detection exists for (e.g. a real
   * Postgres `TRUNCATE sync_log RESTART IDENTITY` run against a polluted
   * project). Resets the log, the seq counter, and idempotency-key dedup
   * state back to a blank server, exactly as if this `MockSyncServer`
   * instance had just been constructed. Every device transport already
   * created against this instance keeps working afterward — they all share
   * this same mutable state, not a snapshot of it.
   */
  wipe(): void {
    this.log = [];
    this.seq = 0;
    this.seenIdempotencyKeys.clear();
  }

  private push(deviceId: string, batch: OutboxEntry[]): Promise<PushResult> {
    return this.serialize<PushResult>(() => {
      for (const entry of batch) {
        if (this.seenIdempotencyKeys.has(entry.idempotencyKey)) {
          // Already recorded by a prior (possibly retried) push — idempotent no-op.
          continue;
        }
        this.seq += 1;
        this.log.push({
          seq: this.seq,
          tableName: entry.tableName,
          rowUuid: entry.rowUuid,
          op: entry.op,
          rowJson: entry.rowJson,
          deviceId,
        });
        this.seenIdempotencyKeys.set(entry.idempotencyKey, this.seq);
      }
      return { accepted: batch.length, rejected: [], newSeq: this.seq };
    });
  }

  /**
   * `deviceId`'s own rows (`row.deviceId === deviceId`) are excluded before
   * the `limit` slice — the mock-side mirror of
   * {@link ../SupabaseSyncTransport.pull}'s `device_id=neq.<deviceId>`
   * PostgREST filter; see that method's doc comment for why. Every row
   * actually handed back here is counted into {@link servedRowCounts} for
   * `deviceId` — the test-only "egress" instrumentation {@link
   * servedRowCount} exposes.
   *
   * `opts.includeSelf` mirrors {@link ../SupabaseSyncTransport.ts}'s
   * `pull` option of the same name exactly: when true, the
   * `row.deviceId !== deviceId` half of the filter below is skipped, so
   * `deviceId`'s own rows come back like any other device's — the mock-side
   * counterpart of `SyncEngine.rebuildFromServer`'s one legitimate need to
   * pull its own previously-pushed rows back after wiping its local copies.
   * Own rows returned this way still count toward {@link servedRowCounts}
   * like any other served row (a rebuild's re-download is real "egress"
   * too, just a deliberate, one-time exception rather than the steady-state
   * waste the default filtering exists to avoid).
   */
  private pull(
    deviceId: string,
    afterSeq: number,
    limit: number,
    opts?: { includeSelf?: boolean },
  ): Promise<LogRow[]> {
    return this.serialize<LogRow[]>(() => {
      const page = this.log
        .filter(
          (row) =>
            row.seq > afterSeq &&
            (opts?.includeSelf || row.deviceId !== deviceId),
        )
        .slice(0, limit);
      if (page.length > 0) {
        this.servedRowCounts.set(
          deviceId,
          (this.servedRowCounts.get(deviceId) ?? 0) + page.length,
        );
      }
      return page;
    });
  }
}
