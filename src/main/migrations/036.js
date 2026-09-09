// Migration 033 — desktop-side twin of the platform-free
// '033_sync_settings' migration (src/core/db/migrations/033_sync_settings.ts)
// — see that file's doc comment for the full design (why `settings` needed
// a schema rebuild before it could replicate, per-key last-writer-wins
// instead of per-row, and why secret setting keys are excluded from the
// corrective outbox seeding). Needed for the same reason migrations
// 028-032 have desktop twins (see 030.js's own comment): the existing
// Electron install path runs schema changes exclusively through this
// synchronous MigrationRunner, which never calls bootstrapDatabase, so a
// schema change meant to reach it has to be expressed twice. Shares the
// exact migration `name` with the core version so both runners share one
// bookkeeping row. Duplicates 029.js's trigger-generation algorithm
// statement for statement (same reason 029.js/031.js/032.js don't import
// the core .ts modules — a plain synchronous `require()` cannot load a .ts
// module without a build step) rather than re-requiring 029.js, whose
// helpers are private to its own `up` closure and not exported.
//
// SECRET_SETTING_KEYS below is duplicated by hand from
// src/core/services/settingsSecrets.ts for the same reason — keep both
// lists in sync.
module.exports = {
  name: '033_sync_settings',
  up: (db) => {
    try {
      const UUID_V4_SQL_EXPR = `(SELECT lower(
          hex(randomblob(4)) || '-' ||
          hex(randomblob(2)) || '-4' ||
          substr(hex(randomblob(2)), 2) || '-' ||
          substr('89ab', abs(random()) % 4 + 1, 1) ||
          substr(hex(randomblob(2)), 2) || '-' ||
          hex(randomblob(6))
        ))`;

      const APPLYING_GUARD = `(SELECT value FROM sync_state WHERE key = 'applying') IS NULL`;
      const CHANGE_IGNORED_COLUMNS = new Set([
        'id',
        'uuid',
        'createdAt',
        'updatedAt',
      ]);

      // Kept in sync by hand with
      // src/core/services/settingsSecrets.ts's SECRET_SETTING_KEYS.
      const SECRET_SETTING_KEYS = [
        'publish.secretAccessKeyEnc',
        'publish.webhookTokenEnc',
      ];

      const allColumnInfo = (table) =>
        db
          .prepare(`PRAGMA table_info("${table}")`)
          .all()
          .map((r) => ({ name: r.name, isBlob: /BLOB/i.test(r.type || '') }));

      const foreignKeys = (table) => {
        const rows = db.prepare(`PRAGMA foreign_key_list("${table}")`).all();
        const seen = new Set();
        const result = [];
        rows.forEach((row) => {
          if (seen.has(row.from)) return;
          seen.add(row.from);
          result.push({ from: row.from, table: row.table });
        });
        return result;
      };

      const jsonObjectExpr = (columns, fks, ref) => {
        const parts = [];
        columns.forEach((col) => {
          if (col.isBlob) {
            parts.push(
              `'${col.name}', CASE WHEN typeof(${ref(
                col.name,
              )}) = 'blob' THEN NULL ELSE ${ref(col.name)} END`,
            );
            parts.push(
              `'${col.name}__hex', CASE WHEN typeof(${ref(
                col.name,
              )}) = 'blob' THEN hex(${ref(col.name)}) ELSE NULL END`,
            );
          } else {
            parts.push(`'${col.name}', ${ref(col.name)}`);
          }
        });
        fks.forEach((fk) => {
          parts.push(
            `'${fk.from}_uuid', (SELECT "uuid" FROM "${
              fk.table
            }" WHERE "id" = ${ref(fk.from)})`,
          );
        });
        return `json_object(${parts.join(', ')})`;
      };

      const realChangeGuardExpr = (columns) => {
        const tracked = columns.filter((c) => !CHANGE_IGNORED_COLUMNS.has(c));
        if (tracked.length === 0) return '1';
        return tracked.map((c) => `NEW."${c}" IS NOT OLD."${c}"`).join(' OR ');
      };

      const createCaptureTriggers = (table) => {
        const columns = allColumnInfo(table);
        const fks = foreignKeys(table);
        const selfJson = jsonObjectExpr(columns, fks, (c) => `t."${c}"`);
        const oldJson = jsonObjectExpr(columns, fks, (c) => `OLD."${c}"`);

        db.prepare(`DROP TRIGGER IF EXISTS "trg_${table}_uuid"`).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS "trg_sync_capture_${table}_insert"
            AFTER INSERT ON "${table}"
            WHEN ${APPLYING_GUARD}
            BEGIN
              UPDATE "${table}" SET "uuid" = ${UUID_V4_SQL_EXPR}
                WHERE "id" = NEW."id" AND "uuid" IS NULL;

              INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
              SELECT ${UUID_V4_SQL_EXPR}, '${table}', t."uuid", 'put', ${selfJson}, datetime('now')
              FROM "${table}" t
              WHERE t."id" = NEW."id";
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS "trg_sync_capture_${table}_update"
            AFTER UPDATE ON "${table}"
            WHEN ${APPLYING_GUARD} AND (${realChangeGuardExpr(
              columns.map((c) => c.name),
            )})
            BEGIN
              INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
              SELECT ${UUID_V4_SQL_EXPR}, '${table}', t."uuid", 'put', ${selfJson}, datetime('now')
              FROM "${table}" t
              WHERE t."id" = NEW."id";
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS "trg_sync_capture_${table}_delete"
            AFTER DELETE ON "${table}"
            WHEN ${APPLYING_GUARD}
            BEGIN
              INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
              VALUES (${UUID_V4_SQL_EXPR}, '${table}', OLD."uuid", 'delete', ${oldJson}, datetime('now'));
            END;
          `,
        ).run();
      };

      db.transaction(() => {
        const settingsCols = db.prepare(`PRAGMA table_info("settings")`).all();
        const hasId = settingsCols.some((c) => c.name === 'id');

        if (!hasId) {
          db.prepare(
            `
              CREATE TABLE settings_sync_rebuild (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL UNIQUE,
                value TEXT,
                updatedAt DATETIME,
                uuid TEXT
              )
            `,
          ).run();
          db.prepare(
            `INSERT INTO settings_sync_rebuild (key, value, updatedAt)
             SELECT key, value, updatedAt FROM settings`,
          ).run();
          db.prepare(`DROP TABLE settings`).run();
          db.prepare(
            `ALTER TABLE settings_sync_rebuild RENAME TO settings`,
          ).run();
        }

        const pending = db
          .prepare(`SELECT id FROM settings WHERE uuid IS NULL`)
          .all();
        const setUuid = db.prepare(
          `UPDATE settings SET uuid = ${UUID_V4_SQL_EXPR} WHERE id = ?`,
        );
        pending.forEach((row) => setUuid.run(row.id));

        db.prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_settings_uuid" ON "settings"("uuid")`,
        ).run();

        // Drop before recreating, unconditionally — see the core twin
        // (src/core/db/migrations/033_sync_settings.ts)'s doc comment for
        // why: on a brand-new install, migration 029 (which now includes
        // `settings` in its SYNC_TABLES, derived live from BUSINESS_TABLES)
        // already installs a trigger for it while `settings` still has the
        // old, pre-rebuild shape; `CREATE TRIGGER IF NOT EXISTS` alone would
        // silently keep that stale trigger instead of replacing it.
        db.prepare(
          `DROP TRIGGER IF EXISTS "trg_sync_capture_settings_insert"`,
        ).run();
        db.prepare(
          `DROP TRIGGER IF EXISTS "trg_sync_capture_settings_update"`,
        ).run();
        db.prepare(
          `DROP TRIGGER IF EXISTS "trg_sync_capture_settings_delete"`,
        ).run();
        createCaptureTriggers('settings');

        // One row at a time, not a single bulk INSERT...SELECT — see the
        // core twin's doc comment: UUID_V4_SQL_EXPR is a non-correlated
        // scalar subquery, which SQLite evaluates ONCE per statement, not
        // once per output row, so a bulk SELECT covering more than one
        // matching setting would give every seeded row the SAME
        // idempotencyKey and hit sync_outbox's UNIQUE constraint on it.
        const excluded = SECRET_SETTING_KEYS.map((k) => `'${k}'`).join(', ');
        const toSeed = db
          .prepare(
            `SELECT key, value, updatedAt, uuid FROM settings WHERE key NOT IN (${excluded})`,
          )
          .all();
        const insertOutbox = db.prepare(
          `INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
           VALUES (${UUID_V4_SQL_EXPR}, 'settings', ?, 'put', ?, datetime('now'))`,
        );
        toSeed.forEach((setting) => {
          insertOutbox.run(
            setting.uuid,
            JSON.stringify({
              key: setting.key,
              value: setting.value,
              updatedAt: setting.updatedAt,
              uuid: setting.uuid,
            }),
          );
        });
      })();

      return true;
    } catch (error) {
      console.log('033 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('033 migration completed!');
    }
  },
};
