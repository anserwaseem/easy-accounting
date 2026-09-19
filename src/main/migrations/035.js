// Migration 030 — desktop-side twin of the platform-free
// '030_create_sync_apply_conflicts' migration (src/core/db/migrations/
// 030_create_sync_apply_conflicts.ts) — see that file's doc comment for the
// full design (the real duplicate-seed incident this table's the audit
// trail for, and the "advance the cursor past a conflicted row anyway"
// trade-off it encodes). Needed for the same reason migrations 028/029 have
// desktop twins (see 028.js's own comment): the existing Electron install
// path runs schema changes exclusively through this synchronous
// MigrationRunner, which never calls bootstrapDatabase, so a schema change
// meant to reach it has to be expressed twice. Shares the exact migration
// `name` with the core version so both runners share one bookkeeping row.
module.exports = {
  name: '030_create_sync_apply_conflicts',
  up: (db) => {
    try {
      db.prepare(
        `
          CREATE TABLE IF NOT EXISTS sync_apply_conflicts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            seq INTEGER NOT NULL,
            tableName TEXT NOT NULL,
            rowUuid TEXT NOT NULL,
            op TEXT NOT NULL CHECK (op IN ('put', 'delete')),
            rowJson TEXT NOT NULL,
            error TEXT NOT NULL,
            createdAt DATETIME
          )
        `,
      ).run();
      return true;
    } catch (error) {
      return error;
    }
  },
};
