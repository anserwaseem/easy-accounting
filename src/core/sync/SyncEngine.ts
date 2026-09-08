import type { DatabaseDriver } from '../db/driver';
import { SYNC_TABLES } from '../db/migrations/029_create_sync_tables';
import type { CoreLogger } from '../ports';
import { getCoreLogger } from '../ports';
import { INITIAL_CHARTS } from '../utils/constants';
import { repairInvoiceEditedTimestamps } from './repairInvoiceTimestamps';
import { seedOutboxFromLocalData } from './seedOutbox';
import type { LogRow, OutboxEntry, SyncTransport } from './transport';

/**
 * Single source of truth for "which tables does this client's apply path
 * know how to write." Re-exported from migration 029 (the same array its
 * capture triggers are generated from — see that file's doc comment) rather
 * than duplicated here, so the push side (what a capture trigger can
 * produce) and the apply side (what {@link SyncEngine.applyRow} will
 * accept) can never drift apart. See {@link SyncEngine.pullAndApply}'s doc
 * comment for why the apply path needs this at all.
 */
const SYNC_TABLE_SET: ReadonlySet<string> = new Set(SYNC_TABLES);

/** Local mirror of the `sync_outbox` row shape (migration 029). */
interface OutboxRow {
  id: number;
  idempotencyKey: string;
  tableName: string;
  rowUuid: string;
  op: 'put' | 'delete';
  rowJson: string;
}

interface ForeignKeyRef {
  from: string;
  table: string;
}

interface TableSchema {
  /** Every column PRAGMA table_info reports for this table, in this device's own schema — may differ from the row image's origin device (see applyRow's doc comment). */
  columns: string[];
  foreignKeys: ForeignKeyRef[];
}

export interface SyncReport {
  /** Outbox entries the server newly accepted this run (retried duplicates from a prior partial run are not re-counted — see push's doc comment). */
  pushed: number;
  /** Outbox entries the server rejected and that were moved to `sync_rejected`. */
  rejected: number;
  /** Log rows fetched from the server across all pull pages. */
  pulled: number;
  /** Log rows actually applied to local tables (== pulled - skippedUnknownTable - applyConflicts - discardedPlaceholderUsers - discardedPlaceholderCharts). */
  applied: number;
  /**
   * Log rows that were fetched, belonged to a known table, but whose
   * `applyRow` write threw — almost always a natural-key `UNIQUE`
   * constraint an uuid-keyed upsert can't detect (two independently-seeded
   * devices sharing a `users.username`, an `account(chartId, name, code)`,
   * etc — see `pullAndApply`'s doc comment for the full incident this
   * guards against). Each one is recorded in `sync_apply_conflicts` for
   * later human review; the cursor advances past it regardless — this
   * count is what makes that trade-off visible to a caller/UI rather than
   * silent.
   */
  applyConflicts: number;
  /**
   * Log rows fetched but never applied because `tableName` isn't in this
   * client's {@link SYNC_TABLES} allowlist — a stray/foreign row (e.g. an
   * unrelated integration-test table on a shared server) or a table a
   * *newer* server-side schema added that this (older) client doesn't know
   * about yet. Always safely skipped, never a crash — see
   * `pullAndApply`'s doc comment.
   */
  skippedUnknownTable: number;
  /** Distinct unknown table names encountered this run, for diagnostics — a subset of what was warn-logged (once per table per `syncOnce`). */
  unknownTables: string[];
  /**
   * `users` rows discarded (never written, never quarantined) because they
   * were someone else's NULL-credential boot placeholder arriving after
   * this device already has a real, credentialed user under that same
   * username — the "a real user beats a passwordless placeholder, never the
   * reverse" half of `applyRow`'s users-collision rule that resolves
   * silently rather than landing in `sync_apply_conflicts`. See `applyRow`'s
   * doc comment ("users.username collision") for the full rule, including
   * the mirror-image case (a local placeholder losing to an incoming real
   * user), which is NOT counted here — that case still writes a row (the
   * real user, after deleting the local placeholder), so it's counted in
   * `applied` like any other successfully-applied row, not here.
   */
  discardedPlaceholderUsers: number;
  /**
   * `chart` rows discarded (never written, never quarantined) because they
   * are the INITIAL_CHARTS scaffolding of a `users` placeholder ALREADY
   * discarded this same run via {@link discardedPlaceholderUsers} above —
   * the "second wave" of the boot-placeholder incident: a wedged device
   * pushed its passwordless placeholder generation (1 `users` row + 7
   * `chart` rows, FK-linked via `userId`) into the shared log more than
   * once before the capture-suppression fix (db.worker.ts's
   * `ensurePlaceholderDefaultUser`) shipped. Each such placeholder `users`
   * row is discarded on its own by the existing collision rule (see
   * `applyRow`'s "users.username collision" doc comment), but its 7 `chart`
   * children then have no local parent row to resolve their `userId_uuid`
   * FK-sibling against — without this counter/behavior they would fail
   * `applyRow`'s FK-resolution throw and land in `sync_apply_conflicts` as
   * pure junk (a scary "N rows need review" banner for scaffolding no one
   * ever needs to review). See `pullAndApply`'s "Second-generation boot
   * placeholders" doc comment for the exact rule and why a per-run
   * in-memory set is sufficient to catch every such child regardless of how
   * many placeholder generations landed in the log, or how far apart in it.
   *
   * Deliberately a SEPARATE counter from `discardedPlaceholderUsers` rather
   * than folded into it: that field's own doc comment is specifically
   * "`users` rows discarded", and keeping this one `chart`-scoped keeps
   * both counters individually accurate for a caller/UI that wants to
   * report exactly what kind of noise was silently cleaned up.
   */
  discardedPlaceholderCharts: number;
  /**
   * True if this run detected and recovered from a "sync epoch reset" —
   * this device's stored cursor was ahead of the server's own log, meaning
   * the server's log was wiped/reset since this device last synced. See
   * `pullAndApply`'s doc comment.
   */
  epochReset: boolean;
  /** This device's `sync_state.cursor` after this run. */
  cursor: number;
  /**
   * Local `sync_outbox` rows this run queued via {@link seedOutboxFromLocalData} —
   * 0 unless this run detected a server log that had gone empty (wiped/
   * truncated, whether alongside an epoch reset or not) while this device
   * itself holds business data and had nothing already pending in its own
   * outbox. See `pullAndApply`'s doc comment ("Re-seeding an emptied server
   * log") for exactly when this fires and why. `pushed`/`rejected` above
   * already include whatever this seeding round itself managed to push
   * within the same `syncOnce` (see that method's doc comment) — `seeded`
   * is reported separately so a caller/UI can distinguish "recovered from
   * an emptied server" from ordinary sync traffic.
   */
  seeded: number;
}

const DEFAULT_PUSH_BATCH_SIZE = 200;
const DEFAULT_PULL_PAGE_SIZE = 200;

/**
 * The `chart.name` values `INITIAL_CHARTS` (src/core/utils/constants.ts)
 * seeds for every fresh user — a boot placeholder's scaffolding (via
 * db.worker.ts's `ensurePlaceholderDefaultUser`) and a real registered
 * user's starter chart (via `Auth.service.ts`/`db.worker.ts`'s `register`)
 * both use this exact same list. Derived from the single source of truth
 * (never hand-duplicated here) so this set can never silently drift from
 * what actually gets seeded — see `prunePlaceholderConflicts`'s doc
 * comment for the one place this is consulted: telling "an
 * unresolvable-parent `chart` row that IS scaffolding" apart from "one that
 * might be a genuine user-created chart" when cleaning up stale
 * `sync_apply_conflicts` rows.
 */
const INITIAL_CHART_NAMES: ReadonlySet<string> = new Set(
  INITIAL_CHARTS.map((c) => c.name),
);

/**
 * Tables whose replicated identity is a natural key rather than (only) a
 * row's `uuid`, mapped to that key's column name. Every other replicated
 * table's identity IS its `uuid` — two devices independently creating "the
 * same" row (two accounts both named "Cash", say) are, by design, two
 * different rows that both survive. `settings` (migration 033 —
 * src/core/db/migrations/033_sync_settings.ts) is deliberately different:
 * there is meant to be exactly one row per `key` project-wide, so when two
 * devices each set `companyProfile.name` before ever syncing with each
 * other, the project must converge on ONE value, not end up with two rows
 * both claiming to be "the" company name (which is exactly what a plain
 * `uuid`-keyed upsert would produce — see `applyRow`'s doc comment for the
 * pre-step this map drives).
 *
 * A map (not a single hardcoded 'settings' check) so a future natural-key
 * replicated table only needs an entry here, not a copy of the pre-step
 * itself.
 */
const NATURAL_KEY_TABLES: ReadonlyMap<string, string> = new Map([
  ['settings', 'key'],
]);

/**
 * Apply failures that mean "this log row is a second copy of a business
 * already on this device" — a UNIQUE collision (same invoice number /
 * username / account code, different uuid) or an FK sibling that cannot
 * resolve because its parent was that second copy. Quarantining these
 * into `sync_apply_conflicts` is correct for a 2-row independent-seed
 * incident, but a join against a project whose log contains TWO full
 * imports produces 100k+ "needs review" rows and a Settings banner over
 * data the device already has. First copy wins; the incoming row is
 * dropped. Existing quarantined rows of this shape are pruned on the
 * next pull (see pruneDuplicateSeedConflicts).
 */
function isDuplicateSeedApplyError(message: string): boolean {
  return (
    /UNIQUE constraint failed/i.test(message) ||
    /cannot resolve \S+\.\S+_uuid/i.test(message)
  );
}

/**
 * Decodes an uppercase (or any-case) hex string — as produced by SQLite's
 * `hex()`, which migration 029's capture triggers use to encode a
 * declared-blob column's actual runtime blob value into a row image's
 * `<col>__hex` key (see that migration's `jsonObjectExpr` doc comment) —
 * into a `Uint8Array` of the original bytes. Written by hand rather than via
 * `Buffer.from(hex, 'hex')`: `src/core` is platform-free and cannot import
 * Node builtins (this same file already runs unmodified against
 * SQLite-wasm in a browser worker, which has no `Buffer`).
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Client-side sync engine: drains the local outbox to the server, then
 * pulls and applies the server's append-only log. Platform- and
 * backend-free — depends only on {@link DatabaseDriver} and the
 * {@link SyncTransport} port (../transport.ts), never on a concrete
 * transport implementation. See migration 029
 * (src/core/db/migrations/029_create_sync_tables.ts) for how rows get into
 * `sync_outbox` in the first place, and that file's doc comment for the
 * capture-trigger design this engine is the other half of.
 *
 * ## Apply ordering and the causality assumption
 *
 * `pull` fetches log rows in ascending `seq` order and applies them in that
 * same order, one page (transaction) at a time, advancing the local cursor
 * only after a page's transaction commits. This engine assumes — and does
 * not itself verify — that **the server's log never places a child row
 * before the parent row it references**: e.g. a `journal_entry` log row
 * always appears at a `seq` after the `journal` row it belongs to, an
 * `invoice_items` row after its `invoices` row, etc. That's true by
 * construction as long as (a) every device's own outbox is drained in
 * insertion order (guaranteed here — batches are read `ORDER BY id`, which
 * is the order the capture triggers appended them in, which is the order
 * the app's own transactions executed statements in) and (b) the server
 * assigns `seq` to a pushed batch's entries in the order they arrived in
 * the batch, never reordering within or across batches. (b) is a
 * requirement on the Phase-3 server this engine does not and cannot
 * enforce from the client; {@link ../__tests__/mockServer.ts} documents how
 * it upholds it as a reference. If it's ever violated, {@link applyRow}
 * throws a descriptive error identifying the missing parent rather than
 * silently writing a broken foreign key — see its doc comment.
 *
 * ## Echo suppression
 *
 * Every page's apply transaction sets `sync_state.applying = '1'` before
 * writing, and clears it before committing. Migration 029's capture
 * triggers are gated on that flag being unset, so applying a peer's row
 * (even a peer's row that happens to be a delayed echo of this very
 * device's own earlier push) never re-enters this device's outbox.
 */
export class SyncEngine {
  private readonly db: DatabaseDriver;

  private readonly transport: SyncTransport;

  private readonly logger: CoreLogger;

  private readonly pushBatchSize: number;

  private readonly pullPageSize: number;

  private readonly schemaCache = new Map<string, TableSchema>();

  constructor(deps: {
    db: DatabaseDriver;
    transport: SyncTransport;
    logger?: CoreLogger;
    pushBatchSize?: number;
    pullPageSize?: number;
  }) {
    this.db = deps.db;
    this.transport = deps.transport;
    this.logger = deps.logger ?? getCoreLogger();
    this.pushBatchSize = deps.pushBatchSize ?? DEFAULT_PUSH_BATCH_SIZE;
    this.pullPageSize = deps.pullPageSize ?? DEFAULT_PULL_PAGE_SIZE;
  }

  /**
   * Pushes this device's outbox, then pulls and applies the server's log —
   * see {@link pullAndApply}'s doc comment for the epoch-reset and
   * server-log-reseeding recovery this performs along the way.
   *
   * ## The extra drain after a reseed
   *
   * If `pullAndApply` reseeded the outbox (`seeded > 0` — an emptied server
   * log, this device holding business data worth re-uploading; see that
   * method's doc comment), the rows it just queued are still sitting
   * locally at this point: this method's own outbox drain already ran
   * *before* `pullAndApply`, so it can't have pushed rows `pullAndApply`
   * itself only just inserted. Without a second drain here, those rows
   * would sit unpushed until the *next* `syncOnce` — up to one full sync
   * interval (30s in production) of the server log staying empty even
   * though this device already did the work of re-populating its outbox.
   * Re-running the exact same {@link drainOutbox} used above (not a
   * separate code path) closes that gap: one `syncOnce` call both detects
   * the empty server and fully re-uploads to it, so a joining device's very
   * next pull already sees real data rather than having to wait an extra
   * cycle. `pushed`/`rejected` in the returned report are the SUM of both
   * drain rounds — a caller only ever needs "how much did this syncOnce
   * push in total," and `seeded` (reported separately) already tells it
   * whether a reseed happened at all.
   */
  async syncOnce(): Promise<SyncReport> {
    const firstDrain = await this.drainOutbox();
    const {
      pulled,
      applied,
      skippedUnknownTable,
      unknownTables,
      epochReset,
      applyConflicts,
      discardedPlaceholderUsers,
      discardedPlaceholderCharts,
      seeded,
    } = await this.pullAndApply();

    let { pushed, rejected } = firstDrain;
    if (seeded > 0) {
      const secondDrain = await this.drainOutbox();
      pushed += secondDrain.pushed;
      rejected += secondDrain.rejected;
    }

    const cursor = await this.getCursor();
    return {
      pushed,
      rejected,
      pulled,
      applied,
      skippedUnknownTable,
      unknownTables,
      epochReset,
      applyConflicts,
      discardedPlaceholderUsers,
      discardedPlaceholderCharts,
      seeded,
      cursor,
    };
  }

  /**
   * Pulls and applies the server's entire backlog against a device that has
   * never synced this project before — the "join existing sync" flow (see
   * apps/web/src/worker/syncManager.ts's `SyncManager.join`, the only other
   * caller besides this class's own tests). A thin, semantically-named
   * wrapper over the exact same {@link pullAndApply} `syncOnce` itself
   * calls — a fresh device's `sync_state.cursor` is already 0, so "pull
   * everything" and "pull whatever's new since my cursor" are the same
   * operation; naming it separately at this public boundary just makes the
   * join call site read like what it's for, rather than implying it also
   * drains an outbox (a brand-new device has nothing local worth pushing
   * yet — see the join flow's own doc comment on why it deliberately never
   * pushes).
   *
   * **This path can never trigger `pullAndApply`'s server-log-reseeding
   * recovery** (see that method's doc comment), by the same precondition
   * that makes it never push: a device reaching `join`/`initialPull` is
   * empty by construction (the "join existing sync" UI is only offered
   * while `getAccounts().length === 0 && getJournals().length === 0` — see
   * `SyncManager.join`'s doc comment), so `pullAndApply`'s own
   * `hasLocalBusinessData()` check is guaranteed false here and the
   * reseed branch never runs. Not merely an accident of the precondition,
   * either — a device with nothing to reseed FROM is exactly the case that
   * branch must never fire for regardless of how it got here, which is why
   * `pullAndApply` re-derives that guard itself from this device's actual
   * local row counts rather than trusting a caller-supplied flag.
   */
  async initialPull(): Promise<{
    pulled: number;
    applied: number;
    skippedUnknownTable: number;
    unknownTables: string[];
    applyConflicts: number;
    discardedPlaceholderUsers: number;
    discardedPlaceholderCharts: number;
  }> {
    const {
      pulled,
      applied,
      skippedUnknownTable,
      unknownTables,
      applyConflicts,
      discardedPlaceholderUsers,
      discardedPlaceholderCharts,
    } = await this.pullAndApply();
    return {
      pulled,
      applied,
      skippedUnknownTable,
      unknownTables,
      applyConflicts,
      discardedPlaceholderUsers,
      discardedPlaceholderCharts,
    };
  }

  /**
   * "Re-download everything from sync" — a device repair action for a
   * device whose apply cascade already quarantined rows into
   * `sync_apply_conflicts` with its cursor advanced past them (see
   * `pullAndApply`'s "Per-row apply conflicts" doc comment: the cursor
   * ALWAYS advances past a conflicted row, which is exactly what makes
   * ordinary re-pulling powerless to heal it — a repeat `syncOnce` never
   * re-fetches a row once its `seq` is behind the cursor, conflicted or
   * not). REAL INCIDENT this exists for — this repo's task-list incident:
   * device B joined a since-reseeded server log whose real 'default' user
   * collided with B's own local boot placeholder (see `applyRow`'s
   * "users.username collision" doc comment — this incident predates that
   * fix, and even with it, a device that already wedged before the fix
   * landed still needs a way out); it was quarantined, and every
   * downstream chart/account/journal_entry row whose FK pointed at that
   * user's uuid failed FK-sibling resolution in turn. B ended up with a
   * large, partially-applied, unusable local database — login broken (its
   * only 'default' user carries a NULL hash) — and no ordinary future
   * `syncOnce` can ever fix it: the poisoned rows are permanently behind
   * its cursor.
   *
   * The fix: wipe every {@link SYNC_TABLES} table's LOCAL rows (children
   * before parents — the reverse of that array's own order, which mirrors
   * {@link BUSINESS_TABLES}' documented parents-first order — so no FK
   * constraint fires mid-wipe even where enforcement is on), clear
   * `sync_outbox`/`sync_apply_conflicts`, reset the cursor to 0, then run
   * the exact same {@link pullAndApply} loop {@link initialPull} uses to
   * re-apply the server's entire log from scratch — a clean, from-zero
   * apply of every row this device can currently see, this time with none
   * of whatever local state caused the original cascade still sitting in
   * the way.
   *
   * The whole wipe (every table's DELETE, the outbox/conflict clears, and
   * the cursor reset) runs inside one transaction with
   * `sync_state.applying` SET — see this class's "Echo suppression" doc
   * comment — so none of these deletes re-enter this device's own outbox as
   * a wave of spurious pushed deletes once the loop below starts draining
   * it again.
   *
   * ## Refuses against an empty server
   *
   * If `transport.currentSeq()` is `0`, this throws before touching
   * anything: an empty server has nothing to rebuild this device FROM, so
   * proceeding would simply delete this device's only copy of its own data
   * with no way to recover it — unlike an ordinary emptied-server-log
   * incident ({@link seedOutboxFromLocalData}'s doc comment), there is no
   * local data left afterward to re-seed the server WITH once this method
   * has already wiped it. Checked first, before any write, so a caller
   * (the Settings UI's "Re-download everything from sync" button) can
   * safely offer this action without a separate "is it safe?" probe of its
   * own.
   *
   * ## Own rows must be included in the rebuild pull
   *
   * REAL BUG this section documents the fix for (caught before it ever
   * shipped, while writing this method's tests — recorded here so the fix
   * is never "simplified" back out): both transports this engine ships
   * against ({@link SupabaseSyncTransport} and
   * {@link ../__tests__/mockServer.ts}'s `MockSyncServer`) exclude this
   * device's own previously-pushed rows from an ordinary `pull` server-side
   * (`device_id <> self`) — see `SupabaseSyncTransport.pull`'s doc comment
   * for the egress problem that filter exists to fix. That's exactly right
   * for `syncOnce`/`initialPull`, where a device's own rows are always
   * redundant with what it already has locally. It is exactly WRONG here:
   * the wipe just above deletes this device's local copy of every
   * replicated row, so by the time the re-pull below runs, this device's
   * OWN rows are no longer redundant with anything — they're as much a part
   * of "the server's full log" as any other device's. A device that itself
   * pushed most of a business's log (typically the origin device that first
   * seeded it — see `docs/web-field-notes.md`'s "First device only" recipe)
   * would, under the ordinary self-filtering default, wipe its entire local
   * database and then re-pull almost nothing back: the "repair" button
   * would hollow out the one full local copy of the business instead of
   * healing it.
   *
   * The fix: the re-pull below calls {@link pullAndApply} directly (not
   * through {@link initialPull}, which never passes this) with
   * `{ includeSelf: true }`, which both transports honor by omitting their
   * own-device filter for this one call — see {@link SyncTransport.pull}'s
   * doc comment. Every other caller of `pullAndApply` (`syncOnce` via
   * `initialPull`'s and its own direct call) leaves this unset and keeps
   * the ordinary filtered behavior.
   *
   * Re-applying this device's own rows back onto itself is safe, not merely
   * convenient: every apply here runs inside this class's ordinary
   * "applying"-flagged transaction (see this class's top "Echo suppression"
   * doc comment), so none of it re-enters `sync_outbox`; and every apply is
   * an idempotent `INSERT ... ON CONFLICT("uuid") DO UPDATE` upsert (or a
   * delete-by-uuid), so re-applying a row this device itself originally
   * wrote reproduces exactly the state it already had, never a duplicate.
   * The one edge case worth naming explicitly: if this device's OWN old
   * boot-placeholder `users` rows (see `applyRow`'s "users.username
   * collision" doc comment) come back through this same log — this device
   * just deleted its local copy, so they're no longer sitting there to
   * collide with anything — the ordinary log order decides the outcome the
   * same rule already documents: placeholder-then-real-user order means the
   * real user (applied second) replaces it via that rule's first bullet;
   * real-user-then-placeholder order means the later placeholder is
   * discarded via that rule's second bullet. No special-casing needed here
   * beyond passing `includeSelf: true` — `applyRow`'s existing collision
   * handling already covers a device meeting its own historical rows again.
   */
  async rebuildFromServer(): Promise<{
    pulled: number;
    applied: number;
    skippedUnknownTable: number;
    unknownTables: string[];
    applyConflicts: number;
    discardedPlaceholderUsers: number;
    discardedPlaceholderCharts: number;
  }> {
    const serverMaxSeq = await this.transport.currentSeq();
    if (serverMaxSeq === 0) {
      throw new Error(
        'SyncEngine.rebuildFromServer: refusing — the server log is empty ' +
          '(currentSeq() === 0), so there is nothing to rebuild this ' +
          "device from. Rebuilding would delete this device's only local " +
          'copy of its data with no way to recover it. Nothing was changed.',
      );
    }

    await this.db.transaction(async () => {
      await this.setApplying(true);
      try {
        // `ledger` (BUSINESS_TABLES — src/core/db/import.ts) is
        // deliberately the one business table excluded from SYNC_TABLES
        // (see migration 029's `SYNC_TABLES` doc comment): every read now
        // goes through `ledger_view` (migration 027), computed fresh from
        // `journal_entry`, not this physical table — see
        // `docs/derived-state-design.md`'s §6 migration-028 cutover and
        // `LedgerService`'s top doc comment. But a device that has actually
        // run `JournalService.insertJournal` locally (as opposed to one
        // that only ever received its data via sync apply, which never
        // writes `ledger` — that path is confined to SYNC_TABLES) still has
        // real rows in this legacy table, each FK'd onto `account`
        // (`FOREIGN KEY("accountId") REFERENCES "account"("id")` — see
        // schema.snapshot.sql). Deleted here, BEFORE the SYNC_TABLES wipe
        // below, so that wipe's own `account`/`journal`/`journal_entry`
        // deletes never trip that FK on a device that has genuinely posted
        // data — exactly the "device that seeded the whole business" shape
        // this method's "Own rows must be included in the rebuild pull"
        // section above exists for. Safe to simply delete and never
        // restore: nothing reads this table for balances anymore, and
        // SYNC_TABLES never repopulates it (by design — a value this method
        // pulls back down afterward would just be legacy write-only state).
        await this.db.run(`DELETE FROM ledger`);

        // Children before parents — the reverse of SYNC_TABLES' own
        // parents-first order (derived from BUSINESS_TABLES — see migration
        // 029's doc comment) — so a FOREIGN KEY constraint never fires
        // mid-wipe even in a build that enforces them.
        const deletionOrder = [...SYNC_TABLES].reverse();
        for (const table of deletionOrder) {
          // eslint-disable-next-line no-await-in-loop
          await this.db.run(`DELETE FROM "${table}"`);
        }
        await this.db.run(`DELETE FROM sync_outbox`);
        await this.db.run(`DELETE FROM sync_apply_conflicts`);
        await this.setCursor(0);
      } finally {
        await this.setApplying(false);
      }
    });

    // Schema/table-shape cache is unaffected by a data wipe — every table
    // still has the same columns/FKs it had before, so there's no need to
    // clear `this.schemaCache` here.
    //
    // `pullAndApply({ includeSelf: true })` is called directly here rather
    // than through `initialPull()` — see this method's "Own rows must be
    // included in the rebuild pull" section above for why `includeSelf`
    // must be true, and `initialPull` is `syncOnce`'s sibling for a fresh,
    // empty device that (by construction — see its own doc comment) has no
    // "own rows" to worry about, so it deliberately never threads that
    // option through.
    const {
      pulled,
      applied,
      skippedUnknownTable,
      unknownTables,
      applyConflicts,
      discardedPlaceholderUsers,
      discardedPlaceholderCharts,
    } = await this.pullAndApply({ includeSelf: true });
    return {
      pulled,
      applied,
      skippedUnknownTable,
      unknownTables,
      applyConflicts,
      discardedPlaceholderUsers,
      discardedPlaceholderCharts,
    };
  }

  /**
   * Resume paging through the server log from this device's stored cursor,
   * without wiping. Used when a previous {@link rebuildFromServer} (or join)
   * applied some pages then died on a dropped fetch — retrying the full
   * rebuild would delete rows already landed. `includeSelf` matches rebuild:
   * a mid-join device may still be missing its origin rows.
   */
  async continuePull(): Promise<{
    pulled: number;
    applied: number;
    skippedUnknownTable: number;
    unknownTables: string[];
    applyConflicts: number;
    discardedPlaceholderUsers: number;
    discardedPlaceholderCharts: number;
  }> {
    const {
      pulled,
      applied,
      skippedUnknownTable,
      unknownTables,
      applyConflicts,
      discardedPlaceholderUsers,
      discardedPlaceholderCharts,
    } = await this.pullAndApply({ includeSelf: true });
    return {
      pulled,
      applied,
      skippedUnknownTable,
      unknownTables,
      applyConflicts,
      discardedPlaceholderUsers,
      discardedPlaceholderCharts,
    };
  }

  // ---------------------------------------------------------------------
  // Push
  // ---------------------------------------------------------------------

  /**
   * Drains `sync_outbox` in insertion-order batches. A batch that pushes
   * successfully has its accepted rows deleted and its rejected rows moved
   * to `sync_rejected` (see migration 029's doc comment — no server-side
   * validation exists yet, so `rejected` is expected to stay empty against
   * every transport this ships with; the plumbing exists for when Phase-3
   * validation lands). A batch is never partially left in the outbox on a
   * *successful* `transport.push` call — every entry in the batch is
   * accounted for as either accepted or rejected. If `transport.push`
   * itself throws (network failure etc.), the batch's rows are left
   * exactly as they were — safe to retry on the next `syncOnce`, since
   * pushing is idempotent (see `OutboxEntry.idempotencyKey`).
   */
  private async drainOutbox(): Promise<{ pushed: number; rejected: number }> {
    let pushed = 0;
    let rejected = 0;

    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await this.db.all<OutboxRow>(
        `SELECT id, idempotencyKey, tableName, rowUuid, op, rowJson
         FROM sync_outbox ORDER BY id ASC LIMIT @limit`,
        { limit: this.pushBatchSize },
      );
      if (rows.length === 0) break;

      const batch: OutboxEntry[] = rows.map((r) => ({
        idempotencyKey: r.idempotencyKey,
        tableName: r.tableName,
        rowUuid: r.rowUuid,
        op: r.op,
        rowJson: r.rowJson,
      }));

      // eslint-disable-next-line no-await-in-loop
      const result = await this.transport.push(batch);
      const rejectedKeys = new Map(
        result.rejected.map((r) => [r.idempotencyKey, r.reason]),
      );

      // eslint-disable-next-line no-await-in-loop
      const delta = await this.db.transaction(async () => {
        let pushedDelta = 0;
        let rejectedDelta = 0;
        for (const row of rows) {
          const reason = rejectedKeys.get(row.idempotencyKey);
          if (reason !== undefined) {
            // eslint-disable-next-line no-await-in-loop
            await this.db.run(
              `INSERT INTO sync_rejected
                 (idempotencyKey, tableName, rowUuid, op, rowJson, reason, rejectedAt)
               VALUES (@idempotencyKey, @tableName, @rowUuid, @op, @rowJson, @reason, datetime('now'))`,
              {
                idempotencyKey: row.idempotencyKey,
                tableName: row.tableName,
                rowUuid: row.rowUuid,
                op: row.op,
                rowJson: row.rowJson,
                reason,
              },
            );
            rejectedDelta += 1;
          } else {
            pushedDelta += 1;
          }
          // eslint-disable-next-line no-await-in-loop
          await this.db.run(`DELETE FROM sync_outbox WHERE id = @id`, {
            id: row.id,
          });
        }
        return { pushedDelta, rejectedDelta };
      });
      pushed += delta.pushedDelta;
      rejected += delta.rejectedDelta;

      if (rows.length < this.pushBatchSize) break;
    }

    return { pushed, rejected };
  }

  // ---------------------------------------------------------------------
  // Pull + apply
  // ---------------------------------------------------------------------

  /**
   * Fetches log rows in ascending `seq` order and applies them, one page
   * (transaction) at a time, advancing the local cursor only after a page's
   * transaction commits — see this class's top doc comment for the
   * causality assumption this relies on.
   *
   * ## Unknown-table rows are skipped, never a crash
   *
   * REAL INCIDENT this guards against: a device pulled log rows for a table
   * (`integration_test_probe`) this app's own schema has never heard of —
   * written by an unrelated integration-test run against the same shared
   * server — and the apply path died with a raw `SQLITE_ERROR: no such
   * table`, taking the whole sync loop down with it. Every row's
   * `tableName` is checked against {@link SYNC_TABLE_SET} (derived from
   * migration 029's `SYNC_TABLES` — the same list that generated this
   * device's own capture triggers) *before* `applyRow` ever touches it. A
   * row for a table not in that set is counted in the returned
   * `skippedUnknownTable`/`unknownTables` and warn-logged exactly once per
   * table for this whole call (not once per row — a backlog of a thousand
   * stray rows for the same foreign table logs one line, not a thousand),
   * then simply left unapplied; the page's transaction still commits and
   * the cursor still advances past it, so the loop never gets stuck
   * re-fetching the same unknown rows forever. This is also deliberate
   * forward-compatibility: an older client pulling a newer server schema's
   * rows for a table it doesn't have yet behaves exactly the same way —
   * skip and move on, not crash.
   *
   * ## Epoch-reset detection
   *
   * Before paging through the log, this device's stored cursor is compared
   * against the server's current watermark ({@link SyncTransport.currentSeq}).
   * If the cursor is *greater than* that watermark, the server's log was
   * wiped/reset since this device last synced (e.g. a real Postgres
   * `TRUNCATE sync_log RESTART IDENTITY` run against a polluted project) —
   * an empty `pull(cursor, 1)` alone can't distinguish "caught up" from
   * "log reset out from under you," which is exactly why `currentSeq()`
   * exists as its own probe. When detected: this device's cursor resets to
   * 0 and a `'sync epoch reset detected'` warning is logged, then the
   * normal pull loop below runs unmodified from cursor 0 — a full
   * re-pull of whatever now exists on the (post-reset) server. This is
   * always safe, never a duplicate-data risk: every apply is an idempotent
   * upsert-by-`uuid` (see `applyRow`'s doc comment), and this device's own
   * historical rows come back echo-suppressed the same way any pull does.
   *
   * ## Cursor advancement past filtered own-device rows
   *
   * Both transports this engine ships against ({@link SupabaseSyncTransport}
   * and {@link ../__tests__/mockServer.ts}'s `MockSyncServer`) exclude this
   * device's own rows from `pull` server-side (`device_id <> this device`) —
   * see `SupabaseSyncTransport.pull`'s doc comment for the egress problem
   * that fixes. That filtering interacts with "advance the cursor to the
   * last **received** row's `seq`" (the pre-existing rule, still used for a
   * full page below) in a way that would otherwise regress this device's
   * cursor to a permanent stall: if this device's own rows occupy the tail
   * of the log (the overwhelmingly common case — a device's most recent
   * writes are, by definition, recent), its own tail rows never arrive at
   * all, so the last *received* row's `seq` can be far short of the log's
   * true end. The next `syncOnce` would then re-issue `pull` from that
   * stale cursor, re-scanning (and re-filtering, server-side — no bytes
   * transferred, but not free either) the same already-fully-seen range
   * forever, and anything reading this device's cursor as "how caught up am
   * I" would report it as perpetually behind.
   *
   * The fix: `serverMaxSeq` above — this method's one `currentSeq()` call,
   * taken *before* the pull loop starts and reused for both epoch-reset
   * detection and this — is a snapshot of the log's true watermark as of
   * the moment this `syncOnce` began. Whenever a pull page comes back
   * shorter than the requested `limit` (below), that page is proof the
   * server had nothing more matching `seq > cursor AND device_id <> self`
   * *as of the time that specific query ran* — `pull` has no upper bound on
   * `seq`, so a short page isn't "truncated by the page size," it's
   * "there was nothing left to truncate." The cursor is then advanced to
   * `serverMaxSeq` (whichever is larger of the two — see below), never
   * beyond it.
   *
   * **Why the snapshot must be taken before paging, not after** (the TOCTOU
   * this class's task list flagged, worth spelling out): imagine instead
   * probing `currentSeq()` *after* the last (short) page came back, and
   * advancing the cursor to that later reading. Between the short page's
   * query and that later probe, some *other* device could push a brand-new
   * row with a `seq` at or below that later watermark. That row was never
   * fetched (the short-page query already ran and returned before it
   * existed) — advancing the cursor past its `seq` anyway would skip it
   * forever, indistinguishable from data loss. Taking the snapshot *first*
   * closes that window: every row with `seq <= serverMaxSeq` provably
   * already existed at (or before) the moment the pull loop's very first
   * query ran, so any such row belonging to another device is provably
   * either already received in an earlier page of *this* loop, or would
   * have been included in the short page that ended it (short means "every
   * currently-matching row was returned," and "currently" only moves
   * forward from the snapshot, never behind it). A row landing *after* the
   * snapshot, from any device, is simply left for the next `syncOnce` to
   * pick up — never lost, only deferred, exactly like any other
   * still-in-flight write during a running pull.
   *
   * Advancing to `serverMaxSeq` is also always *safe* in the sense the rest
   * of this class already relies on: every row with `seq <= serverMaxSeq`
   * this device never received is, by construction, one of its own (the
   * only kind `pull` filters out) — and this device's own rows are its own
   * already-applied state, never something it needs from the server. The
   * `if (serverMaxSeq > cursor)` guard below (rather than an unconditional
   * assignment) exists only to never move the cursor *backward*: a short
   * page's last received row can itself carry a `seq` higher than the
   * snapshot (a foreign row landing mid-loop, seen above, with a `seq` past
   * `serverMaxSeq` — safe to trust *that* value directly, since it was
   * actually received, not merely inferred).
   *
   * ## Per-row apply conflicts: contained, never a wedge
   *
   * REAL INCIDENT this guards against: two browser origins each
   * independently imported the same desktop database (fresh uuids assigned
   * by each import — see migration 029's capture triggers), then both
   * connected to the *same* sync project. Both devices' `users` tables now
   * have a row with the same `username` but two different `uuid`s (same
   * story for `account(chartId, name, code)`, `item_types.name`,
   * `discount_profiles.name`, `price_lists.name`,
   * `attribute_definitions.key`, `inventory_prices(inventoryId,
   * priceListId)`, `profile_type_discounts(profileId, itemTypeId)`,
   * `inventory_opening_stock.inventoryId` — every natural-key `UNIQUE`
   * constraint this schema has). Pulling the other device's log, `applyRow`'s
   * `INSERT ... ON CONFLICT("uuid") DO UPDATE` cannot match the *other*
   * device's uuid — from this device's perspective it's a brand-new row —
   * so the INSERT branch runs and the natural-key UNIQUE index rejects it
   * with `SQLITE_CONSTRAINT_UNIQUE`. Before this was handled, that
   * exception aborted the whole page's transaction (rolling back every
   * *other*, perfectly-fine row in the same page) and left the cursor
   * unmoved, so the next `syncOnce` re-fetched the same page and hit the
   * same conflict — the sync loop wedged retrying forever, with no path to
   * recovery short of manual server-side surgery.
   *
   * The fix, deliberate and worth calling out explicitly rather than
   * papering over: **each row is applied in its own nested
   * transaction/savepoint** (`this.db.transaction`, called from inside this
   * method's own outer page transaction — the driver supports arbitrary
   * nesting via `SAVEPOINT`/`RELEASE`/`ROLLBACK TO`, see
   * `BetterSqliteDriver`/`SqliteWasmDriver`). If a row's apply throws for
   * *any* reason (constraint violation being the overwhelmingly common
   * case, but this catches anything `applyRow` can throw), only that row's
   * savepoint rolls back — every other row already applied in the page
   * stays applied, and every row still to come in the page still gets its
   * own chance. The failure is recorded into `sync_apply_conflicts`
   * (migration 030) with the row's table, uuid, op, full row image, and the
   * real error text, and **the cursor still advances past it** once the
   * page finishes.
   *
   * **This is a deliberate trade-off, not an oversight**: convergence for
   * that one conflicted row is abandoned — this device will never again
   * try to apply it, and will never match the origin device on that
   * specific row — in favor of liveness for every other row, on every
   * other table, forever after. `sync_apply_conflicts` is the audit trail
   * that makes this safe to do silently in the loop: a human (today,
   * reading that table directly; a proper "needs review" inbox UI is
   * future work — see `SyncManager.getStatus`'s `conflictCount` and
   * `SyncSettings.tsx`'s amber note, which surface *that something needs
   * attention* without yet building the inbox itself) can see exactly what
   * was dropped and decide what to do about it (typically: rename/merge the
   * conflicting row by hand). Nothing here attempts automatic conflict
   * *resolution* — only conflict *containment*, so one bad row can never
   * again take the whole sync loop down with it.
   *
   * ## Second-generation boot placeholders: a `chart` row is not a
   * natural-key collision, it's an orphan
   *
   * REAL INCIDENT this guards against — the second wave of the boot-
   * placeholder saga above (`applyRow`'s "users.username collision" doc
   * comment): a wedged device pushed its ENTIRE boot placeholder generation
   * — 1 passwordless `'default'` `users` row + 7 `INITIAL_CHARTS` `chart`
   * rows FK-linked to it via `userId` — into the shared log, and did so
   * *twice* before the capture-suppression fix landed (db.worker.ts's
   * `ensurePlaceholderDefaultUser`). Those 16 rows sit permanently in the
   * log; every device that ever pulls them has to apply them somehow.
   *
   * A device applying them with the CURRENT (post-fix) code silently
   * discards both placeholder `users` rows via `applyUsersPut`'s "local
   * credentialed user beats incoming NULL-credential row" branch — that
   * part already works. But that branch only ever runs for `row.tableName
   * === 'users'`; the 14 `chart` children are ordinary `applyRow` calls
   * that hit the generic FK-resolution code path above (`applyRow`'s
   * "Every FK column ... is resolved from its `<column>_uuid` sibling"
   * section): they look up `userId_uuid` against the local `users` table
   * and find NOTHING, because the row that would have held it was just
   * discarded rather than written. That lookup throws (a *causal-ordering*
   * error, not a natural-key `UNIQUE` violation — a different failure
   * shape than the "Per-row apply conflicts" section above describes, but
   * caught by the exact same generic per-row `catch` below all the same),
   * and without special-casing it, all 14 land in `sync_apply_conflicts` as
   * pure junk: a scary "14 rows could not be applied — needs review" banner
   * over scaffolding nobody will ever need to review, since there is
   * nothing to reconcile — the parent user was correctly, deliberately
   * never written.
   *
   * The fix: the page loop below maintains `discardedPlaceholderUserUuids`,
   * a per-run `Set<string>` of the `rowUuid`s of every `users` row
   * `applyUsersPut` discarded as a placeholder THIS run (populated the
   * instant a `users` row's `applyRow` call returns
   * `{ discardedPlaceholder: true }` — see the loop body). When a `chart`
   * row's apply then fails, the `catch` checks — ONLY for `row.tableName
   * === 'chart'`, ONLY by testing whether that row's OWN `userId_uuid`
   * (parsed straight from its `rowJson`, the same field `applyRow`'s
   * generic FK-resolution would have looked up) is a member of that set —
   * whether this is exactly that shape: a chart orphaned by a
   * placeholder-user discard earlier in the very same run. If so, it is
   * discarded exactly like its parent (`logger.info`-logged, counted in
   * the returned report's `discardedPlaceholderCharts` — see
   * {@link SyncReport}'s doc comment — never written, never quarantined).
   * Any OTHER `chart` apply failure (a row whose parent genuinely hasn't
   * arrived yet due to a real ordering bug, or any failure unrelated to
   * `userId_uuid` at all) still falls through to the ordinary quarantine
   * unchanged — this check is deliberately narrow: table AND parent-uuid
   * membership, nothing broader.
   *
   * **A plain per-run in-memory `Set` — never persisted, never consulted
   * across separate `syncOnce` calls — is sufficient by design, not merely
   * for simplicity.** Two delivery shapes matter, and both stay within one
   * `pullAndApply` call:
   *   - **Join/rebuild** (`initialPull`, `rebuildFromServer`): the ENTIRE
   *     server backlog is replayed inside a single `pullAndApply` call (the
   *     `for (;;)` page loop below keeps paging until it exhausts the log),
   *     so however far apart in `seq` a placeholder generation's `users`
   *     row and its `chart` children sit — even across the two independent
   *     placeholder generations this incident describes — they are always
   *     seen inside that one call.
   *   - **Ordinary steady-state delivery** (`syncOnce`'s background timer):
   *     one placeholder generation is exactly 8 rows (1 `users` + 7
   *     `chart`), all captured into the origin device's `sync_outbox` back
   *     to back by the same boot-time write and pushed as one batch (see
   *     migration 029's capture-trigger doc comment) — so they always land
   *     together, at consecutive `seq` values, on a shared server. That is
   *     far under `DEFAULT_PULL_PAGE_SIZE` (200), so they always land in
   *     the SAME pull page, hence the same `pullAndApply` run — there is no
   *     realistic scenario where a `syncOnce` sees the `users` row on one
   *     call and its `chart` children only on a LATER call, which is the
   *     only scenario a persisted, cross-run set would be needed for.
   *
   * ## Self-cleaning `sync_apply_conflicts`: `prunePlaceholderConflicts`
   *
   * The in-run fix just above only helps a device applying these rows for
   * the FIRST time. A device that already quarantined all 16 rows under
   * OLDER code (before the discard rule in `applyRow`'s "users.username
   * collision" section existed at all) has 16 stale `sync_apply_conflicts`
   * rows sitting there permanently — its cursor is already past them, so no
   * amount of re-running the fixed code above ever revisits them; nothing
   * in the ordinary pull loop ever looks at an already-recorded conflict
   * again. {@link prunePlaceholderConflicts}, called once per
   * `pullAndApply` (see the very end of this method), is the targeted
   * cleanup for exactly that backlog — see its own doc comment for the two
   * narrow, false-positive-resistant signatures it deletes.
   *
   * ## Re-seeding an emptied server log
   *
   * REAL INCIDENT this guards against: an owner's Supabase `sync_log` (the
   * single-tenant BYOK server this engine talks to, see `supabase/setup.sql`)
   * was accidentally truncated — a stale query left in the SQL editor's
   * buffer got re-run. The owner's own PWA device still held the complete
   * local database, with an EMPTY `sync_outbox` (everything it ever wrote
   * had been pushed and drained long before the truncation) and a stored
   * cursor far above the now-0 server watermark. The epoch-reset handling
   * above already recovers this device's *cursor* — but a device with
   * nothing pending in its outbox never re-uploads anything on its own, so
   * without this section the server's log would simply stay empty forever,
   * and any device joining afterward would pull zero rows: exactly what
   * happened.
   *
   * The fix: once `serverMaxSeq` (above) is known, if it is exactly `0`
   * AND this device's own `sync_outbox` is currently empty AND this device
   * actually holds local business data (the same `COUNT(account) > 0 OR
   * COUNT(journal) > 0` probe `apps/web/src/worker/syncManager.ts`'s
   * `SyncManager.hasLocalBusinessData` already uses for its connect-time
   * duplicate-seed guard — reimplemented here, in core, as
   * {@link hasLocalBusinessData} rather than imported, since `src/core` has
   * no dependency on `apps/web`), this device (re-)captures every current
   * row of every `SYNC_TABLES` table into `sync_outbox` via
   * {@link seedOutboxFromLocalData} (./seedOutbox.ts — see that file's doc
   * comment for the row-image/idempotency-key mechanics) and records the
   * count as `seeded` in the returned report. `syncOnce`'s doc comment
   * covers the extra outbox drain that actually gets these rows pushed
   * within the same call, so a device recovers in one sync cycle rather
   * than two.
   *
   * This single condition (`serverMaxSeq === 0`, outbox empty, local data
   * present) covers BOTH shapes the incident can take without needing to
   * special-case either:
   *   - **The epoch-reset path**: this device's cursor was ahead of the
   *     server (`cursor > serverMaxSeq`, handled just above, which resets
   *     cursor to 0) — the truncation happened to a device that had synced
   *     before.
   *   - **A fresh connect to an already-emptied server**: this device's own
   *     cursor is already 0 (e.g. it holds business data created before
   *     ever configuring sync, or reconnecting after a `disconnect()`) and
   *     the server it's connecting to also happens to be at `seq` 0 — no
   *     epoch reset is detected (`0 > 0` is false) since there was never a
   *     higher cursor to fall from, but the server log is just as much
   *     "empty despite this device holding data" and needs the exact same
   *     recovery.
   *
   * The outbox-empty check is what tells this apart from the ordinary
   * first-ever connect of a brand-new business (see
   * `docs/web-field-notes.md`'s "First device only" recipe): that device's
   * own capture triggers already populated its outbox from its own writes
   * (or its desktop-import), so this branch's `outboxIsEmpty` guard is
   * false there and nothing extra happens — nothing here changes the
   * ordinary first-connect flow.
   *
   * **Never reachable from `initialPull`** (the "join existing sync" path)
   * — see that method's own doc comment for why: a joining device is empty
   * by precondition, so `hasLocalBusinessData()` is always false there and
   * this branch never fires. `initialPull` and `syncOnce` share this exact
   * same `pullAndApply` body; the guard is derived from this device's own
   * local state on every call, not threaded through as a parameter, so
   * there is no separate "seeding-disabled" code path to keep in sync —
   * only one path, that happens to never activate for a device with
   * nothing local to seed from.
   *
   * ## Not a capture-trigger write — no echo-suppression involved
   *
   * {@link seedOutboxFromLocalData} inserts directly into `sync_outbox`
   * against the already-applied business tables; it never issues a write
   * against a `SYNC_TABLES` table itself, so migration 029's capture
   * triggers never fire for it and `sync_state.applying` is irrelevant
   * here — unlike this method's own apply loop below, which does need that
   * flag (see "Echo suppression" in this class's top doc comment).
   */
  private async pullAndApply(opts?: {
    /**
     * Forwarded verbatim to every {@link SyncTransport.pull} call this
     * method makes. Defaults to (and is equivalent to) `false` — `syncOnce`
     * and `initialPull` never pass it, so their pulls keep excluding this
     * device's own rows exactly as before. `rebuildFromServer` is the one
     * caller that passes `includeSelf: true`; see that method's doc comment
     * for why a from-zero rebuild is the one case where a device genuinely
     * needs its own previously-pushed rows back.
     */
    includeSelf?: boolean;
  }): Promise<{
    pulled: number;
    applied: number;
    skippedUnknownTable: number;
    unknownTables: string[];
    epochReset: boolean;
    applyConflicts: number;
    discardedPlaceholderUsers: number;
    discardedPlaceholderCharts: number;
    seeded: number;
  }> {
    let pulled = 0;
    let applied = 0;
    let skippedUnknownTable = 0;
    let applyConflicts = 0;
    let discardedPlaceholderUsers = 0;
    let discardedPlaceholderCharts = 0;
    let seeded = 0;
    const unknownTables = new Set<string>();
    const conflictedTables = new Set<string>();
    // Populated as the page loop below discards a `users` row as a boot
    // placeholder (see `applyUsersPut`'s doc comment) and consulted when a
    // `chart` row's apply fails, to tell "this is that placeholder's own
    // now-orphaned scaffolding" apart from a genuine conflict — see this
    // method's "Second-generation boot placeholders" doc comment for the
    // full rule and why a plain per-run Set (never persisted across
    // separate `pullAndApply` calls) is sufficient.
    const discardedPlaceholderUserUuids = new Set<string>();
    let cursor = await this.getCursor();

    const serverMaxSeq = await this.transport.currentSeq();
    const epochReset = cursor > serverMaxSeq;
    if (epochReset) {
      this.logger.warn(
        `SyncEngine: sync epoch reset detected — this device's stored cursor ` +
          `(${cursor}) is ahead of the server's current max seq ` +
          `(${serverMaxSeq}), which means the server's log was wiped/reset ` +
          `since this device last synced. Resetting this device's cursor to 0 ` +
          `and re-pulling the full log from scratch. Safe: applies are ` +
          `idempotent upserts by uuid, and this device's own historical rows ` +
          `come back echo-suppressed like any other pull.`,
      );
      cursor = 0;
      await this.setCursor(0);
    }

    if (serverMaxSeq === 0) {
      const outboxEmpty = await this.outboxIsEmpty();
      if (outboxEmpty && (await this.hasLocalBusinessData())) {
        const result = await seedOutboxFromLocalData(this.db);
        seeded = result.seeded;
        if (seeded > 0) {
          this.logger.warn(
            `SyncEngine: server log is empty but this device holds data — ` +
              `re-seeding ${seeded} row(s) into sync_outbox so the next push ` +
              `re-populates the server. Likely cause: the server's sync log ` +
              `was wiped/truncated (e.g. a stale SQL-editor buffer re-run) ` +
              `while this device's own outbox had already been fully drained.`,
          );
        }
      }
    }

    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const page = await this.transport.pull(cursor, this.pullPageSize, opts);
      pulled += page.length;

      if (page.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        const pageResult = await this.db.transaction(async () => {
          let count = 0;
          let skipped = 0;
          let conflicts = 0;
          let discarded = 0;
          let discardedCharts = 0;
          await this.setApplying(true);
          try {
            for (const row of page) {
              if (!SYNC_TABLE_SET.has(row.tableName)) {
                skipped += 1;
                if (!unknownTables.has(row.tableName)) {
                  unknownTables.add(row.tableName);
                  this.logger.warn(
                    `SyncEngine: skipping log row(s) for unknown table ` +
                      `"${row.tableName}" (first seen at seq ${row.seq}) — not in ` +
                      `this client's SYNC_TABLES allowlist. Expected when the ` +
                      `server log carries rows from an unrelated/foreign table ` +
                      `(e.g. another app's or a test suite's writes against a ` +
                      `shared project) or from a table a newer server-side ` +
                      `schema added that this client doesn't know about yet. ` +
                      `These rows are never applied locally.`,
                  );
                }
                continue;
              }
              try {
                // Nested transaction (SAVEPOINT) so a failing row's write
                // never rolls back the rest of this page — see this method's
                // doc comment ("Per-row apply conflicts: contained, never a
                // wedge").
                // eslint-disable-next-line no-await-in-loop
                const result = await this.db.transaction(() =>
                  this.applyRow(row),
                );
                if (result.discardedPlaceholder) {
                  discarded += 1;
                  if (row.tableName === 'users') {
                    // Surfaced for the `chart`-orphan check below — see this
                    // method's "Second-generation boot placeholders" doc
                    // comment. `applyUsersPut`'s discard branch is the ONLY
                    // source of `discardedPlaceholder: true` for `users`
                    // (the natural-key LWW discard earlier in `applyRow`
                    // never targets `users`, which isn't in
                    // NATURAL_KEY_TABLES), so no other row shape reaches
                    // here under this table name.
                    discardedPlaceholderUserUuids.add(row.rowUuid);
                  }
                } else {
                  count += 1;
                }
              } catch (error) {
                if (row.tableName === 'chart') {
                  // A `chart` row's apply fails almost exclusively via
                  // `applyRow`'s FK-resolution throw against `userId_uuid`
                  // (chart carries no natural-key UNIQUE constraint of its
                  // own — see this method's "Second-generation boot
                  // placeholders" doc comment). Check whether this specific
                  // failure is that orphaned-scaffolding shape BEFORE
                  // falling through to the generic quarantine below: parse
                  // the row's own `userId_uuid` straight out of its
                  // `rowJson` (the same sibling `applyRow` itself would have
                  // resolved) and test it against this run's placeholder-
                  // discard set.
                  let parentUserUuid: string | null = null;
                  try {
                    const chartJson = JSON.parse(row.rowJson) as Record<
                      string,
                      unknown
                    >;
                    if (typeof chartJson.userId_uuid === 'string') {
                      parentUserUuid = chartJson.userId_uuid;
                    }
                  } catch {
                    // Malformed row image — fall through to the ordinary
                    // quarantine below rather than guess.
                  }
                  if (
                    parentUserUuid !== null &&
                    discardedPlaceholderUserUuids.has(parentUserUuid)
                  ) {
                    discardedCharts += 1;
                    this.logger.info(
                      `SyncEngine: discarding a 'chart' row (uuid: ` +
                        `${row.rowUuid}, seq: ${row.seq}) — it is the ` +
                        `INITIAL_CHARTS scaffolding of a boot-placeholder ` +
                        `'users' row (uuid: ${parentUserUuid}) already ` +
                        `discarded earlier in this same sync run, so its ` +
                        `parent was deliberately never written. Not an ` +
                        `error, not a conflict: nothing to reconcile.`,
                    );
                    continue;
                  }
                }
                const message =
                  error instanceof Error ? error.message : String(error);
                if (isDuplicateSeedApplyError(message)) {
                  if (!conflictedTables.has(row.tableName)) {
                    conflictedTables.add(row.tableName);
                    this.logger.info(
                      `SyncEngine: skipping duplicate-seed log row(s) for ` +
                        `table "${row.tableName}" (first seen at seq ${row.seq}) ` +
                        `— ${message}. This device already has a row for that ` +
                        `natural key; the incoming copy is dropped, not ` +
                        `quarantined.`,
                    );
                  }
                  continue;
                }
                conflicts += 1;
                // eslint-disable-next-line no-await-in-loop
                await this.recordApplyConflict(row, message);
                if (!conflictedTables.has(row.tableName)) {
                  conflictedTables.add(row.tableName);
                  this.logger.warn(
                    `SyncEngine: could not apply log row(s) for table ` +
                      `"${row.tableName}" (first seen at seq ${row.seq}) — ${message}. ` +
                      `Recorded in sync_apply_conflicts for review; the cursor ` +
                      `advances past it.`,
                  );
                }
              }
            }
            const lastSeq = page[page.length - 1].seq;
            await this.setCursor(lastSeq);
          } finally {
            await this.setApplying(false);
          }
          return { count, skipped, conflicts, discarded, discardedCharts };
        });
        applied += pageResult.count;
        skippedUnknownTable += pageResult.skipped;
        applyConflicts += pageResult.conflicts;
        discardedPlaceholderUsers += pageResult.discarded;
        discardedPlaceholderCharts += pageResult.discardedCharts;

        cursor = page[page.length - 1].seq;
      }

      if (page.length < this.pullPageSize) {
        // End of the filtered log reached (as of this specific query) — see
        // "Cursor advancement past filtered own-device rows" above for why
        // `serverMaxSeq` (captured once, before this loop started) is safe
        // to advance to here, and why it must never be exceeded by anything
        // other than an actually-received row's own `seq`.
        if (serverMaxSeq > cursor) {
          cursor = serverMaxSeq;
          // eslint-disable-next-line no-await-in-loop
          await this.setCursor(cursor);
        }
        break;
      }
    }

    // Self-cleaning pass over previously-recorded `sync_apply_conflicts`
    // rows — see `prunePlaceholderConflicts`'s doc comment for the two
    // narrow signatures it deletes and why once-per-`pullAndApply` (rather
    // than once per page, or gated behind some "only if something changed"
    // condition) is the right cadence: `sync_apply_conflicts` is a small,
    // rarely-populated audit table (a healthy device has zero rows in it),
    // so scanning it in full on every call costs nothing worth optimizing
    // away, and running it unconditionally means there is only one code
    // path to reason about rather than a second "did anything relevant
    // happen this run" trigger condition to keep in sync with the actual
    // pruning rules.
    const prunedConflicts = await this.prunePlaceholderConflicts();
    if (prunedConflicts > 0) {
      this.logger.info(
        `SyncEngine: pruned ${prunedConflicts} stale placeholder-shaped ` +
          `row(s) from sync_apply_conflicts — recorded under older code, ` +
          `before the discard rules above existed, and now recognized as ` +
          `boot-placeholder noise rather than genuine conflicts needing ` +
          `review. See prunePlaceholderConflicts's doc comment.`,
      );
    }

    const prunedDuplicates = await this.pruneDuplicateSeedConflicts();
    if (prunedDuplicates > 0) {
      this.logger.info(
        `SyncEngine: pruned ${prunedDuplicates} duplicate-seed ` +
          `row(s) from sync_apply_conflicts — UNIQUE / missing-parent ` +
          `failures from a second import in the same project log.`,
      );
    }

    await this.repairStompedInvoiceTimestamps();

    return {
      pulled,
      applied,
      skippedUnknownTable,
      unknownTables: [...unknownTables],
      applyConflicts,
      discardedPlaceholderUsers,
      discardedPlaceholderCharts,
      epochReset,
      seeded,
    };
  }

  /**
   * Deletes already-recorded `sync_apply_conflicts` (migration 030) rows
   * that turn out, in hindsight, to be exactly the boot-placeholder noise
   * `pullAndApply`'s "Second-generation boot placeholders" doc comment (and
   * `applyRow`'s "users.username collision" section it references)
   * describes — recorded under OLDER code, before either discard rule
   * existed, and therefore never cleaned up by anything else: this device's
   * cursor already sits past every one of these rows (that is precisely
   * what quarantining a row means — see `pullAndApply`'s "Per-row apply
   * conflicts" doc comment), so no ordinary future pull ever revisits them,
   * and nothing before this method existed ever went back to reconsider an
   * already-recorded conflict against newer rules. Called once per
   * `pullAndApply` (see the call site just above, and its own comment on
   * why unconditionally, every run, is the right cadence) rather than only
   * when this run's own pull activity suggests something changed — a
   * device could easily have been offline for the entire period between
   * the collision happening and this fix shipping, so nothing about "this
   * run pulled new rows" reliably correlates with "this run is when stale
   * junk should be cleaned up."
   *
   * Reads the whole `sync_apply_conflicts` table (filtered to `users`/
   * `chart`, the only two table names either signature below can ever
   * match) in one query rather than pushing each predicate into SQL: the
   * `users` signature needs a per-row lookup against the LOCAL `users`
   * table by `username` (extracted from that row's own `rowJson`), and the
   * `chart` signature needs one against `users` by `uuid` — cheaper to
   * write and read as a plain loop than as a correlated subquery per
   * signature, and this table is small (a healthy device has zero rows in
   * it; even an affected one has, at most, the low tens from this exact
   * incident) so the extra round-trips cost nothing worth optimizing away.
   *
   * ## The two signatures, and why each predicate is load-bearing
   *
   * **(a) `tableName = 'users'`**: the recorded `rowJson` has BOTH
   * `password_hash IS NULL` AND `password_hash__hex IS NULL` (a genuinely
   * passwordless incoming row — not merely one whose hex sibling was
   * omitted; see migration 029's `jsonObjectExpr` doc comment on why a
   * declared-blob column's real value only ever lives in one of the two
   * keys, never neither, for a row that legitimately carries one) AND the
   * LOCAL `users` table holds a row with that same `username` where
   * `password_hash IS NOT NULL` — i.e. exactly
   * `applyUsersPut`'s "local row has a credential, incoming row does not"
   * discard branch, replayed against history. The credentialed-local-row
   * requirement is what keeps this from ever touching a GENUINE two-
   * desktop-imports username collision (`sync_apply_conflicts`'s own top
   * doc comment's founding incident): if the local `username` match is
   * ALSO passwordless (both sides boot placeholders — itself an unlikely
   * shape, but not impossible if two devices both wedged before their own
   * boots ever got a real login) or if there is no local match at all
   * (this device never had ITS OWN colliding row, or has since deleted it),
   * this predicate is false and the conflict record is left alone for a
   * human to actually review — which is exactly right, since discarding it
   * would not be replaying `applyRow`'s existing rule, it would be
   * inventing a new, broader one.
   *
   * **(b) `tableName = 'chart'`**: the recorded `rowJson`'s `userId_uuid`
   * resolves to NO row in the local `users` table (the parent user was
   * never written locally — the FK-resolution failure `applyRow` originally
   * threw for this exact row) AND the row's `name` is one of the seven
   * {@link INITIAL_CHART_NAMES} (derived from `INITIAL_CHARTS`, never
   * hand-duplicated here — see that constant's doc comment). BOTH
   * conjuncts are load-bearing, independently:
   *   - The `INITIAL_CHARTS`-name requirement is what keeps this from ever
   *     pruning a genuine USER-CREATED chart (any account holder can name
   *     their own chart `'Revenue'`, colliding by coincidence with a
   *     scaffolding name) — only a `chart` row whose `userId_uuid` resolves
   *     to nothing local AND whose name matches this exact seeded list is
   *     scaffolding beyond reasonable doubt.
   *   - The unresolvable-parent requirement is what keeps this from pruning
   *     a chart whose parent user simply HASN'T ARRIVED YET (ordinary,
   *     healthy causal-ordering delay — nothing wrong, nothing to clean
   *     up). In principle "hasn't arrived yet" is impossible for a row
   *     that is ALREADY sitting in `sync_apply_conflicts`: quarantining
   *     only ever happens after the row's own single apply attempt already
   *     failed and the cursor already advanced past it (see `pullAndApply`'s
   *     "Per-row apply conflicts" doc comment) — that parent's own "chance"
   *     to arrive first, if it was ever going to, has already passed by
   *     the time this row was recorded at all. Kept as an explicit
   *     conjunct anyway, rather than trusted implicitly, precisely BECAUSE
   *     that invariant lives in a different method entirely (`pullAndApply`'s
   *     page loop) — re-deriving it here from what is actually,
   *     currently true of the local `users` table costs one query and
   *     means this method's correctness never silently depends on an
   *     invariant it cannot itself verify.
   */
  private async prunePlaceholderConflicts(): Promise<number> {
    const rows = await this.db.all<{
      id: number;
      tableName: string;
      rowJson: string;
    }>(
      `SELECT id, tableName, rowJson FROM sync_apply_conflicts WHERE tableName IN ('users', 'chart')`,
    );
    if (rows.length === 0) return 0;

    const idsToPrune: number[] = [];

    for (const row of rows) {
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(row.rowJson) as Record<string, unknown>;
      } catch {
        // Malformed row image — never expected in practice (this device
        // wrote it itself, from a real LogRow), but leave it for a human
        // rather than guess at its shape.
        continue;
      }

      if (row.tableName === 'users') {
        const isPasswordless =
          (json.password_hash === null || json.password_hash === undefined) &&
          (json.password_hash__hex === null ||
            json.password_hash__hex === undefined);
        if (!isPasswordless) continue;

        const { username } = json;
        if (typeof username !== 'string') continue;

        // eslint-disable-next-line no-await-in-loop
        const localMatch = await this.db.get<{
          password_hash: unknown;
        }>(`SELECT password_hash FROM users WHERE username = @username`, {
          username,
        });
        const localIsCredentialed =
          localMatch !== undefined &&
          localMatch.password_hash !== null &&
          localMatch.password_hash !== undefined;
        if (localIsCredentialed) idsToPrune.push(row.id);
        continue;
      }

      // row.tableName === 'chart' (the only other value the WHERE clause above allows)
      const chartName = json.name;
      if (
        typeof chartName !== 'string' ||
        !INITIAL_CHART_NAMES.has(chartName)
      ) {
        continue;
      }

      const parentUuid = json.userId_uuid;
      if (typeof parentUuid !== 'string') continue; // no parent reference recorded — not this incident's shape

      // eslint-disable-next-line no-await-in-loop
      const parentUser = await this.db.get<{ id: number }>(
        `SELECT id FROM users WHERE uuid = @uuid`,
        { uuid: parentUuid },
      );
      if (parentUser === undefined) idsToPrune.push(row.id);
    }

    if (idsToPrune.length === 0) return 0;

    // A plain (non-nested) write against a table that carries no capture
    // triggers of its own (`sync_apply_conflicts` isn't in `SYNC_TABLES`)
    // — see `recordApplyConflict`'s doc comment for the identical reasoning
    // — so this needs no echo-suppression handling and runs outside any
    // "applying"-flagged transaction.
    const params: Record<string, unknown> = {};
    const placeholders = idsToPrune.map((id, i) => {
      const key = `id${i}`;
      params[key] = id;
      return `@${key}`;
    });
    await this.db.run(
      `DELETE FROM sync_apply_conflicts WHERE id IN (${placeholders.join(
        ', ',
      )})`,
      params,
    );

    return idsToPrune.length;
  }

  /**
   * Drops `sync_apply_conflicts` rows that are a second import of the
   * same business (UNIQUE / missing-parent), recorded before those
   * failures were discarded in-line. A join against a twice-seeded
   * project can leave 100k+ of these; they are not human-reviewable.
   */
  private async pruneDuplicateSeedConflicts(): Promise<number> {
    const result = await this.db.run(
      `DELETE FROM sync_apply_conflicts
       WHERE error LIKE '%UNIQUE constraint failed%'
          OR error LIKE '%cannot resolve %_uuid%'`,
    );
    return result.changes ?? 0;
  }

  /**
   * See {@link repairInvoiceEditedTimestamps}. Kept as a method so
   * `pullAndApply` stays the one place a completed cycle heals local
   * invoice timestamps; the same function also runs on web-worker boot
   * so a hung Safari fetch cannot block the repair forever.
   */
  private async repairStompedInvoiceTimestamps(): Promise<void> {
    await repairInvoiceEditedTimestamps(this.db);
  }

  /**
   * Whether this device's `sync_outbox` currently has anything queued —
   * the "nothing left to push" half of {@link pullAndApply}'s
   * server-log-reseeding precondition. A device mid-way through its normal
   * lifecycle (an ordinary first connect, or simply one with local writes
   * not yet drained) has a non-empty outbox and must never be
   * double-seeded on top of that.
   */
  private async outboxIsEmpty(): Promise<boolean> {
    const row = await this.db.get<{ id: number }>(
      `SELECT id FROM sync_outbox LIMIT 1`,
    );
    return row === undefined;
  }

  /**
   * Whether this device's local database holds business data worth
   * protecting/re-seeding — the identical `COUNT(account) > 0 OR
   * COUNT(journal) > 0` probe `apps/web/src/worker/syncManager.ts`'s
   * `SyncManager.hasLocalBusinessData` uses for its own (unrelated)
   * connect-time duplicate-seed guard. Deliberately reimplemented here
   * rather than imported: `src/core` is platform-free and must never
   * depend on `apps/web`, and this one two-line probe is cheap enough that
   * duplicating it costs far less than introducing a cross-layer import
   * would. `account`/`journal` (not, say, `chart` alone) are the same
   * "real business activity, not just a starter chart of accounts"
   * signal `apps/web`'s version already settled on — see that method's own
   * doc comment.
   */
  private async hasLocalBusinessData(): Promise<boolean> {
    const accounts = await this.db.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM account`,
    );
    const journals = await this.db.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM journal`,
    );
    return (accounts?.c ?? 0) > 0 || (journals?.c ?? 0) > 0;
  }

  /**
   * Applies one log row inside the caller's "applying"-flagged transaction:
   * a `delete` removes the local row by `uuid` (a no-op if it isn't
   * present — e.g. this device never had it); a `put` upserts by `uuid`
   * (`INSERT ... ON CONFLICT("uuid") DO UPDATE`), leaving the local integer
   * `id` alone in both branches — a fresh insert gets whatever id this
   * device's own AUTOINCREMENT assigns, never the origin device's id (see
   * migration 029's doc comment for why the row image carries FK columns
   * as uuids for exactly this reason).
   *
   * Column selection is the intersection of this device's own schema
   * (introspected via `PRAGMA table_info`, cached per table) and the keys
   * present in `rowJson` — mirroring the same "target may have more
   * columns than the source" tolerance src/core/db/import.ts's `copyTable`
   * already established for the desktop-database-import feature, for the
   * same reason: a peer on an older build's row image simply omits columns
   * this device's newer schema added, and this device's own column
   * default / capture-trigger-adjacent logic fills them in.
   *
   * A non-FK column whose row image carries a non-null `<column>__hex`
   * string is a declared-blob column that was an actual runtime blob on the
   * origin device (see migration 029's `jsonObjectExpr` doc comment) —
   * {@link hexToBytes} decodes it back into a `Uint8Array` and that, not
   * `json[column]` (which is NULL in that case), is what gets bound. A
   * declared-blob column holding an ordinary TEXT value (the common case for
   * `users.password_hash` today) has no `__hex` sibling set and is written
   * exactly like any other column.
   *
   * Every FK column (per `PRAGMA foreign_key_list`) is resolved from its
   * `<column>_uuid` sibling in the row image via `SELECT id FROM
   * <refTable> WHERE uuid = ?` — never from the raw `<column>` value in
   * the JSON, which is the *origin* device's local id and is meaningless
   * here. If that lookup comes back empty for a non-null `<column>_uuid`,
   * this throws rather than writing a dangling/NULL foreign key: per this
   * class's doc comment, the referenced row is assumed to already exist
   * locally (parent-before-child log ordering) — coming up empty means
   * that assumption was violated, which is a protocol bug worth failing
   * loudly on, not a normal runtime condition to paper over.
   *
   * ## Per-key last-writer-wins for {@link NATURAL_KEY_TABLES} members
   *
   * For a `put` against a table in `NATURAL_KEY_TABLES` (today, only
   * `settings`, keyed by `key`), a local row sharing the incoming row's
   * natural-key value but carrying a DIFFERENT `uuid` cannot simply be left
   * for the generic `uuid`-keyed upsert below: the INSERT branch would run
   * (the incoming `uuid` matches no local row) and the table's
   * `UNIQUE(key)` constraint would reject it — exactly the
   * `sync_apply_conflicts`-quarantine case `pullAndApply`'s doc comment
   * describes for `users.username`/`account(chartId, name, code)`/etc,
   * which would silently drop one device's setting instead of converging
   * on it.
   *
   * **A naive "always delete the conflicting local row and let the
   * incoming one win" pre-step does not converge, and was proven wrong by
   * simulation while building this method — worth recording so it is never
   * re-introduced.** Consider device A and device B, each setting the same
   * key locally before ever syncing with each other, then both running
   * `syncOnce()` in some interleaving:
   *   1. A pushes its row (log seq 1), then pulls — nothing from B yet, so
   *      A's own row (never touched by pull) is untouched.
   *   2. B pushes its row (log seq 2), then pulls — receives A's row (seq
   *      1). An unconditional "delete-then-insert whatever arrives"
   *      pre-step would make B overwrite its OWN, more-recent local value
   *      with A's older one.
   *   3. A's next `syncOnce()` pulls B's row (seq 2) and — by the same
   *      unconditional rule — overwrites ITS OWN local value with B's.
   *
   *   Final state: A holds B's value, B holds A's value — swapped, and
   *   permanently stuck that way (the log has nothing left for either
   *   device to pull). Both `syncOnce()` calls succeeded, nothing landed in
   *   `sync_apply_conflicts`, and yet the two devices disagree forever. The
   *   bug is that "unconditional" ignores that a device's own not-yet-
   *   round-tripped local write can be newer than whatever it happens to
   *   pull next — pull order is not global recency order once a device's
   *   own rows are filtered out of its own pulls (see this class's "Cursor
   *   advancement past filtered own-device rows" doc comment above for that
   *   filtering).
   *
   * The fix actually implemented below compares, not just deletes:
   * `settings.updatedAt` is trustworthy for this precisely BECAUSE
   * `settings` is unlike every other replicated table — migration 028
   * created it with no schema-snapshot `after_insert/update_..._add_timestamp`
   * trigger (those triggers only exist for tables from migrations 001-027;
   * `settings` postdates the snapshot), so nothing ever stomps the
   * `updatedAt` `SettingsService.set()` stamps at the moment of a real
   * local write — contrast migration 029's doc comment, which documents
   * exactly that stomping as a KNOWN, un-worked-around gap for every other
   * table's `createdAt`/`updatedAt`. That makes `settings.updatedAt` a
   * genuine, comparable wall-clock write time, faithfully carried in the
   * row image and never overwritten out from under it — the standard
   * ingredient an LWW-register needs.
   *
   * The rule: fetch the local row (if any) sharing the incoming row's
   * natural-key value. If none exists, or it already IS this exact `uuid`
   * (an update to a row this device already has, not a natural-key
   * conflict at all), fall straight through to the normal upsert below —
   * nothing special to do. Otherwise, compare ISO-8601 `updatedAt` strings
   * (lexicographic order on the same fixed `toISOString()` format is
   * chronological order, so a plain string comparison suffices, no
   * `Date` parsing needed): the incoming row overwrites the local one only
   * if its `updatedAt` is strictly later, or exactly tied and its `uuid` is
   * lexicographically greater than the local row's (an arbitrary but fully
   * deterministic tiebreak both sides compute identically, so a genuine
   * same-millisecond race still converges instead of leaving the outcome to
   * "whichever side happened to apply second"). A `null`/missing incoming
   * `updatedAt` never wins against a real local value (nothing to compare
   * favorably); a `null` local `updatedAt` always loses to a real incoming
   * one. When the incoming row loses, this method returns immediately —
   * the local row is already the converged winner, and the pulled row is
   * simply not written (not an error, not a conflict — just correctly
   * discarded). When it wins, the conflicting local row is deleted and
   * execution falls through to the same INSERT the no-conflict case uses.
   *
   * Re-running the swap scenario above with this rule: at step 2, B
   * compares A's incoming `updatedAt` against its own (later) local one and
   * keeps its own row. At step 3, A compares B's incoming `updatedAt`
   * (later than A's own) and adopts it. Both devices now hold B's value —
   * converged, and specifically converged on whichever device's write
   * actually happened last in wall-clock time, not an artifact of sync
   * timing.
   *
   * The delete (when the incoming row wins) runs inside the same
   * "applying"-flagged transaction as everything else in `pullAndApply`'s
   * page loop (`setApplying(true)` is set for the whole page before any row
   * is applied — see that method). `settings`'s own delete-capture trigger
   * (migration 033, built by the same `createCaptureTriggers` every
   * replicated table uses) is therefore suppressed by the `APPLYING_GUARD`
   * exactly like any other write made while applying a pull: this pre-step
   * never re-enters `sync_outbox` as a spurious delete of the device's own
   * settings row.
   *
   * ## `users.username` collision: a real user beats a passwordless
   * placeholder, never the reverse
   *
   * REAL INCIDENT this guards against — this repo's task-list incident:
   * `db.worker.ts`'s `ensurePlaceholderDefaultUser` creates a device-local,
   * zero-credential (`password_hash IS NULL`) `'default'` user + starter
   * chart on every fresh worker boot (see that function's doc comment —
   * that creation itself is now suppressed from ever being captured into
   * `sync_outbox` in the first place, closing off the OTHER half of this
   * incident, but a device that already had this placeholder sitting
   * locally before that fix landed, or one that simply hasn't rebooted
   * since, still has it). A device joining/pulling an existing sync
   * project can therefore find its own local placeholder's `username`
   * colliding with an incoming, *real*, credentialed `'default'` user from
   * the origin device — the generic `INSERT ... ON CONFLICT("uuid") DO
   * UPDATE` below can't match them (different uuids), so the INSERT branch
   * runs and `users.username`'s UNIQUE index rejects it. Before this rule
   * existed, that was indistinguishable from any other natural-key
   * collision (the "Per-row apply conflicts" section above): quarantined
   * into `sync_apply_conflicts`, cursor advanced past it — permanently.
   * Every downstream `chart`/`account`/`journal_entry` row whose FK
   * pointed at the real user's uuid then failed FK-sibling resolution in
   * turn (their parent, the real user, was never actually written), and
   * this device ended up with a large, partially-applied, unusable local
   * database — login broken, since its only `'default'` user still carries
   * the placeholder's NULL hash.
   *
   * The rule this method applies instead, ONLY for `row.tableName ===
   * 'users'` and ONLY when the generic upsert fails with a UNIQUE
   * violation (any other error still propagates and is quarantined
   * normally):
   *
   *   - **The LOCAL colliding row has `password_hash IS NULL` and the
   *     INCOMING row carries a non-null credential**: the incoming row is
   *     the real user; the local row is device-local scaffolding that was
   *     never supposed to leave this device. This device's own placeholder
   *     — and its `chart` scaffolding (`DELETE FROM chart WHERE userId =
   *     ...`, mirroring `apps/web/src/worker/syncManager.ts`'s
   *     `clearBootPlaceholder` — same `password_hash IS NULL` load-bearing
   *     guard, so this can never delete a real, password-protected account
   *     that happens to be literally named `'default'`) — is deleted, and
   *     the insert is retried exactly once. These deletes run inside the
   *     same "applying"-flagged transaction `pullAndApply`'s page loop
   *     already has open (see "Echo suppression" above), so neither one
   *     re-enters this device's own `sync_outbox`.
   *   - **The LOCAL row has a credential and the INCOMING row is a
   *     NULL-credential row sharing the same username** (someone else's
   *     boot placeholder arriving — expected noise from a peer device,
   *     never actual data to reconcile): the incoming row is discarded
   *     silently. Not an error, not a conflict: `logger.info`-logged and
   *     counted in the returned report's `discardedPlaceholderUsers`
   *     bucket rather than `sync_apply_conflicts` — nothing here needs a
   *     human's review.
   *   - **Any other `users.username` collision** (two independently-seeded
   *     devices genuinely sharing a username, both — or neither —
   *     carrying a real credential): neither side of this rule applies;
   *     the original error is re-thrown and today's quarantine behavior
   *     (record into `sync_apply_conflicts`, cursor still advances) is
   *     unchanged. This is the same real incident (two desktop-database
   *     imports sharing a username) `pullAndApply`'s own "Per-row apply
   *     conflicts" doc comment describes.
   */
  private async applyRow(
    row: LogRow,
  ): Promise<{ discardedPlaceholder: boolean }> {
    if (row.op === 'delete') {
      await this.db.run(`DELETE FROM "${row.tableName}" WHERE uuid = @uuid`, {
        uuid: row.rowUuid,
      });
      return { discardedPlaceholder: false };
    }

    const schema = await this.getTableSchema(row.tableName);
    const json = JSON.parse(row.rowJson) as Record<string, unknown>;
    const fkColumns = new Set(schema.foreignKeys.map((fk) => fk.from));

    const naturalKeyColumn = NATURAL_KEY_TABLES.get(row.tableName);
    if (naturalKeyColumn !== undefined) {
      const naturalKeyValue = json[naturalKeyColumn];
      if (naturalKeyValue !== null && naturalKeyValue !== undefined) {
        const existing = await this.db.get<{
          uuid: string;
          updatedAt: string | null;
        }>(
          `SELECT "uuid", "updatedAt" FROM "${row.tableName}" WHERE "${naturalKeyColumn}" = @naturalKeyValue`,
          { naturalKeyValue },
        );
        if (existing !== undefined && existing.uuid !== row.rowUuid) {
          const incomingUpdatedAt =
            typeof json.updatedAt === 'string' ? json.updatedAt : null;
          const localUpdatedAt = existing.updatedAt;
          const incomingWins =
            incomingUpdatedAt !== null &&
            (localUpdatedAt === null ||
              incomingUpdatedAt > localUpdatedAt ||
              (incomingUpdatedAt === localUpdatedAt &&
                row.rowUuid > existing.uuid));
          if (!incomingWins) {
            // The local row already reflects the winning write for this
            // key — discard the incoming (older, or tiebreak-losing) row
            // rather than write it. Not an error, not a conflict: just the
            // correct outcome of the LWW comparison. Not counted in
            // `discardedPlaceholderUsers` (that bucket is specific to the
            // `users.username` placeholder rule below) — this LWW discard
            // has no dedicated counter of its own, matching its pre-existing
            // "just correctly discarded" treatment.
            return { discardedPlaceholder: false };
          }
          await this.db.run(
            `DELETE FROM "${row.tableName}" WHERE "${naturalKeyColumn}" = @naturalKeyValue AND "uuid" != @uuid`,
            { naturalKeyValue, uuid: row.rowUuid },
          );
        }
      }
    }

    const params: Record<string, unknown> = {};
    const columns: string[] = [];

    for (const column of schema.columns) {
      if (column === 'id') continue; // local-autoincrement, never carried over
      if (!fkColumns.has(column)) {
        const hexKey = `${column}__hex`;
        const hexValue = json[hexKey];
        if (typeof hexValue === 'string') {
          // Declared-blob column (see migration 029's jsonObjectExpr doc
          // comment): the origin device's value was an actual runtime blob,
          // hex-encoded because JSON cannot hold one directly. Decode it
          // back into real bytes rather than falling through to the plain
          // `json[column]` (NULL) branch below.
          columns.push(column);
          params[column] = hexToBytes(hexValue);
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(json, column)) continue; // source predates this column
        columns.push(column);
        params[column] = json[column];
        continue;
      }

      // FK column: resolve via its `_uuid` sibling, never the raw json value.
      const uuidKey = `${column}_uuid`;
      const refUuid = json[uuidKey];
      if (refUuid === null || refUuid === undefined) {
        columns.push(column);
        params[column] = null;
        continue;
      }

      const fk = schema.foreignKeys.find((f) => f.from === column)!;
      // eslint-disable-next-line no-await-in-loop
      const resolved = await this.db.get<{ id: number }>(
        `SELECT id FROM "${fk.table}" WHERE uuid = @uuid`,
        { uuid: refUuid },
      );
      if (!resolved) {
        throw new Error(
          `SyncEngine.applyRow: cannot resolve ${row.tableName}.${column}_uuid ` +
            `= ${String(refUuid)} against local "${
              fk.table
            }" — the referenced row ` +
            `hasn't been applied locally yet. This violates the causal-ordering ` +
            `assumption (parent rows must precede child rows in the server log); ` +
            `see SyncEngine's doc comment. (row uuid: ${row.rowUuid}, seq: ${row.seq})`,
        );
      }
      columns.push(column);
      params[column] = resolved.id;
    }

    if (!columns.includes('uuid')) columns.push('uuid');
    params.uuid = row.rowUuid;

    const quoted = columns.map((c) => `"${c}"`).join(', ');
    const placeholders = columns.map((c) => `@${c}`).join(', ');
    // `createdAt` is excluded from the UPDATE branch (but still written on
    // a fresh INSERT, via the column list above) so that re-applying a row
    // that already exists locally — an echo of this device's own earlier
    // push, or a peer's later edit of a row this device already has —
    // never regresses an existing local `createdAt` to whatever the
    // *origin* device's capture trigger happened to see. That value is
    // frequently NULL: migration 029's capture trigger can legitimately
    // fire before the schema's own `after_insert_<table>_add_timestamp`
    // trigger stamps `createdAt` (SQLite's firing order for two AFTER
    // INSERT triggers on the same table is undefined — see migration 029's
    // doc comment), so `rowJson.createdAt` is not something to trust on an
    // UPDATE conflict the way every other column's incoming value is.
    // `updatedAt`, by contrast, IS written on the UPDATE branch (via
    // `excluded."updatedAt"` below) and — since migration 034
    // (src/core/db/migrations/034_suppress_timestamp_triggers_during_apply.ts)
    // — that write is exactly what sticks. Before 034, the pre-existing
    // `after_update_<table>_add_timestamp` trigger unconditionally
    // re-stamped `updatedAt` to THIS (receiving) device's local clock on
    // every UPDATE regardless of what value this statement set it to, which
    // silently discarded the incoming row image's real `updatedAt` and,
    // worse, made a plain re-delivery of an unchanged row look "just
    // edited" to any `updatedAt > createdAt` check (e.g. the invoice list's
    // "Edited" pill — src/renderer/lib/invoiceUtils.ts). Migration 034
    // prepends the same `sync_state.applying`-gated `WHEN` guard migration
    // 029's own capture triggers already use to both `_add_timestamp`
    // triggers, so neither one fires while this method's caller
    // (`pullAndApply`) has that flag set — see migration 034's doc comment
    // for the full incident and fix. `createdAt` above still needs its own
    // exclusion regardless: that column's fragility is on the CAPTURING
    // (origin) device's side (migration 029's insert-capture trigger can
    // legitimately race `after_insert_<table>_add_timestamp` there and
    // capture a `NULL`), which 034 does not and cannot fix from the
    // receiving end.
    const incomingUsersHashMissing =
      row.tableName === 'users' &&
      (params.password_hash === null || params.password_hash === undefined);

    const updateSet = columns
      .filter((c) => c !== 'uuid' && c !== 'createdAt')
      // A later log row with NULL password_hash (capture racing the
      // insert-timestamp trigger on the origin) must not wipe a hash this
      // device already applied from an earlier row — that left Safari
      // able to show the dashboard via a leftover session, then unable
      // to log in after logout.
      .filter((c) => !(incomingUsersHashMissing && c === 'password_hash'))
      .map((c) => `"${c}" = excluded."${c}"`)
      .join(', ');

    const sql =
      updateSet.length > 0
        ? `INSERT INTO "${row.tableName}" (${quoted}) VALUES (${placeholders})
           ON CONFLICT("uuid") DO UPDATE SET ${updateSet}`
        : `INSERT INTO "${row.tableName}" (${quoted}) VALUES (${placeholders})
           ON CONFLICT("uuid") DO NOTHING`;

    if (row.tableName === 'users') {
      return this.applyUsersPut(sql, params, row);
    }

    await this.db.run(sql, params);
    return { discardedPlaceholder: false };
  }

  /**
   * The `users`-specific half of the write `applyRow` above builds for
   * every other table unmodified — see that method's "users.username
   * collision" doc comment for the full rule this implements. Isolated into
   * its own method (rather than inlined into `applyRow`'s tail) purely for
   * readability: `applyRow`'s body is already long, and this rule only ever
   * applies to one table.
   */
  private async applyUsersPut(
    sql: string,
    params: Record<string, unknown>,
    row: LogRow,
  ): Promise<{ discardedPlaceholder: boolean }> {
    try {
      await this.db.run(sql, params);
      return { discardedPlaceholder: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/UNIQUE constraint failed/i.test(message)) throw error;

      const incomingUsername = params.username;
      if (typeof incomingUsername !== 'string') throw error;

      // `users` has exactly two UNIQUE indexes: `uuid` (already handled by
      // the `ON CONFLICT("uuid")` clause above — it can never be what threw
      // here) and `username` (schema.snapshot.sql) — so any UNIQUE
      // violation reaching this catch is a `username` collision against a
      // row this device already has under that same username.
      const localRow = await this.db.get<{
        uuid: string;
        password_hash: unknown;
      }>(`SELECT uuid, password_hash FROM users WHERE username = @username`, {
        username: incomingUsername,
      });
      if (!localRow) throw error; // Defensive: couldn't reproduce the collision — surface the original error rather than guess.

      const localHasCredential =
        localRow.password_hash !== null && localRow.password_hash !== undefined;
      const incomingHasCredential =
        params.password_hash !== null && params.password_hash !== undefined;

      if (!localHasCredential && incomingHasCredential) {
        // The local row is THIS device's own boot-time placeholder (see
        // db.worker.ts's ensurePlaceholderDefaultUser/placeholderUser.ts)
        // and a real, credentialed user just arrived under the same
        // username from another device — the real incident this rule
        // exists for. The real user wins: remove the placeholder and its
        // scaffolding charts (mirrors syncManager.ts's
        // `clearBootPlaceholder` — same `password_hash IS NULL`
        // load-bearing guard, so this can never delete a real,
        // password-protected account that happens to be literally named
        // `PLACEHOLDER_USERNAME`), then retry the insert once. Both
        // deletes run inside the same "applying"-flagged page transaction
        // pullAndApply already has open — echo-suppressed like any other
        // write made while applying, so neither re-enters this device's
        // own sync_outbox.
        await this.db.run(
          `DELETE FROM chart WHERE userId = (SELECT id FROM users WHERE username = @username AND password_hash IS NULL)`,
          { username: incomingUsername },
        );
        await this.db.run(
          `DELETE FROM users WHERE username = @username AND password_hash IS NULL`,
          { username: incomingUsername },
        );
        await this.db.run(sql, params);
        return { discardedPlaceholder: false };
      }

      if (localHasCredential && !incomingHasCredential) {
        // The mirror image: this device already has a real, credentialed
        // user under this username, and a NULL-credential row just arrived
        // — almost certainly another device's own boot-time placeholder
        // (expected noise, not data needing review). Discard it silently:
        // never quarantine, never write.
        this.logger.info(
          `SyncEngine.applyRow: discarding an incoming passwordless 'users' ` +
            `row (username "${incomingUsername}") that collided with a local, ` +
            `credentialed user of the same username — almost certainly ` +
            `another device's boot-time placeholder scaffolding (see ` +
            `db.worker.ts's ensurePlaceholderDefaultUser). Not an error, not ` +
            `a conflict: nothing to reconcile. (row uuid: ${row.rowUuid}, ` +
            `seq: ${row.seq})`,
        );
        return { discardedPlaceholder: true };
      }

      // Neither side of the placeholder rule applies (both credentialed —
      // or both passwordless — under the same username): a genuine
      // identity collision, not the placeholder pattern this method
      // special-cases. Re-throw so pullAndApply's existing quarantine
      // behavior (record into sync_apply_conflicts, cursor still advances)
      // takes over exactly as it did before this rule existed.
      throw error;
    }
  }

  /**
   * Records a row `applyRow` failed to apply into `sync_apply_conflicts`
   * (migration 030) — the audit trail for the "advance the cursor past it
   * anyway" trade-off described in `pullAndApply`'s doc comment. Called
   * from inside the same outer page transaction `pullAndApply` already has
   * open, after the row's own nested savepoint has rolled back — this is
   * therefore a plain (non-nested) write against a table that carries no
   * capture triggers of its own (it isn't in `SYNC_TABLES`), so it needs no
   * echo-suppression handling and can never itself produce a conflict.
   */
  private async recordApplyConflict(row: LogRow, error: string): Promise<void> {
    await this.db.run(
      `INSERT INTO sync_apply_conflicts (seq, tableName, rowUuid, op, rowJson, error, createdAt)
       VALUES (@seq, @tableName, @rowUuid, @op, @rowJson, @error, datetime('now'))`,
      {
        seq: row.seq,
        tableName: row.tableName,
        rowUuid: row.rowUuid,
        op: row.op,
        rowJson: row.rowJson,
        error,
      },
    );
  }

  private async getTableSchema(table: string): Promise<TableSchema> {
    const cached = this.schemaCache.get(table);
    if (cached) return cached;

    const columnRows = await this.db.all<{ name: string }>(
      `PRAGMA table_info("${table}")`,
    );
    const fkRows = await this.db.all<{ from: string; table: string }>(
      `PRAGMA foreign_key_list("${table}")`,
    );
    const seen = new Set<string>();
    const foreignKeys: ForeignKeyRef[] = [];
    for (const fk of fkRows) {
      if (seen.has(fk.from)) continue;
      seen.add(fk.from);
      foreignKeys.push({ from: fk.from, table: fk.table });
    }

    const schema: TableSchema = {
      columns: columnRows.map((c) => c.name),
      foreignKeys,
    };
    this.schemaCache.set(table, schema);
    return schema;
  }

  // ---------------------------------------------------------------------
  // sync_state helpers
  // ---------------------------------------------------------------------

  private async getCursor(): Promise<number> {
    const row = await this.db.get<{ value: string }>(
      `SELECT value FROM sync_state WHERE key = 'cursor'`,
    );
    return row ? Number(row.value) : 0;
  }

  private async setCursor(seq: number): Promise<void> {
    await this.db.run(
      `INSERT INTO sync_state (key, value) VALUES ('cursor', @value)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      { value: String(seq) },
    );
  }

  private async setApplying(applying: boolean): Promise<void> {
    if (applying) {
      await this.db.run(
        `INSERT INTO sync_state (key, value) VALUES ('applying', '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );
    } else {
      await this.db.run(`DELETE FROM sync_state WHERE key = 'applying'`);
    }
  }
}
