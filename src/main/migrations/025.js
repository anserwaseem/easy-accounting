module.exports = {
  name: '025_vendor_stock',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      db.transaction(() => {
        // opt-in: only accounts with this flag participate in vendor stock.
        // purchase invoices from untracked parties (e.g. agents booking
        // consignment returns) must not touch vendor stock.
        if (!hasColumn('account', 'tracksVendorStock')) {
          db.prepare(
            `ALTER TABLE "account" ADD COLUMN "tracksVendorStock" BOOLEAN NOT NULL DEFAULT 0`,
          ).run();
        }

        db.prepare(
          `
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
          `,
        ).run();

        db.prepare(
          `
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
          `,
        ).run();

        db.prepare(
          `
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
          `,
        ).run();

        db.prepare(
          `
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
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_vendor_stock_add_timestamp
            AFTER INSERT ON vendor_stock
            BEGIN
              UPDATE vendor_stock SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE vendorAccountId = NEW.vendorAccountId
                AND inventoryId = NEW.inventoryId;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_vendor_stock_add_timestamp
            AFTER UPDATE ON vendor_stock
            BEGIN
              UPDATE vendor_stock SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE vendorAccountId = NEW.vendorAccountId
                AND inventoryId = NEW.inventoryId;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_vendor_issues_add_timestamp
            AFTER INSERT ON vendor_issues
            BEGIN
              UPDATE vendor_issues SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_vendor_issues_add_timestamp
            AFTER UPDATE ON vendor_issues
            BEGIN
              UPDATE vendor_issues SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_vendor_issue_items_add_timestamp
            AFTER INSERT ON vendor_issue_items
            BEGIN
              UPDATE vendor_issue_items SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_vendor_issue_items_add_timestamp
            AFTER UPDATE ON vendor_issue_items
            BEGIN
              UPDATE vendor_issue_items SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_vendor_stock_movements_add_timestamp
            AFTER INSERT ON vendor_stock_movements
            BEGIN
              UPDATE vendor_stock_movements SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_vendor_stock_movements_add_timestamp
            AFTER UPDATE ON vendor_stock_movements
            BEGIN
              UPDATE vendor_stock_movements SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();
      })();

      return true;
    } catch (error) {
      console.log('025 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('025 migration completed!');
    }
  },
};
