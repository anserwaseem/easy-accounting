module.exports = {
  name: '014_opening_stock_and_stock_adjustments',
  up: (db) => {
    try {
      db.transaction(() => {
        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS inventory_opening_stock (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              inventoryId INTEGER NOT NULL UNIQUE,
              quantity INTEGER NOT NULL,
              old_quantity INTEGER,
              asOfDate DATETIME,
              createdAt DATETIME,
              updatedAt DATETIME,
              FOREIGN KEY (inventoryId) REFERENCES inventory(id)
            )
          `,
        ).run();

        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS stock_adjustments (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              inventoryId INTEGER NOT NULL,
              quantityDelta INTEGER NOT NULL,
              reason TEXT,
              date DATETIME NOT NULL,
              createdAt DATETIME,
              updatedAt DATETIME,
              FOREIGN KEY (inventoryId) REFERENCES inventory(id)
            )
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_inventory_opening_stock_add_timestamp
            AFTER INSERT ON inventory_opening_stock
            BEGIN
              UPDATE inventory_opening_stock SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_inventory_opening_stock_add_timestamp
            AFTER UPDATE ON inventory_opening_stock
            BEGIN
              UPDATE inventory_opening_stock SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_stock_adjustments_add_timestamp
            AFTER INSERT ON stock_adjustments
            BEGIN
              UPDATE stock_adjustments SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_stock_adjustments_add_timestamp
            AFTER UPDATE ON stock_adjustments
            BEGIN
              UPDATE stock_adjustments SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();
      })();
      return true;
    } catch (error) {
      console.log('014 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('014 migration completed!');
    }
  },
};
