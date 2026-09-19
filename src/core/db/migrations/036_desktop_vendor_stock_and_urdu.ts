import type { DatabaseDriver } from '../driver';
import {
  createCaptureTriggers,
  UUID_V4_SQL_EXPR,
} from './029_create_sync_tables';

/**
 * Brings a database that was bootstrapped from the *pre-merge* web snapshot
 * (uuid/views, no vendor stock / Urdu) up to the unified schema.
 *
 * Fresh bootstraps already have this from `src/main/migrations/025.js`–
 * `027.js` baked into the snapshot; this migration is IF NOT EXISTS /
 * ADD COLUMN so those installs no-op. Existing field-test PWAs skip the
 * snapshot (they already have a `users` table) and need this to grow the
 * vendor-stock tables and Urdu columns.
 *
 * `vendor_stock` is a composite-PK running-quantity table (like `ledger`):
 * it gets a uuid for import identity but is not in SYNC_TABLES. Issues,
 * issue items, and movements do replicate — capture triggers are installed
 * here if `sync_outbox` already exists (029 already ran on those PWAs).
 */
async function tableExists(
  driver: DatabaseDriver,
  name: string,
): Promise<boolean> {
  const row = await driver.get(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name=@name`,
    { name },
  );
  return !!row;
}

async function columnNames(
  driver: DatabaseDriver,
  table: string,
): Promise<string[]> {
  const rows = await driver.all<{ name: string }>(
    `PRAGMA table_info("${table}")`,
  );
  return rows.map((r) => r.name);
}

async function addColumnIfMissing(
  driver: DatabaseDriver,
  table: string,
  column: string,
  ddl: string,
): Promise<void> {
  const cols = await columnNames(driver, table);
  if (!cols.includes(column)) {
    await driver.exec(`ALTER TABLE "${table}" ADD COLUMN ${ddl}`);
  }
}

async function addUuidOnIdTable(
  driver: DatabaseDriver,
  table: string,
): Promise<void> {
  if (!(await tableExists(driver, table))) return;
  await addColumnIfMissing(driver, table, 'uuid', '"uuid" TEXT');
  const pending = await driver.all<{ id: number }>(
    `SELECT "id" FROM "${table}" WHERE "uuid" IS NULL`,
  );
  for (const row of pending) {
    // eslint-disable-next-line no-await-in-loop
    await driver.run(
      `UPDATE "${table}" SET "uuid" = ${UUID_V4_SQL_EXPR} WHERE "id" = @id`,
      {
        id: row.id,
      },
    );
  }
  await driver.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${table}_uuid" ON "${table}"("uuid")`,
  );
  await driver.exec(`
    CREATE TRIGGER IF NOT EXISTS "trg_${table}_uuid"
    AFTER INSERT ON "${table}"
    WHEN NEW."uuid" IS NULL
    BEGIN
      UPDATE "${table}" SET "uuid" = ${UUID_V4_SQL_EXPR}
      WHERE "id" = NEW."id";
    END;
  `);
}

export const migration036 = {
  name: '036_desktop_vendor_stock_and_urdu',
  async up(driver: DatabaseDriver): Promise<void> {
    await addColumnIfMissing(
      driver,
      'account',
      'tracksVendorStock',
      '"tracksVendorStock" BOOLEAN NOT NULL DEFAULT 0',
    );
    await addColumnIfMissing(driver, 'account', 'nameUrdu', '"nameUrdu" TEXT');
    await addColumnIfMissing(
      driver,
      'account',
      'addressUrdu',
      '"addressUrdu" TEXT',
    );
    await addColumnIfMissing(
      driver,
      'account',
      'goodsNameUrdu',
      '"goodsNameUrdu" TEXT',
    );
    await addColumnIfMissing(
      driver,
      'inventory',
      'descriptionUrdu',
      '"descriptionUrdu" TEXT',
    );

    await driver.exec(`
      CREATE TABLE IF NOT EXISTS vendor_stock (
        vendorAccountId INTEGER NOT NULL,
        inventoryId INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        createdAt DATETIME,
        updatedAt DATETIME,
        PRIMARY KEY (vendorAccountId, inventoryId),
        FOREIGN KEY (vendorAccountId) REFERENCES account(id),
        FOREIGN KEY (inventoryId) REFERENCES inventory(id)
      )
    `);
    await driver.exec(`
      CREATE TABLE IF NOT EXISTS vendor_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issueNumber INTEGER NOT NULL UNIQUE,
        vendorAccountId INTEGER NOT NULL,
        date DATETIME NOT NULL,
        notes TEXT,
        createdAt DATETIME,
        updatedAt DATETIME,
        FOREIGN KEY (vendorAccountId) REFERENCES account(id)
      )
    `);
    await driver.exec(`
      CREATE TABLE IF NOT EXISTS vendor_issue_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issueId INTEGER NOT NULL,
        inventoryId INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        createdAt DATETIME,
        updatedAt DATETIME,
        FOREIGN KEY (issueId) REFERENCES vendor_issues(id),
        FOREIGN KEY (inventoryId) REFERENCES inventory(id)
      )
    `);
    await driver.exec(`
      CREATE TABLE IF NOT EXISTS vendor_stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendorAccountId INTEGER NOT NULL,
        inventoryId INTEGER NOT NULL,
        quantityDelta INTEGER NOT NULL,
        movementType TEXT NOT NULL CHECK (
          movementType IN (
            'opening',
            'issue',
            'purchase',
            'purchase_return',
            'adjustment'
          )
        ),
        referenceType TEXT,
        referenceId INTEGER,
        date DATETIME NOT NULL,
        notes TEXT,
        createdAt DATETIME,
        updatedAt DATETIME,
        FOREIGN KEY (vendorAccountId) REFERENCES account(id),
        FOREIGN KEY (inventoryId) REFERENCES inventory(id)
      )
    `);

    const timestampTriggers: Array<{ table: string; pk: string }> = [
      {
        table: 'vendor_stock',
        pk: 'vendorAccountId = NEW.vendorAccountId AND inventoryId = NEW.inventoryId',
      },
      { table: 'vendor_issues', pk: 'id = NEW.id' },
      { table: 'vendor_issue_items', pk: 'id = NEW.id' },
      { table: 'vendor_stock_movements', pk: 'id = NEW.id' },
    ];
    for (const { table, pk } of timestampTriggers) {
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(`
        CREATE TRIGGER IF NOT EXISTS after_insert_${table}_add_timestamp
        AFTER INSERT ON ${table}
        BEGIN
          UPDATE ${table} SET
            createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
            updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
          WHERE ${pk};
        END;
      `);
      // eslint-disable-next-line no-await-in-loop
      await driver.exec(`
        CREATE TRIGGER IF NOT EXISTS after_update_${table}_add_timestamp
        AFTER UPDATE ON ${table}
        BEGIN
          UPDATE ${table} SET
            updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
          WHERE ${pk};
        END;
      `);
    }

    await addUuidOnIdTable(driver, 'vendor_issues');
    await addUuidOnIdTable(driver, 'vendor_issue_items');
    await addUuidOnIdTable(driver, 'vendor_stock_movements');

    if (await tableExists(driver, 'vendor_stock')) {
      await addColumnIfMissing(driver, 'vendor_stock', 'uuid', '"uuid" TEXT');
      const pending = await driver.all<{
        vendorAccountId: number;
        inventoryId: number;
      }>(
        `SELECT "vendorAccountId", "inventoryId" FROM "vendor_stock" WHERE "uuid" IS NULL`,
      );
      for (const row of pending) {
        // eslint-disable-next-line no-await-in-loop
        await driver.run(
          `UPDATE "vendor_stock" SET "uuid" = ${UUID_V4_SQL_EXPR}
           WHERE "vendorAccountId" = @vendorAccountId AND "inventoryId" = @inventoryId`,
          {
            vendorAccountId: row.vendorAccountId,
            inventoryId: row.inventoryId,
          },
        );
      }
      await driver.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS "idx_vendor_stock_uuid" ON "vendor_stock"("uuid")`,
      );
      await driver.exec(`
        CREATE TRIGGER IF NOT EXISTS "trg_vendor_stock_uuid"
        AFTER INSERT ON "vendor_stock"
        WHEN NEW."uuid" IS NULL
        BEGIN
          UPDATE "vendor_stock" SET "uuid" = ${UUID_V4_SQL_EXPR}
          WHERE "vendorAccountId" = NEW."vendorAccountId"
            AND "inventoryId" = NEW."inventoryId";
        END;
      `);
    }

    if (await tableExists(driver, 'sync_outbox')) {
      await createCaptureTriggers(driver, 'vendor_issues');
      await createCaptureTriggers(driver, 'vendor_issue_items');
      await createCaptureTriggers(driver, 'vendor_stock_movements');
    }
  },
};
