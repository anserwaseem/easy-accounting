module.exports = {
  name: '020_add_attributes_families_and_price_lists',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        // 1. Generic, per-business attribute definitions. A business defines
        //    its own keys (e.g. size_w_in, satri, paper_type, binding_type,
        //    weight_g). No attribute values are seeded here — that is data.
        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS "attribute_definitions" (
              "id" INTEGER PRIMARY KEY AUTOINCREMENT,
              "key" TEXT NOT NULL UNIQUE,
              "label" TEXT NOT NULL,
              "unit" TEXT,
              "valueType" TEXT NOT NULL DEFAULT 'text',
              "sortOrder" INTEGER NOT NULL DEFAULT 0,
              "isActive" BOOLEAN NOT NULL DEFAULT 1,
              "createdAt" DATETIME,
              "updatedAt" DATETIME
            )
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_attribute_definitions_add_timestamp
            AFTER INSERT ON attribute_definitions
            BEGIN
              UPDATE attribute_definitions SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_attribute_definitions_add_timestamp
            AFTER UPDATE ON attribute_definitions
            BEGIN
              UPDATE attribute_definitions SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        // 2. Variant grouping + structured attributes on inventory.
        //    parentId points at a head item in the same table (self-reference);
        //    attributes is a JSON object keyed by attribute_definitions.key.
        if (!hasColumn('inventory', 'parentId')) {
          db.prepare(
            `ALTER TABLE "inventory" ADD COLUMN "parentId" INTEGER REFERENCES "inventory"("id");`,
          ).run();
        }

        if (!hasColumn('inventory', 'attributes')) {
          db.prepare(
            `ALTER TABLE "inventory" ADD COLUMN "attributes" TEXT;`,
          ).run();
        }

        // 3. Named price lists (e.g. "Retail") kept alongside the base
        //    inventory price. Names are data — none are seeded here.
        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS "price_lists" (
              "id" INTEGER PRIMARY KEY AUTOINCREMENT,
              "name" TEXT NOT NULL UNIQUE,
              "isActive" BOOLEAN NOT NULL DEFAULT 1,
              "createdAt" DATETIME,
              "updatedAt" DATETIME
            )
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_price_lists_add_timestamp
            AFTER INSERT ON price_lists
            BEGIN
              UPDATE price_lists SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_price_lists_add_timestamp
            AFTER UPDATE ON price_lists
            BEGIN
              UPDATE price_lists SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        // 4. Per-inventory price per list. One row per (item, list).
        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS "inventory_prices" (
              "id" INTEGER PRIMARY KEY AUTOINCREMENT,
              "inventoryId" INTEGER NOT NULL,
              "priceListId" INTEGER NOT NULL,
              "price" REAL NOT NULL DEFAULT 0,
              "createdAt" DATETIME,
              "updatedAt" DATETIME,
              UNIQUE("inventoryId", "priceListId"),
              FOREIGN KEY ("inventoryId") REFERENCES "inventory"("id") ON DELETE CASCADE,
              FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE CASCADE
            )
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_inventory_prices_add_timestamp
            AFTER INSERT ON inventory_prices
            BEGIN
              UPDATE inventory_prices SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_inventory_prices_add_timestamp
            AFTER UPDATE ON inventory_prices
            BEGIN
              UPDATE inventory_prices SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        // 5. Indexes on the new foreign keys, matching existing convention.
        db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_inventory_parentId ON inventory(parentId)`,
        ).run();

        db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_inventory_prices_inventoryId ON inventory_prices(inventoryId)`,
        ).run();

        db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_inventory_prices_priceListId ON inventory_prices(priceListId)`,
        ).run();
      })();

      return true;
    } catch (error) {
      console.log('020 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('020 migration completed!');
    }
  },
};
