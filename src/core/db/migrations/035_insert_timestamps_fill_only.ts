import type { DatabaseDriver } from '../driver';

/**
 * Migration 035 — the third wave of the same timestamp-fidelity saga
 * migration 034's doc comment tells the first two chapters of (`sync apply`
 * clobbering a pulled row's true timestamps, fixed by suppressing the
 * `_add_timestamp` triggers while `sync_state.applying` is set) and, before
 * that, `029_create_sync_tables.ts`'s own doc comment ("The `createdAt`/
 * `updatedAt` stomping ... is consciously NOT worked around the same way").
 * This one is a plain desktop-file import, no sync involved at all. Has a
 * desktop-side twin, `src/main/migrations/035.js` — same reason migrations
 * 028-034 do (see `030_create_sync_apply_conflicts.ts`'s doc comment): the
 * existing Electron install path runs schema changes exclusively through the
 * old synchronous `MigrationRunner`, which never calls `bootstrapDatabase`,
 * so a schema change meant to reach it has to be expressed twice.
 *
 * ## The bug
 *
 * `importDatabase`'s `copyTable` (`src/core/db/import.ts`) copies an
 * uploaded desktop file's rows into the target one INSERT per row, with the
 * source row's TRUE `createdAt`/`updatedAt` in the INSERT's own explicit
 * column list (see `copyTable`'s doc comment — `id`s and every intersecting
 * column, including these two, are preserved verbatim). But
 * `after_insert_<table>_add_timestamp` — even after migration 034 — still
 * unconditionally sets BOTH columns to `datetime(CURRENT_TIMESTAMP,
 * 'localtime')` on any INSERT that isn't running under
 * `sync_state.applying`, and a plain "bring your database" import is
 * exactly that: an ordinary local write, `applying` unset, from `copyTable`'s
 * point of view indistinguishable from a user typing a new invoice. The
 * trigger stomps right back over the row image `copyTable` just inserted —
 * proven with a probe: an INSERT carrying explicit `'2015-05-30 10:00:00'`
 * `createdAt`/`updatedAt` reads back stamped with today's date the instant
 * the statement completes, same mechanism migration 034 diagnosed for sync,
 * just triggered by a different caller.
 *
 * In the field this (compounded by the historic migration-era `UPDATE`
 * sweep noted below) made the invoice list's "Edited" pill
 * (`updatedAt > createdAt`, `src/renderer/lib/invoiceUtils.ts`'s
 * `isInvoiceEditedSnapshot`) light up on roughly 12,000 imported invoices,
 * of which only 43 had actually been edited since import.
 *
 * ## Why 034's fix (the `APPLYING_GUARD` `WHEN` clause) doesn't cover this
 *
 * 034 made the trigger a no-op specifically while `sync_state.applying` is
 * set, because sync apply is the one write path where "this device's local
 * clock" is provably the wrong timestamp source — the row didn't just
 * happen here. Import is a DIFFERENT write path with the SAME property
 * (the row's real history predates this device seeing it) but it was never
 * routed through `sync_state.applying`, and it shouldn't be: `applying` also
 * suppresses migration 029's capture triggers (`trg_sync_capture_<table>_*`
 * — see that migration's "Echo suppression" doc comment), and an imported
 * row is real, new, user-visible data on this device that a sync project
 * this device later joins DOES need to know about — it must still be
 * captured to `sync_outbox` like any other local write. Reusing `applying`
 * for import would have fixed this bug by breaking sync onboarding for
 * every imported business. So this migration doesn't touch the guard at
 * all; it changes what the trigger does whenever it DOES fire.
 *
 * ## The fix — fill only a column the INSERT actually left NULL
 *
 * Regenerate every `after_insert_<table>_add_timestamp` trigger (same
 * discover-by-name-from-`sqlite_master`, rebuild-from-template algorithm as
 * 034 — see that migration's "How the triggers are found and rebuilt" doc
 * comment, which applies here unchanged), keeping 034's `APPLYING_GUARD` on
 * the `WHEN` clause exactly as-is (regenerated as part of the same rebuild,
 * not dropped — a sync apply must still skip this trigger entirely, for the
 * capture-suppression reason above).
 *
 * The semantics split cleanly on whether the triggering `INSERT` supplied
 * these columns:
 *   - **No `createdAt`/`updatedAt` in the INSERT** (every ordinary
 *     application write — every `INSERT` this codebase's services issue
 *     omits both columns and lets the trigger fill them; verified by grep
 *     across `src/core/services/*.ts` and `src/main/services/*.ts` for
 *     `createdAt`/`updatedAt` — every hit is a `SELECT` column reference or,
 *     for `settings`, `SettingsService`'s own explicit `updatedAt` write
 *     against a table that has no `_add_timestamp` trigger at all, per
 *     034's doc comment; nothing else inserts either column). SQLite leaves
 *     an omitted column NULL on insert (both columns have no `DEFAULT` and
 *     are nullable — `src/sql/schema.sql`), so the trigger fills both — the
 *     same result as pre-035, unchanged.
 *   - **`createdAt`/`updatedAt` explicitly provided** — today, only
 *     `copyTable`'s import INSERT (`SyncEngine.applyRow`'s INSERT also
 *     supplies both, but only ever fires under `APPLYING_GUARD`, which
 *     already short-circuits this trigger entirely — this migration changes
 *     nothing about that path). Neither column is NULL, so the trigger fills
 *     neither: the imported row's real creation/edit time survives
 *     untouched, which is the entire fix.
 *
 * ### Why the fill is written as two `WHERE ... AND <column> IS NULL`
 * `UPDATE`s, not one `COALESCE`-everything `UPDATE` — the actual bug this
 * shape avoids
 *
 * The obvious-looking version — one `UPDATE` setting
 * `createdAt = COALESCE(createdAt, datetime(...))` and
 * `updatedAt = COALESCE(updatedAt, datetime(...))` in the same statement —
 * looks like it does exactly what's described above, and for `createdAt`
 * alone it does. It does NOT work for `updatedAt`, and the reason is a real
 * SQLite trigger-cascade subtlety caught by this migration's own test suite,
 * not by inspection: **any `UPDATE` statement that touches at least one row
 * — including the `UPDATE` an `AFTER INSERT` trigger runs internally —
 * fires every `AFTER UPDATE` trigger defined on that table for the columns
 * it touches, even with `PRAGMA recursive_triggers` off.** That pragma only
 * suppresses a trigger from re-firing itself (or another trigger of the
 * *same* statement type) recursively; it does nothing to stop an `INSERT`
 * trigger's `UPDATE` from cascading into a *different* trigger of `UPDATE`
 * type — that is an intentional, always-on cascade, not the "recursion" the
 * pragma is about. So a single combined `UPDATE` — even one that only
 * assigns `updatedAt` back to the exact value it already had — still counts
 * as "an `UPDATE` happened to this row" and unconditionally fires
 * `after_update_<table>_add_timestamp` (left untouched by this migration,
 * see below), which promptly re-stamps `updatedAt` to apply-time anyway,
 * silently undoing the `COALESCE` the instant it ran. `createdAt` survives
 * that combined version only by accident, because the update trigger never
 * touches `createdAt` at all.
 *
 * The fix is to make the fill `UPDATE`s themselves match **zero rows**
 * whenever there is nothing to fill — a `MATCH`less `UPDATE` never fires any
 * trigger at all (also verified directly, not assumed). Splitting the single
 * statement into two, each additionally restricted to `AND <column> IS
 * NULL`, does exactly that per column independently:
 *   - column already non-NULL (import) → the `WHERE` clause matches no row →
 *     the `UPDATE` is a true no-op → no cascade → `after_update_<table>_
 *     add_timestamp` never fires → the value import supplied survives.
 *   - column NULL (ordinary write) → the `WHERE` clause matches the new row
 *     → the `UPDATE` sets it to now, exactly as before → this DOES cascade
 *     into `after_update_<table>_add_timestamp`, which sets `updatedAt` to
 *     now too — but that is the same value this trigger was about to write
 *     itself, so the redundant write is unobservable. (For `createdAt`'s own
 *     fill `UPDATE`, the same cascade fires too, for the same reason, and is
 *     equally harmless — it only ever writes `updatedAt`, and only to the
 *     value already being produced for an ordinary write.)
 * `COALESCE` is kept in each statement's `SET` anyway (defensive, not
 * load-bearing — the `WHERE ... IS NULL` guard already guarantees the
 * column being written is NULL in every row either statement can reach) so
 * the SQL reads the same "fill, don't overwrite" intent at the point that
 * actually matters, the `SET` clause, rather than requiring the reader to
 * reconstruct that intent solely from the `WHERE` clause.
 *
 * ### A second, independent source of the exact same cascade — and the one
 * residual case this migration does NOT close
 *
 * The two-`UPDATE` shape above stops THIS trigger's own fill from causing
 * the cascade. It cannot stop a DIFFERENT trigger's `UPDATE` from doing the
 * same thing, and one already exists: migration 029's
 * `trg_sync_capture_<table>_insert` backfills a NULL `uuid` on every INSERT
 * via its own `UPDATE "<table>" SET uuid = ... WHERE id = NEW.id AND uuid IS
 * NULL` (`029_create_sync_tables.ts`). `after_update_<table>_add_timestamp`
 * has no `AFTER UPDATE OF <columns>` restriction — by design, since it must
 * bump `updatedAt` no matter WHICH real column changed — so it cannot tell
 * "a genuine edit to a business column" apart from "a uuid backfill that
 * happens to be an `UPDATE` too", and fires on both. For a row whose `uuid`
 * is already non-NULL at insert time, that backfill `UPDATE` matches zero
 * rows (same no-op-means-no-cascade rule as this migration's own fills) and
 * nothing happens; for a row that still needs a `uuid` generated, it does
 * fire, and it bumps `updatedAt` to apply-time regardless of anything this
 * migration does.
 *
 * This matters, not just as trivia, because it sets the true boundary of
 * this migration's fix: it is complete only for rows whose `uuid` the
 * INSERT already supplied. `copyTable` copies `uuid` like any other
 * intersecting column (`import.ts`'s own doc comment), so a source database
 * already on migration 024+ — which is to say the overwhelming majority of
 * real imports, since 024 shipped years before this incident and every row
 * written since then (via `trg_sync_capture_<table>_insert` itself) already
 * carries one — imports with `uuid` intact and hits none of this. A source
 * that PREDATES 024 (no `uuid` column at all to copy — the exact "older
 * upload" case `validateUploadedDatabase`'s own warning already calls out:
 * "columns it doesn't have yet will be filled by this app's defaults/
 * triggers (e.g. row uuids)") still gets its `uuid`s backfilled on import as
 * before, and — as a documented side effect of that pre-existing, correct
 * backfill, not a new gap this migration introduces — still loses
 * `updatedAt` precision for those specific rows, the same way it always has.
 * Left as-is rather than also giving `after_update_<table>_add_timestamp` an
 * `OF <business columns>` restriction: doing that correctly needs a
 * per-table column list this migration doesn't otherwise need to know
 * (`uuid` is not the only non-business column — `id` isn't either, and
 * enumerating "every column except the bookkeeping ones" generically is a
 * meaningfully bigger, differently-shaped change) to close a residual case
 * this migration's own test suite shows is already narrow and shrinking
 * with time, not the incident's actual shape (a modern, already-migrated
 * business's invoices being falsely marked edited).
 *
 * ## `after_update_<table>_add_timestamp` is deliberately NOT touched
 *
 * Only the insert triggers are regenerated. The update triggers keep
 * unconditionally setting `updatedAt = datetime(CURRENT_TIMESTAMP,
 * 'localtime')` (still behind `APPLYING_GUARD`, from 034) for every
 * non-apply `UPDATE` — a genuine local edit, on an imported row or any
 * other, must still bump `updatedAt` to when the edit actually happened, or
 * this app would silently lose its own ability to timestamp real edits made
 * after import. Migration 032's "IMPORTANT" callout on
 * `openingBalanceBackfill.ts`'s use of a frozen reason literal is the same
 * shape of decision as this one: apply-time-of-fix history and
 * origin-time-of-fact history are different things, and only the latter is
 * what `createdAt`/`updatedAt`/`isInvoiceEditedSnapshot` are meant to
 * capture. `copyTable` never issues an `UPDATE` (each row is inserted
 * exactly once, straight into a table `wipeBusinessData` just cleared, per
 * `import.ts`'s doc comment on integer `id` preservation), so this
 * migration's `INSERT`-only scope covers every write import actually makes.
 * The cascade explained above means the update trigger's body DOES still
 * run once per ordinary (non-import) insert, exactly as it always has since
 * before this migration existed — nothing about that changes; only the
 * import case, where both fill `UPDATE`s become no-ops, is new.
 *
 * ## What this migration does NOT fix — the historic uuid-backfill `UPDATE`
 * sweep, a known, accepted cost
 *
 * Migration 024 (`add_uuid_to_business_tables`) backfilled a `uuid` onto
 * every pre-existing row of every business table via a bulk `UPDATE`, and
 * any future migration that needs to sweep-`UPDATE` populated rows (not
 * just `ALTER TABLE ADD COLUMN`, which touches no existing row's
 * `updatedAt` at all) will hit the exact same `after_update_<table>_
 * add_timestamp` trigger this migration leaves alone — bumping every swept
 * row's `updatedAt` to migration-run time, which reads as "edited" even
 * though nothing about the row's business meaning changed. This migration
 * does not fix that class of bug — it is explicitly out of scope (a
 * migration-time data sweep is a different write path from both sync apply
 * and file import, and "was this UPDATE a real edit" is a question only the
 * sweep itself can answer, not something a schema-level trigger fix can
 * infer generically). Left as a known, documented cost: a FUTURE migration
 * that needs to sweep-`UPDATE` populated rows without those writes counting
 * as edits must handle it itself, the same way `SyncEngine`/the web worker's
 * boot placeholder already do — set `sync_state.applying = '1'` around the
 * sweep (see 034's doc comment's "Echo suppression" section) so both the
 * `_add_timestamp` triggers and the capture triggers skip it, then clear the
 * flag. No such sweep is being added by this migration, so nothing here
 * needs that treatment; it's recorded for whoever writes the next one.
 *
 * ## The repair path
 *
 * Nothing here retroactively fixes an already-imported business's
 * already-stomped timestamps — this migration only changes what happens on
 * the NEXT import. The repair path for a business that already imported
 * under the old (pre-035) behavior is to re-import the same desktop file:
 * `importDatabase`'s replace semantics (see `import.ts`'s top doc comment)
 * wipe and re-copy every business table from scratch, and with this
 * migration in place that re-copy now carries the source file's real
 * `createdAt`/`updatedAt` through end to end, faithfully.
 */

/** Same guard migration 029's capture triggers and migration 034 use — see 034's doc comment. */
const APPLYING_GUARD = `(SELECT value FROM sync_state WHERE key = 'applying') IS NULL`;

/**
 * Recovers a legacy timestamp trigger's table name from its own name — the
 * only input this migration trusts, same reasoning as 034's
 * `parseTimestampTriggerName` (see that migration's top doc comment for why
 * the trigger's stored SQL body is never parsed). Only insert triggers are
 * relevant here — update triggers are left untouched, see this file's doc
 * comment — so this returns the table name directly rather than 034's
 * `{ table, kind }` pair.
 */
export function parseInsertTimestampTriggerName(name: string): string | null {
  const match = /^after_insert_(.+)_add_timestamp$/.exec(name);
  return match ? match[1] : null;
}

/**
 * The regenerated `after_insert_<table>_add_timestamp` body — fill-only,
 * guarded exactly as 034 left it. TWO separate `UPDATE`s, each additionally
 * restricted to `AND <column> IS NULL`, NOT one combined `COALESCE` `UPDATE`
 * — see this file's top doc comment ("Why the fill is written as two ...")
 * for why the obvious single-statement version silently fails to protect
 * `updatedAt` from a same-table `AFTER UPDATE` trigger cascade.
 */
function insertTriggerSql(name: string, table: string): string {
  return `
    CREATE TRIGGER "${name}"
    AFTER INSERT ON "${table}"
    WHEN ${APPLYING_GUARD}
    BEGIN
      UPDATE "${table}" SET
        createdAt = COALESCE(createdAt, datetime(CURRENT_TIMESTAMP, 'localtime'))
      WHERE id = NEW.id AND createdAt IS NULL;
      UPDATE "${table}" SET
        updatedAt = COALESCE(updatedAt, datetime(CURRENT_TIMESTAMP, 'localtime'))
      WHERE id = NEW.id AND updatedAt IS NULL;
    END;
  `;
}

async function tableHasIdColumn(
  driver: DatabaseDriver,
  table: string,
): Promise<boolean> {
  const rows = await driver.all<{ name: string }>(
    `PRAGMA table_info("${table}")`,
  );
  return rows.some((row) => row.name === 'id');
}

export const migration035 = {
  name: '035_insert_timestamps_fill_only',
  async up(driver: DatabaseDriver): Promise<void> {
    const triggers = await driver.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND
         name LIKE 'after_insert_%_add_timestamp'`,
    );

    for (const { name } of triggers) {
      const table = parseInsertTimestampTriggerName(name);
      if (!table) continue; // defensive — the LIKE filter above already guarantees a match
      // eslint-disable-next-line no-await-in-loop
      if (!(await tableHasIdColumn(driver, table))) continue;

      // eslint-disable-next-line no-await-in-loop
      await driver.exec(`DROP TRIGGER "${name}"`);
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(insertTriggerSql(name, table));
    }
  },
};
