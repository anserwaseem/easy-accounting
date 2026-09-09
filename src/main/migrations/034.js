// Migration 031 — desktop-side twin of the platform-free
// '031_replicate_blob_columns' migration (src/core/db/migrations/
// 031_replicate_blob_columns.ts) — see that file's doc comment for the full
// design (the field bug this fixes: a declared-BLOB column, today only
// users.password_hash, was excluded from every captured row image
// entirely, so `users` replicated with no credential material and a second
// device could never log in). Needed for the same reason migrations
// 028/029/030 have desktop twins (see 030.js's own comment): the existing
// Electron install path runs schema changes exclusively through this
// synchronous MigrationRunner, which never calls bootstrapDatabase, so a
// schema change meant to reach it has to be expressed twice. Shares the
// exact migration `name` with the core version so both runners share one
// bookkeeping row. Duplicates 029.js's trigger-generation algorithm
// statement for statement (same reason 029.js itself doesn't import the
// core .ts builder — a plain synchronous `require()` cannot load a .ts
// module without a build step) rather than re-requiring 029.js, whose
// helpers are private to its own `up` closure and not exported.
module.exports = {
  name: '031_replicate_blob_columns',
  up: (db) => {
    try {
      // Same list as 029.js's own SYNC_TABLES (src/core/db/import.ts's
      // BUSINESS_TABLES minus `ledger`).
      const SYNC_TABLES = [
        'users',
        'chart',
        'discount_profiles',
        'item_types',
        'price_lists',
        'attribute_definitions',
        'account',
        'inventory',
        'inventory_opening_stock',
        'inventory_prices',
        'stock_adjustments',
        'profile_type_discounts',
        'invoices',
        'invoice_items',
        'journal',
        'journal_entry',
      ];

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
        // Recreate the capture triggers for every replicated table that has
        // at least one declared-blob column (today: only `users`) — see the
        // core migration's doc comment for why every other table is left
        // untouched.
        SYNC_TABLES.forEach((table) => {
          const columns = allColumnInfo(table);
          if (!columns.some((c) => c.isBlob)) return;

          db.prepare(
            `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_insert"`,
          ).run();
          db.prepare(
            `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_update"`,
          ).run();
          db.prepare(
            `DROP TRIGGER IF EXISTS "trg_sync_capture_${table}_delete"`,
          ).run();
          createCaptureTriggers(table);
        });

        // Corrective row images for `users` only — the `password_hash IS
        // NOT NULL` guard is load-bearing: see the core migration's doc
        // comment for why a device holding a hash-less local copy (one that
        // joined sync before this fix) must NOT re-emit it, which would
        // clobber a genuinely-good row via last-writer-wins log order.
        const usersColumns = allColumnInfo('users');
        const usersFks = foreignKeys('users');
        const usersSelfJson = jsonObjectExpr(
          usersColumns,
          usersFks,
          (c) => `u."${c}"`,
        );

        // idempotencyKey derived from the row's own uuid, not
        // UUID_V4_SQL_EXPR: the latter is a non-correlated scalar subquery
        // SQLite evaluates once per STATEMENT, so a bulk seed matching two
        // or more users (any multi-employee business) would give every row
        // the same key and fail on sync_outbox's UNIQUE constraint — see
        // the core twin's comment.
        db.prepare(
          `
            INSERT INTO sync_outbox (idempotencyKey, tableName, rowUuid, op, rowJson, createdAt)
            SELECT u."uuid" || ':corrective-031', 'users', u."uuid", 'put', ${usersSelfJson}, datetime('now')
            FROM "users" u
            WHERE u."password_hash" IS NOT NULL
          `,
        ).run();
      })();

      return true;
    } catch (error) {
      console.log('031 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('031 migration completed!');
    }
  },
};
