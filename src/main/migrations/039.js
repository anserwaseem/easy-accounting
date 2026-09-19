// Migration 034 — desktop-side twin of the platform-free
// '034_suppress_timestamp_triggers_during_apply' migration
// (src/core/db/migrations/034_suppress_timestamp_triggers_during_apply.ts) —
// see that file's doc comment for the full design (the field bug this
// fixes: the schema's pre-existing after_insert/after_update
// "_add_timestamp" triggers unconditionally stomped createdAt/updatedAt
// even when SyncEngine.applyRow was writing a pulled row, clobbering the
// origin device's true timestamps and lighting up the "Edited" pill on
// every synced row; the fix: prepend the same APPLYING_GUARD migration
// 029's own capture triggers use, so a sync apply no longer touches these
// columns at all). Needed for the same reason migrations 028-033 have
// desktop twins (see 030.js's own comment): the existing Electron install
// path runs schema changes exclusively through this synchronous
// MigrationRunner, which never calls bootstrapDatabase, so a schema change
// meant to reach it has to be expressed twice. Shares the exact migration
// `name` with the core version so both runners share one bookkeeping row.
//
// Duplicates the core migration's discover-by-name / regenerate-by-name
// algorithm statement for statement (same reason 029.js/031.js/033.js don't
// import the core .ts modules — a plain synchronous `require()` cannot load
// a .ts module without a build step) rather than re-requiring the core
// file, whose helpers are private to its own `up` closure and not exported.
module.exports = {
  name: '034_suppress_timestamp_triggers_during_apply',
  up: (db) => {
    try {
      const APPLYING_GUARD = `(SELECT value FROM sync_state WHERE key = 'applying') IS NULL`;

      // Recovers { table, kind } from a legacy timestamp trigger's own
      // name — never from its stored SQL body. See the core migration's
      // doc comment for why: schema.sql's historical trigger definitions
      // aren't even whitespace-consistent with each other, so textually
      // parsing/rewriting them would have to handle that variation for no
      // benefit over just rebuilding the (verified uniform) body from the
      // table name alone.
      const parseTimestampTriggerName = (name) => {
        const insertMatch = /^after_insert_(.+)_add_timestamp$/.exec(name);
        if (insertMatch) return { table: insertMatch[1], kind: 'insert' };
        const updateMatch = /^after_update_(.+)_add_timestamp$/.exec(name);
        if (updateMatch) return { table: updateMatch[1], kind: 'update' };
        return null;
      };

      const insertTriggerSql = (name, table) => `
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

      const updateTriggerSql = (name, table) => `
        CREATE TRIGGER "${name}"
        AFTER UPDATE ON "${table}"
        WHEN ${APPLYING_GUARD}
        BEGIN
          UPDATE "${table}" SET
            updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
          WHERE id = NEW.id;
        END;
      `;

      db.transaction(() => {
        const triggers = db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'trigger' AND (
               name LIKE 'after_insert_%_add_timestamp' OR
               name LIKE 'after_update_%_add_timestamp'
             )`,
          )
          .all();

        const tableHasId = (table) =>
          db
            .prepare(`PRAGMA table_info("${table}")`)
            .all()
            .some((column) => column.name === 'id');

        triggers.forEach(({ name }) => {
          const parsed = parseTimestampTriggerName(name);
          if (!parsed) return; // defensive — the LIKE filter above already guarantees a match
          // vendor_stock is composite-PK (no `id`); leave its original
          // timestamp triggers in place rather than rewriting `WHERE id = NEW.id`.
          if (!tableHasId(parsed.table)) return;

          const sql =
            parsed.kind === 'insert'
              ? insertTriggerSql(name, parsed.table)
              : updateTriggerSql(name, parsed.table);

          db.prepare(`DROP TRIGGER "${name}"`).run();
          db.prepare(sql).run();
        });
      })();

      return true;
    } catch (error) {
      console.log('034 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('034 migration completed!');
    }
  },
};
