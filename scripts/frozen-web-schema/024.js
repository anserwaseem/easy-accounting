// Node's crypto.randomUUID, imported locally to this function rather than at
// module scope. A future browser port runs these same migration files against
// a WASM sqlite build with no `crypto` module — only a `crypto.randomUUID`
// global (or a shim providing one). Keeping the require inside up() means
// porting is a matter of replacing this one line with the global, not
// hunting down a module-level import.
module.exports = {
  name: '024_add_uuid_to_business_tables',
  up: (db) => {
    try {
      // Every row that can travel between devices needs an identity that
      // does not depend on which device's AUTOINCREMENT counter produced it.
      // The INTEGER id stays — it is still what every foreign key in this
      // schema points at — but a globally unique id rides alongside it so a
      // future sync layer can tell "the same row, seen twice" from "two rows
      // that happen to share an id".
      //
      // Every business-data table gets this. `users` and the `migrations`
      // meta table are deliberately excluded: neither is business data that
      // sync will ever merge across devices.
      const TABLES = [
        'chart',
        'account',
        'journal',
        'journal_entry',
        'ledger',
        'inventory',
        'item_types',
        'discount_profiles',
        'profile_type_discounts',
        'attribute_definitions',
        'price_lists',
        'inventory_prices',
        'invoices',
        'invoice_items',
        'inventory_opening_stock',
        'stock_adjustments',
      ];

      const { randomUUID } = require('crypto');

      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        TABLES.forEach((table) => {
          // 1. The column. Nullable: SQLite cannot ADD COLUMN with a NOT
          // NULL constraint unless every existing row already has a value,
          // and a constant default would hand every pre-existing row the
          // same "unique" id. Backfill first, tighten later once every row
          // (and every writer) is known to set it.
          if (!hasColumn(table, 'uuid')) {
            db.prepare(`ALTER TABLE "${table}" ADD COLUMN "uuid" TEXT`).run();
          }

          // 2. Backfill existing rows. One UUID per row, generated in Node
          // rather than SQL — see the trigger below for the SQL-side
          // generator new inserts get for free.
          const pending = db
            .prepare(`SELECT "id" FROM "${table}" WHERE "uuid" IS NULL`)
            .all();

          if (pending.length > 0) {
            const setUuid = db.prepare(
              `UPDATE "${table}" SET "uuid" = ? WHERE "id" = ?`,
            );
            pending.forEach((rowRef) => {
              setUuid.run(randomUUID(), rowRef.id);
            });
          }

          // 3. Enforce uniqueness once every row has a value. Created after
          // the backfill so a partially-backfilled table (there isn't one,
          // but belt-and-braces) never trips a NULL-collision — SQLite
          // treats NULLs as distinct in a UNIQUE index anyway, so this is
          // really just about ordering the intent clearly.
          db.prepare(
            `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${table}_uuid" ON "${table}"("uuid")`,
          ).run();

          // 4. New rows get a uuid without every insert path in the app
          // needing to change today. SQLite has no built-in UUID function,
          // so this assembles a version-4 (random) UUID by hand:
          // 8-4-4-4-12 hex digits, version nibble fixed to 4, variant
          // nibble constrained to 8/9/a/b per RFC 4122. Only fires when the
          // inserted row left uuid NULL, so a caller that already supplies
          // one (e.g. a future sync writer replaying a peer's row) is left
          // alone.
          db.prepare(
            `
              CREATE TRIGGER IF NOT EXISTS "trg_${table}_uuid"
              AFTER INSERT ON "${table}"
              WHEN NEW."uuid" IS NULL
              BEGIN
                UPDATE "${table}" SET "uuid" = (
                  SELECT lower(
                    hex(randomblob(4)) || '-' ||
                    hex(randomblob(2)) || '-4' ||
                    substr(hex(randomblob(2)), 2) || '-' ||
                    substr('89ab', abs(random()) % 4 + 1, 1) ||
                    substr(hex(randomblob(2)), 2) || '-' ||
                    hex(randomblob(6))
                  )
                )
                WHERE "id" = NEW."id";
              END;
            `,
          ).run();
        });
      })();

      return true;
    } catch (error) {
      console.log('024 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('024 migration completed!');
    }
  },
};
