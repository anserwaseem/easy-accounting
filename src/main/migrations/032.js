// Migration 029 — desktop-side twin of the platform-free
// '029_create_sync_tables' migration (src/core/db/migrations/
// 029_create_sync_tables.ts) — see that file's doc comment for the full
// design (which tables replicate and why, the two undefined-trigger-order
// hazards this works around, echo suppression, FK-as-uuid row images).
// Needed for the same reason migration 028 has one (see 028.js's own
// comment): existing Electron installs run exclusively through this
// synchronous MigrationRunner, which never calls bootstrapDatabase, so a
// schema change meant to reach them has to be expressed twice. Shares the
// exact migration `name` with the core version so both runners share one
// bookkeeping row (whichever gets there first marks it applied), and the
// generated DDL is kept logically identical (whitespace aside) — this file
// mirrors the core version's trigger-generation algorithm statement for
// statement rather than importing it (a plain synchronous `require()`, the
// way both scripts/generate-schema-snapshot.ts and every *.test.ts here
// load migrations/*.js, cannot load a .ts module without a build step).
module.exports = {
  name: '029_create_sync_tables',
  up: (db) => {
    try {
      // Same list as src/core/db/import.ts's BUSINESS_TABLES minus
      // `ledger` and `vendor_stock` (derived running-quantity tables —
      // never synced, see the core migration's doc comment).
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
        'vendor_issues',
        'vendor_issue_items',
        'vendor_stock_movements',
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

      // Every column on `table`, tagged with whether its declared type is
      // BLOB — mirrors the core migration's `allColumnInfo`/`ColumnInfo`
      // (src/core/db/migrations/029_create_sync_tables.ts). See that file's
      // doc comment for why a declared-blob column is captured (not
      // skipped) as a two-key `<col>`/`<col>__hex` pair below.
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

      // Mirrors the core migration's `jsonObjectExpr` (same file/link as
      // above) — a declared-blob column gets a `'col'`/`'col__hex'` pair
      // (NULL/hex-of-the-blob, chosen by the value's *runtime* typeof())
      // instead of a single plain key, so it round-trips through
      // json_object() without either dropping it or erroring on an actual
      // blob value.
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

        // Drop migration 024's post-hoc uuid-assignment trigger and fold
        // its logic into the front of the insert-capture trigger — see
        // the core migration's doc comment for why relying on undefined
        // cross-trigger firing order here is unsafe.
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

      const ensureUsersUuid = () => {
        const hasUuid = db
          .prepare(`PRAGMA table_info("users")`)
          .all()
          .some((c) => c.name === 'uuid');
        if (!hasUuid) {
          db.prepare(`ALTER TABLE "users" ADD COLUMN "uuid" TEXT`).run();
        }

        const pending = db
          .prepare(`SELECT "id" FROM "users" WHERE "uuid" IS NULL`)
          .all();
        const setUuid = db.prepare(
          `UPDATE "users" SET "uuid" = ${UUID_V4_SQL_EXPR} WHERE "id" = ?`,
        );
        pending.forEach((row) => setUuid.run(row.id));

        db.prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_uuid" ON "users"("uuid")`,
        ).run();
      };

      db.transaction(() => {
        ensureUsersUuid();

        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS sync_outbox (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              idempotencyKey TEXT UNIQUE,
              tableName TEXT NOT NULL,
              rowUuid TEXT NOT NULL,
              op TEXT NOT NULL CHECK (op IN ('put', 'delete')),
              rowJson TEXT NOT NULL,
              createdAt DATETIME
            )
          `,
        ).run();

        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS sync_state (
              key TEXT PRIMARY KEY,
              value TEXT
            )
          `,
        ).run();

        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS sync_rejected (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              idempotencyKey TEXT,
              tableName TEXT NOT NULL,
              rowUuid TEXT NOT NULL,
              op TEXT NOT NULL CHECK (op IN ('put', 'delete')),
              rowJson TEXT NOT NULL,
              reason TEXT,
              rejectedAt DATETIME
            )
          `,
        ).run();

        SYNC_TABLES.forEach((table) => createCaptureTriggers(table));
      })();

      return true;
    } catch (error) {
      console.log('029 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('029 migration completed!');
    }
  },
};
