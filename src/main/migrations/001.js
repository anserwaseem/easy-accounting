module.exports = {
  name: '001_update_chart_type_constraint',
  up: (db) => {
    try {
      // Step 0: Enable foreign keys check so existing chart table can be dropped
      db.prepare(`PRAGMA foreign_keys = OFF;`).run();

      db.transaction(() => {
        // Step 1: Create a new table with the updated CHECK constraint
        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS chart_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              date DATETIME,
              name STRING NOT NULL,
              userId INTEGER,
              code INTEGER,
              type STRING NOT NULL CHECK (type IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')),
              createdAt DATETIME,
              updatedAt DATETIME,
              FOREIGN KEY(userId) REFERENCES users(id) ON DELETE NO ACTION
            );
          `,
        ).run();

        // Step 2: Copy data from the old 'chart' table to the new 'chart_new' table
        db.prepare(`INSERT INTO "chart_new" SELECT * FROM "chart";`).run();

        // Step 3: Drop the old 'chart' table
        db.prepare(`DROP TABLE chart;`).run();

        // Step 4: Rename the new table to 'chart'
        db.prepare(`ALTER TABLE chart_new RENAME TO chart;`).run();

        // Step 5: Recreate triggers for the 'chart' table
        db.prepare(
          `
              CREATE TRIGGER IF NOT EXISTS after_insert_chart_add_timestamp
              AFTER INSERT ON chart
              BEGIN
                UPDATE chart SET
                  createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                  updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
                WHERE id = NEW.id;
              END;
            `,
        ).run();
        db.prepare(
          `
              CREATE TRIGGER IF NOT EXISTS after_update_chart_add_timestamp
              AFTER UPDATE ON chart
              BEGIN
                UPDATE chart SET
                  updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
                WHERE id = NEW.id;
              END;
            `,
        ).run();
      })();
      return true;
    } catch (error) {
      console.error(error);
      return error;
    } finally {
      // Step 6: Disable foreign keys check
      db.prepare(`PRAGMA foreign_keys = ON;`).run();
    }
  },
};
