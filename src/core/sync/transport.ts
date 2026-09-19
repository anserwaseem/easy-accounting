/**
 * The client-side sync transport port. Platform- and backend-free by
 * design: `SyncEngine` (./SyncEngine.ts) depends only on this interface, so
 * the real implementation (Supabase, in a later increment) and the
 * in-process `MockSyncServer` (./`__tests__`/mockServer.ts) are
 * interchangeable, and nothing in `src/core` ever imports a Supabase client.
 *
 * Matches the sync protocol design this ships against: a per-business
 * append-only change log on the server with a strictly-ordered `seq`, and a
 * client outbox of local mutations identified by idempotency keys.
 * `push`/`pull` are this device's only two verbs against that server.
 */

/** One outbox row, ready to send — the shape `SyncEngine` reads out of `sync_outbox` (migration 029). */
export interface OutboxEntry {
  idempotencyKey: string;
  tableName: string;
  rowUuid: string;
  op: 'put' | 'delete';
  /** Full row image (see migration 029's capture triggers), JSON-encoded. */
  rowJson: string;
}

/** One rejected entry from a `push` call, identified by the idempotency key the client sent. */
export interface PushRejection {
  idempotencyKey: string;
  reason: string;
}

export interface PushResult {
  /** Count of entries the server accepted (including ones already accepted on a prior, retried attempt — pushing is idempotent). */
  accepted: number;
  rejected: PushRejection[];
  /** The log's highest `seq` after this push landed. */
  newSeq: number;
}

/** One row of the server's append-only change log, as returned by `pull`. */
export interface LogRow {
  seq: number;
  tableName: string;
  rowUuid: string;
  op: 'put' | 'delete';
  rowJson: string;
  /** Which device originally pushed this row — informational today; see MockSyncServer's doc comment for how a real server might use it. */
  deviceId: string;
}

export interface SyncTransport {
  /** Sends one batch of outbox entries. Safe to retry verbatim on failure — the server dedupes by `idempotencyKey`. */
  push(batch: OutboxEntry[]): Promise<PushResult>;

  /**
   * Fetches up to `limit` log rows with `seq > afterSeq`, in ascending `seq`
   * order (which preserves causal/insertion order — see SyncEngine's doc
   * comment).
   *
   * `opts.includeSelf` defaults to (and is equivalent to) `false`: both
   * transports this interface ships against ({@link ../SupabaseSyncTransport.ts}
   * and {@link ./__tests__/mockServer.ts}'s `MockSyncServer`) exclude this
   * device's own previously-pushed rows server-side (`device_id <> self`) —
   * see `SupabaseSyncTransport.pull`'s doc comment for the egress incident
   * that filter exists to fix. That's the right default for steady-state
   * sync (`SyncEngine.syncOnce`/`initialPull`): a device never needs its own
   * rows echoed back, since it already has them locally.
   *
   * `SyncEngine.rebuildFromServer` is the one caller that passes
   * `includeSelf: true`, and it is the one case where that default is
   * actively wrong: it has just DELETED this device's local copy of every
   * replicated table, so "my own rows" are no longer redundant with
   * anything local — they're exactly the data being rebuilt. Filtering them
   * out here, in that one case, would silently hollow out a device that
   * pushed most of a business's log (e.g. the device that originally seeded
   * it) down to whatever fraction of the log belongs to OTHER devices. See
   * `SyncEngine.rebuildFromServer`'s doc comment for the full incident this
   * option was added for.
   */
  pull(
    afterSeq: number,
    limit: number,
    opts?: { includeSelf?: boolean },
  ): Promise<LogRow[]>;

  /**
   * The log's current highest `seq` (0 if the log is empty). A cheap,
   * read-only probe — no rows are fetched, just the watermark — that
   * `SyncEngine` uses to detect a "sync epoch reset": this device's stored
   * `sync_state.cursor` coming back *greater than* the server's own max
   * `seq`, which can only happen if the server's log was wiped/reset since
   * this device last synced (e.g. a real Postgres `TRUNCATE sync_log
   * RESTART IDENTITY` on the backing table) — `pull(cursor, 1)` coming back
   * empty is ambiguous (could mean "nothing new" OR "log reset out from
   * under you"), whereas comparing against this watermark is not. See
   * `SyncEngine.pullAndApply`'s doc comment for the recovery this enables.
   */
  currentSeq(): Promise<number>;
}
