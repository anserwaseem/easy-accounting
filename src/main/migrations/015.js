module.exports = {
  name: '015_add_item_types_and_discount_profiles',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS "item_types" (
              "id" INTEGER PRIMARY KEY AUTOINCREMENT,
              "name" TEXT NOT NULL UNIQUE,
              "isActive" BOOLEAN NOT NULL DEFAULT 1,
              "isPrimary" BOOLEAN NOT NULL DEFAULT 0,
              "createdAt" DATETIME,
              "updatedAt" DATETIME
            )
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_item_types_add_timestamp
            AFTER INSERT ON item_types
            BEGIN
              UPDATE item_types SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_item_types_add_timestamp
            AFTER UPDATE ON item_types
            BEGIN
              UPDATE item_types SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS "discount_profiles" (
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
            CREATE TRIGGER IF NOT EXISTS after_insert_discount_profiles_add_timestamp
            AFTER INSERT ON discount_profiles
            BEGIN
              UPDATE discount_profiles SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_discount_profiles_add_timestamp
            AFTER UPDATE ON discount_profiles
            BEGIN
              UPDATE discount_profiles SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS "profile_type_discounts" (
              "id" INTEGER PRIMARY KEY AUTOINCREMENT,
              "profileId" INTEGER NOT NULL,
              "itemTypeId" INTEGER NOT NULL,
              "discountPercent" DECIMAL(5, 2) NOT NULL DEFAULT 0 CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100),
              "createdAt" DATETIME,
              "updatedAt" DATETIME,
              UNIQUE("profileId", "itemTypeId"),
              FOREIGN KEY ("profileId") REFERENCES "discount_profiles"("id") ON DELETE CASCADE,
              FOREIGN KEY ("itemTypeId") REFERENCES "item_types"("id") ON DELETE CASCADE
            )
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_profile_type_discounts_add_timestamp
            AFTER INSERT ON profile_type_discounts
            BEGIN
              UPDATE profile_type_discounts SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_profile_type_discounts_add_timestamp
            AFTER UPDATE ON profile_type_discounts
            BEGIN
              UPDATE profile_type_discounts SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        if (!hasColumn('inventory', 'itemTypeId')) {
          db.prepare(
            `ALTER TABLE "inventory" ADD COLUMN "itemTypeId" INTEGER REFERENCES "item_types"("id");`,
          ).run();
        }

        if (!hasColumn('account', 'discountProfileId')) {
          db.prepare(
            `ALTER TABLE "account" ADD COLUMN "discountProfileId" INTEGER REFERENCES "discount_profiles"("id");`,
          ).run();
        }

        db.prepare(
          `
            CREATE INDEX IF NOT EXISTS idx_inventory_itemTypeId
            ON inventory(itemTypeId)
          `,
        ).run();

        db.prepare(
          `
            CREATE INDEX IF NOT EXISTS idx_account_discountProfileId
            ON account(discountProfileId)
          `,
        ).run();

        db.prepare(
          `
            CREATE INDEX IF NOT EXISTS idx_profile_type_discounts_profileId
            ON profile_type_discounts(profileId)
          `,
        ).run();

        db.prepare(
          `
            CREATE INDEX IF NOT EXISTS idx_profile_type_discounts_itemTypeId
            ON profile_type_discounts(itemTypeId)
          `,
        ).run();
      })();

      return true;
    } catch (error) {
      console.log('015 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('015 migration completed!');
    }
  },
};
