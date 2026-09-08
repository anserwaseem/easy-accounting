import type { DatabaseDriver } from '../driver';

/**
 * Migration 034 — fixes a field bug real enough that it was caught on a
 * device that had just joined a sync project: EVERY invoice (and, less
 * visibly, every row of every other replicated table) showed the "Edited"
 * pill (`updatedAt > createdAt` — src/renderer/lib/invoiceUtils.ts's
 * `isInvoiceEditedSnapshot`) immediately after the join finished, and the
 * device had lost every true creation/edit timestamp it pulled down. Has a
 * desktop-side twin, `src/main/migrations/034.js` — same reason migrations
 * 028-033 do (see `030_create_sync_apply_conflicts.ts`'s doc comment): the
 * existing Electron install path runs schema changes exclusively through the
 * old synchronous `MigrationRunner`, which never calls `bootstrapDatabase`,
 * so a schema change meant to reach it has to be expressed twice.
 *
 * ## The bug
 *
 * Every business table carries two triggers frozen into the schema itself
 * (`src/sql/schema.sql` / `schemaSnapshot.ts` — predating migration 029 by a
 * wide margin): `after_insert_<table>_add_timestamp` (sets BOTH `createdAt`
 * and `updatedAt` to `datetime(CURRENT_TIMESTAMP, 'localtime')`, via a nested
 * `UPDATE ... WHERE id = NEW.id`) and `after_update_<table>_add_timestamp`
 * (sets `updatedAt` the same way). Both are unconditional — no `WHEN` clause
 * at all — because until multi-device sync existed, "stamp every write with
 * this device's local clock" was exactly right: a device's own writes are
 * the only writes it ever sees.
 *
 * `SyncEngine.applyRow` (src/core/sync/SyncEngine.ts) changed that: applying
 * a pulled row is *also* an `INSERT`/`UPDATE` against these same tables, and
 * these two triggers cannot tell that write apart from a genuine local one.
 * Two consequences, both load-bearing for the "Edited" pill going haywire:
 *
 *   1. `applyRow`'s upsert `INSERT`'s bare INSERT branch fires
 *      `after_insert_<table>_add_timestamp`, which clobbers the incoming row
 *      image's TRUE `createdAt`/`updatedAt` (captured on the ORIGIN device,
 *      at the row's real creation/edit time) with THIS device's apply-time
 *      clock — for both columns, unconditionally.
 *   2. Any re-delivery of a row this device already has (a peer's later
 *      edit, or simply the exact same row seen twice — echoed pulls,
 *      overlapping sync cycles, a server retry) goes through the upsert's
 *      `ON CONFLICT("uuid") DO UPDATE` branch, firing
 *      `after_update_<table>_add_timestamp`, which bumps `updatedAt` to
 *      apply-time regardless of what the incoming row image actually says
 *      updatedAt should be.
 *
 * Migration 029's own capture triggers (`trg_sync_capture_<table>_insert/
 * update/delete`) already solved exactly this class of problem for
 * themselves — see that migration's "Echo suppression" doc comment — with a
 * `WHEN` guard: `(SELECT value FROM sync_state WHERE key = 'applying') IS
 * NULL`. `SyncEngine` sets `sync_state.applying = '1'` for the duration of
 * every apply transaction (see its "Echo suppression" doc comment) and
 * clears it before committing. Migration 029's own doc comment ("The
 * `createdAt`/`updatedAt` stomping ... is consciously NOT worked around the
 * same way") explicitly flagged this exact trigger pair as a known gap left
 * for "whoever builds ... a future timestamp-fidelity pass" — this is that
 * pass.
 *
 * ## The fix
 *
 * Prepend the exact same `APPLYING_GUARD` migration 029 already uses to a
 * `WHEN` clause on every `after_insert_<table>_add_timestamp` /
 * `after_update_<table>_add_timestamp` trigger. Once suppressed during
 * apply, `applyRow`'s own INSERT/UPDATE statement is the only thing left
 * writing `createdAt`/`updatedAt` on that write, and it already writes the
 * row image's own columns verbatim (`createdAt` is in the INSERT's column
 * list, sourced straight from `rowJson.createdAt`; `updatedAt` is written on
 * both the INSERT and the `ON CONFLICT ... DO UPDATE` branches, sourced from
 * `rowJson.updatedAt` — see `applyRow`'s doc comment, updated alongside this
 * migration to describe the post-034 behavior instead of the pre-034
 * "gets stomped right back anyway" one) — exactly the fidelity this bug
 * report wants: a pulled row's `createdAt`/`updatedAt` on the receiving
 * device are now byte-for-byte the values the ORIGIN device captured, and a
 * re-delivered identical row is a true no-op for the "Edited" pill's
 * `updatedAt > createdAt` predicate, because `updatedAt` no longer moves at
 * all on a redelivery that doesn't actually change it.
 *
 * ## Local, user-initiated writes are unaffected — this is the one
 * subtlety worth restating explicitly
 *
 * `sync_state.applying` is set ONLY for the duration of `SyncEngine`'s own
 * apply transactions (`pullAndApply`'s per-page transaction,
 * `rebuildFromServer`'s wipe transaction) and — unrelated to sync but the
 * same flag, deliberately reused — while the web worker creates its boot
 * placeholder scaffolding (`withCaptureSuppressed` wrapping
 * `ensurePlaceholderDefaultUser`, apps/web/src/worker/db.worker.ts). That
 * second caller means this migration ALSO stops the placeholder's own
 * `users`/`chart` rows getting timestamp-stamped at creation — acceptable
 * on purpose: those rows are throwaway device-local scaffolding (their
 * `uuid`s are already assigned by hand inside that same wrapper for the
 * same fired-trigger-was-doing-double-duty reason — see its doc comment),
 * nothing reads their `createdAt`/`updatedAt`, and they are deleted the
 * moment a real user registers or the device joins a sync project. An ordinary
 * desktop or web write — a user editing an invoice, `JournalService`
 * posting a journal, the boot-time placeholder user's own creation — never
 * sets this flag, so `APPLYING_GUARD` evaluates to `IS NULL` (true) for
 * every one of them, exactly as before this migration: `createdAt` is
 * stamped once on insert, `updatedAt` is stamped on every subsequent update,
 * both to THIS device's local clock, same as every desktop install has
 * behaved since long before sync existed. Nothing about a normal write's
 * timestamp behavior changes.
 *
 * ## How the triggers are found and rebuilt — regenerated from the trigger's
 * OWN NAME, never parsed out of its stored SQL text
 *
 * This migration queries `sqlite_master` for every trigger whose name
 * matches `after_insert_%_add_timestamp` or `after_update_%_add_timestamp`
 * — discovering the table list from the live schema rather than hardcoding
 * one (the same reasoning migration 029's `createCaptureTriggers` loop over
 * {@link import('./029_create_sync_tables').SYNC_TABLES} already follows,
 * just driven by `sqlite_master` instead of a fixed array, since this
 * migration also has to reach `ledger` — see below). For each match, the
 * table name is recovered from the TRIGGER'S NAME (stripping the fixed
 * `after_insert_`/`after_update_` prefix and `_add_timestamp` suffix) and
 * used to REGENERATE the trigger body from the uniform template below —
 * never by textually rewriting whatever SQL `sqlite_master` happens to have
 * stored for it (fragile: `schema.sql`'s own historical trigger definitions
 * are not even whitespace-consistent with each other — compare
 * `after_insert_account_add_timestamp`'s indentation with
 * `after_insert_attribute_definitions_add_timestamp`'s — so pattern-matching
 * or splicing a `WHEN` clause into existing text would have to handle that
 * variation correctly, for no benefit over just rebuilding it).
 *
 * This is safe because the shape genuinely is uniform. Verified by hand
 * against every creation site: `src/sql/schema.sql` (the ONLY place
 * `ledger`, `account`, `chart`, `users`, `journal`, and `journal_entry`'s
 * pairs are created — they predate the migration system entirely) and every
 * historical `src/main/migrations/NNN.js` file that creates one of these
 * triggers (001, 002, 003, 008, 014, 015, 020 — found via `grep -rl
 * add_timestamp src/main/migrations`). Every single one of the 32 pairs (16
 * tables × insert/update) is textually identical modulo the table name and
 * incidental whitespace: `after_insert_<table>_add_timestamp` sets
 * `createdAt` AND `updatedAt` to `datetime(CURRENT_TIMESTAMP, 'localtime')`
 * where `id = NEW.id`; `after_update_<table>_add_timestamp` sets only
 * `updatedAt` the same way, same `WHERE`. No deviation was found — if a
 * future table's trigger is ever hand-written differently, this migration's
 * own regenerated version would silently normalize it to the standard shape
 * (and lose whatever the deviation was for), which is a risk worth noting
 * even though nothing in this schema today exercises it.
 *
 * `ledger` gets its pair regenerated too, even though `ledger` is
 * deliberately excluded from `SYNC_TABLES` (migration 029's `SYNC_TABLES`
 * doc comment — it's a derived/legacy table, never written by `applyRow`).
 * This is harmless, not incidental: `sqlite_master` naming alone can't tell
 * "replicated" apart from "not," and `ledger`'s own triggers only ever fire
 * on `INSERT`/`UPDATE` — `rebuildFromServer`'s one write against `ledger`
 * during an "applying"-flagged transaction is a `DELETE` (see that method's
 * doc comment), which neither trigger fires for regardless of the guard —
 * so suppressing them for consistency costs nothing and keeps this
 * migration's logic table-list-free rather than carrying a `!== 'ledger'`
 * special case for no functional gain.
 *
 * `settings` (migration 033) has no `_add_timestamp` trigger at all —
 * `SettingsService` sets `updatedAt` itself on every write rather than
 * relying on a trigger — so the `sqlite_master` query simply never matches
 * it; nothing to do there.
 *
 * ## Why no runtime guard on `sync_state` existing
 *
 * The regenerated `WHEN` clause references `sync_state`, which migration 029
 * creates. This migration is registered in `CORE_MIGRATIONS`
 * (`src/core/db/migrations/index.ts`) immediately after 033, itself after
 * 029 — `bootstrapDatabase` runs `CORE_MIGRATIONS` in array order (see that
 * file's top doc comment), so by the time this migration's `up()` ever
 * runs, `sync_state` unconditionally already exists. Rather than defensively
 * checking for it at runtime (dead code on every real code path, since the
 * ordering is enforced by this migration's own position in the array, not by
 * anything this file could fail to see), that ordering is asserted directly
 * in this migration's own test (`__tests__/034_suppress_timestamp_triggers_during_apply.test.ts`)
 * — the same choice migration 031 makes for the equivalent "029 already ran"
 * assumption its own `SYNC_TABLES`/`createCaptureTriggers` reuse rests on.
 */

/** Same guard migration 029's capture triggers use — see that migration's "Echo suppression" doc comment. */
const APPLYING_GUARD = `(SELECT value FROM sync_state WHERE key = 'applying') IS NULL`;

interface TimestampTrigger {
  table: string;
  kind: 'insert' | 'update';
}

/**
 * Recovers `{ table, kind }` from a legacy timestamp trigger's own name —
 * the only input this migration trusts (see this file's top doc comment for
 * why the trigger's stored SQL body is never parsed). Returns `null` for
 * anything that doesn't match either shape; the `sqlite_master` query this
 * feeds already filters to exactly these two `LIKE` patterns, so `null`
 * should never actually occur outside a defensive check.
 */
export function parseTimestampTriggerName(
  name: string,
): TimestampTrigger | null {
  const insertMatch = /^after_insert_(.+)_add_timestamp$/.exec(name);
  if (insertMatch) return { table: insertMatch[1], kind: 'insert' };
  const updateMatch = /^after_update_(.+)_add_timestamp$/.exec(name);
  if (updateMatch) return { table: updateMatch[1], kind: 'update' };
  return null;
}

/** The uniform `after_insert_<table>_add_timestamp` body, guarded — see this file's doc comment. */
function insertTriggerSql(name: string, table: string): string {
  return `
    CREATE TRIGGER "${name}"
    AFTER INSERT ON "${table}"
    WHEN ${APPLYING_GUARD}
    BEGIN
      UPDATE "${table}" SET
        createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
        updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
      WHERE id = NEW.id;
    END;
  `;
}

/** The uniform `after_update_<table>_add_timestamp` body, guarded — see this file's doc comment. */
function updateTriggerSql(name: string, table: string): string {
  return `
    CREATE TRIGGER "${name}"
    AFTER UPDATE ON "${table}"
    WHEN ${APPLYING_GUARD}
    BEGIN
      UPDATE "${table}" SET
        updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
      WHERE id = NEW.id;
    END;
  `;
}

export const migration034 = {
  name: '034_suppress_timestamp_triggers_during_apply',
  async up(driver: DatabaseDriver): Promise<void> {
    const triggers = await driver.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND (
         name LIKE 'after_insert_%_add_timestamp' OR
         name LIKE 'after_update_%_add_timestamp'
       )`,
    );

    for (const { name } of triggers) {
      const parsed = parseTimestampTriggerName(name);
      if (!parsed) continue; // defensive — the LIKE filter above already guarantees a match

      const sql =
        parsed.kind === 'insert'
          ? insertTriggerSql(name, parsed.table)
          : updateTriggerSql(name, parsed.table);

      // eslint-disable-next-line no-await-in-loop
      await driver.exec(`DROP TRIGGER "${name}"`);
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(sql);
    }
  },
};
