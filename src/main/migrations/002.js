module.exports = {
  name: '002_add_inventory_and_invoice_modules',
  up: (db) => {
    try {
      db.transaction(() => {
        // Step 1: Create new inventory table
        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS inventory (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              description TEXT,
              price DECIMAL(10, 2) NOT NULL,
              quantity INTEGER NOT NULL DEFAULT 0,
              createdAt DATETIME,
              updatedAt DATETIME
            )
          `,
        ).run();

        // Step 2: Create new invoices table
        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS invoices (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              invoiceNumber INTEGER NOT NULL,
              accountId INTEGER NOT NULL,
              invoiceType TEXT NOT NULL CHECK (invoiceType IN ('Purchase', 'Sale')),
              date DATETIME NOT NULL,
              totalAmount DECIMAL(10, 2) NOT NULL,
              createdAt DATETIME,
              updatedAt DATETIME,

              UNIQUE(invoiceNumber, invoiceType),
              FOREIGN KEY (accountId) REFERENCES account(id)
            )
          `,
        ).run();

        // Step 3: Create new invoice_items table
        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS invoice_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              invoiceId INTEGER NOT NULL,
              inventoryId INTEGER NOT NULL,
              quantity INTEGER NOT NULL,
              price DECIMAL(10, 2) NOT NULL,
              createdAt DATETIME,
              updatedAt DATETIME,

              FOREIGN KEY (inventoryId) REFERENCES inventory(id),
              FOREIGN KEY (invoiceId) REFERENCES invoices(id)
            )
          `,
        ).run();

        // Step 4: create new after_insert_inventory_add_timestamp trigger
        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_inventory_add_timestamp
            AFTER INSERT ON inventory
            BEGIN
              UPDATE inventory SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        // Step 5: create new after_update_inventory_add_timestamp trigger
        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_inventory_add_timestamp
            AFTER UPDATE ON inventory
            BEGIN
              UPDATE inventory SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        // Step 6: create new after_insert_invoices_add_timestamp trigger
        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_invoices_add_timestamp
            AFTER INSERT ON invoices
            BEGIN
              UPDATE invoices SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        // Step 7: create new after_update_invoices_add_timestamp trigger
        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_invoices_add_timestamp
            AFTER UPDATE ON invoices
            BEGIN
              UPDATE invoices SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END
          `,
        ).run();
      })();
      return true;
    } catch (error) {
      console.log('002 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('002 migration completed!');
    }
  },
};
