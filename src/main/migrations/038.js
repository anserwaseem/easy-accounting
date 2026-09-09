// Migration 035 — desktop-side twin of the platform-free
// '035_insert_timestamps_fill_only' migration
// (src/core/db/migrations/035_insert_timestamps_fill_only.ts) — see that
// file's doc comment for the full design (the field bug this fixes: a plain
// "bring your database" import's copyTable INSERTs a row's TRUE
// createdAt/updatedAt in its own explicit column list, but the
// after_insert_<table>_add_timestamp trigger — even after migration 034,
// whose APPLYING_GUARD only covers sync apply, not import — still
// unconditionally stomped both columns to this device's local clock on
// every ordinary INSERT, clobbering the imported business's real history and
// lighting up the "Edited" pill on every imported row; the fix: rebuild the
// trigger's UPDATE to use COALESCE(column, datetime(...)) instead of an
// unconditional datetime(...), so it only FILLS a column the triggering
// INSERT left NULL rather than overwriting a value the INSERT explicitly
// supplied — keeping 034's APPLYING_GUARD WHEN clause exactly as it was).
// Needed for the same reason migrations 028-034 have desktop twins (see
// 030.js's own comment): the existing Electron install path runs schema
// changes exclusively through this synchronous MigrationRunner, which never
// calls bootstrapDatabase, so a schema change meant to reach it has to be
// expressed twice. Shares the exact migration `name` with the core version
// so both runners share one bookkeeping row.
//
// Only the after_insert_<table>_add_timestamp triggers are regenerated here
// — after_update_<table>_add_timestamp is deliberately untouched, see the
// core migration's doc comment for why a genuine local edit must still bump
// updatedAt.
//
// IMPORTANT: each fill is TWO separate `UPDATE ... WHERE id = NEW.id AND
// <column> IS NULL` statements, not one `UPDATE` setting both columns via
// COALESCE. A single combined UPDATE still counts as "an UPDATE happened to
// this row" even when it only reassigns updatedAt back to its own existing
// value, and SQLite fires every AFTER UPDATE trigger on the touched columns
// for ANY UPDATE that touches >=1 row — including one run from inside an
// AFTER INSERT trigger's own body, even with recursive_triggers off (that
// pragma only blocks a trigger from re-firing itself/another trigger of the
// SAME statement type; an INSERT trigger cascading into an UPDATE trigger is
// a different type, not "recursion" in that sense, so it is NOT suppressed).
// That cascade would fire after_update_<table>_add_timestamp — untouched by
// this migration — which unconditionally re-stamps updatedAt to apply-time
// regardless of what the combined UPDATE just set it to, silently undoing
// the fix the instant it ran. An UPDATE matching ZERO rows, by contrast,
// never fires any trigger at all (verified directly) — so restricting each
// column's fill to `WHERE ... AND <column> IS NULL` makes it a true no-op
// (no cascade at all) whenever that column already has a value, e.g. every
// row copyTable (src/core/db/import.ts) inserts. See the core migration's
// doc comment for the full incident and the extended version of this
// explanation.
//
// RESIDUAL CASE this migration does NOT close: migration 029's own
// trg_sync_capture_<table>_insert independently backfills a NULL uuid via
// its own UPDATE ... WHERE uuid IS NULL, and after_update_<table>_
// add_timestamp has no "OF <columns>" restriction, so a row that still
// needs a uuid generated at insert time hits the SAME cascade this
// migration otherwise avoids, regardless of anything here. A source
// database already on migration 024+ (the overwhelming majority of real
// imports) always carries a real uuid on every row, so this doesn't apply
// to them; only a source that predates 024 (no uuid column to copy at all)
// still loses updatedAt precision on import, as a documented side effect of
// the pre-existing, correct uuid backfill — not a new gap. See the core
// migration's doc comment ("A second, independent source of the exact same
// cascade") for the full explanation.
//
// Duplicates the core migration's discover-by-name / regenerate-by-name
// algorithm statement for statement (same reason 029.js/031.js/033.js/034.js
// don't import the core .ts modules — a plain synchronous `require()` cannot
// load a .ts module without a build step) rather than re-requiring the core
// file, whose helpers are private to its own `up` closure and not exported.
module.exports = {
  name: '035_insert_timestamps_fill_only',
  up: (db) => {
    try {
      const APPLYING_GUARD = `(SELECT value FROM sync_state WHERE key = 'applying') IS NULL`;

      // Recovers a legacy insert-timestamp trigger's table name from its
      // own name — never from its stored SQL body. See the core migration's
      // doc comment (via 034's) for why: schema.sql's historical trigger
      // definitions aren't even whitespace-consistent with each other, so
      // textually parsing/rewriting them would have to handle that
      // variation for no benefit over just rebuilding the (verified
      // uniform) body from the table name alone.
      const parseInsertTimestampTriggerName = (name) => {
        const match = /^after_insert_(.+)_add_timestamp$/.exec(name);
        return match ? match[1] : null;
      };

      const insertTriggerSql = (name, table) => `
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

      db.transaction(() => {
        const triggers = db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'trigger' AND
               name LIKE 'after_insert_%_add_timestamp'`,
          )
          .all();

        const tableHasId = (table) =>
          db
            .prepare(`PRAGMA table_info("${table}")`)
            .all()
            .some((column) => column.name === 'id');

        triggers.forEach(({ name }) => {
          const table = parseInsertTimestampTriggerName(name);
          if (!table) return; // defensive — the LIKE filter above already guarantees a match
          if (!tableHasId(table)) return;

          db.prepare(`DROP TRIGGER "${name}"`).run();
          db.prepare(insertTriggerSql(name, table)).run();
        });
      })();

      return true;
    } catch (error) {
      console.log('035 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('035 migration completed!');
    }
  },
};
