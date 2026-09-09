// Node's crypto.randomUUID, imported locally to this function rather than at
// module scope. A future browser port runs these same migration files against
// a WASM sqlite build with no `crypto` module — only a `crypto.randomUUID`
// global (or a shim providing one). Keeping the require inside up() means
// porting is a matter of replacing this one line with the global, not
// hunting down a module-level import.
//
// File number is 027 so it runs after desktop 024–026 (invoice date, vendor
// stock, Urdu). The recorded name stays `024_add_uuid_to_business_tables`
// so a database bootstrapped from the web field-test snapshot (which already
// applied that name) does not run this twice.
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
      // Every business-data table with an INTEGER `id` PK gets this, plus
      // vendor_stock (composite PK — special-cased below). `users` and the
      // `migrations` meta table are deliberately excluded here: `users`
      // gets a uuid in migration 029 when it becomes a replicated table.
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
        'vendor_issues',
        'vendor_issue_items',
        'vendor_stock_movements',
      ];

      const { randomUUID } = require('crypto');

      const tableExists = (tableName) => {
        const row = db
          .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
          .get(tableName);
        return !!row;
      };

      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      const uuidSql = `(
        SELECT lower(
          hex(randomblob(4)) || '-' ||
          hex(randomblob(2)) || '-4' ||
          substr(hex(randomblob(2)), 2) || '-' ||
          substr('89ab', abs(random()) % 4 + 1, 1) ||
          substr(hex(randomblob(2)), 2) || '-' ||
          hex(randomblob(6))
        )
      )`;

      const addUuidOnIdTable = (table) => {
        if (!tableExists(table)) return;
        if (!hasColumn(table, 'uuid')) {
          db.prepare(`ALTER TABLE "${table}" ADD COLUMN "uuid" TEXT`).run();
        }

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

        db.prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${table}_uuid" ON "${table}"("uuid")`,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS "trg_${table}_uuid"
            AFTER INSERT ON "${table}"
            WHEN NEW."uuid" IS NULL
            BEGIN
              UPDATE "${table}" SET "uuid" = ${uuidSql}
              WHERE "id" = NEW."id";
            END;
          `,
        ).run();
      };

      // vendor_stock has no INTEGER id — PK is (vendorAccountId, inventoryId).
      const addUuidOnVendorStock = () => {
        if (!tableExists('vendor_stock')) return;
        if (!hasColumn('vendor_stock', 'uuid')) {
          db.prepare(`ALTER TABLE "vendor_stock" ADD COLUMN "uuid" TEXT`).run();
        }

        const pending = db
          .prepare(
            `SELECT "vendorAccountId", "inventoryId" FROM "vendor_stock"
             WHERE "uuid" IS NULL`,
          )
          .all();

        if (pending.length > 0) {
          const setUuid = db.prepare(
            `UPDATE "vendor_stock" SET "uuid" = ?
             WHERE "vendorAccountId" = ? AND "inventoryId" = ?`,
          );
          pending.forEach((rowRef) => {
            setUuid.run(
              randomUUID(),
              rowRef.vendorAccountId,
              rowRef.inventoryId,
            );
          });
        }

        db.prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_vendor_stock_uuid"
           ON "vendor_stock"("uuid")`,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS "trg_vendor_stock_uuid"
            AFTER INSERT ON "vendor_stock"
            WHEN NEW."uuid" IS NULL
            BEGIN
              UPDATE "vendor_stock" SET "uuid" = ${uuidSql}
              WHERE "vendorAccountId" = NEW."vendorAccountId"
                AND "inventoryId" = NEW."inventoryId";
            END;
          `,
        ).run();
      };

      db.transaction(() => {
        TABLES.forEach(addUuidOnIdTable);
        addUuidOnVendorStock();
      })();

      return true;
    } catch (error) {
      console.log('027 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('027 migration completed!');
    }
  },
};
