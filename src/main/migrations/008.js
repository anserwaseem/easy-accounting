module.exports = {
  name: '008_update_account_code_type',
  up: (db) => {
    try {
      // Step 0: Disable foreign keys check so existing account table can be dropped
      db.prepare(`PRAGMA foreign_keys = OFF;`).run();

      db.transaction(() => {
        // Step 1: Create a new table with the updated CHECK constraint
        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS "account_new" (
              "id" INTEGER PRIMARY KEY AUTOINCREMENT,
              "chartId" INTEGER NOT NULL,
              "date" DATETIME,
              "name" STRING NOT NULL,
              "code" VARCHAR(40),
              "createdAt"	DATETIME, -- order matters, 4 new columns must be added after the existing columns
              "updatedAt"	DATETIME,
              "address" TEXT,
              "phone1" VARCHAR(20),
              "phone2" VARCHAR(20),
              "goodsName" TEXT,

              FOREIGN KEY("chartId") REFERENCES "chart"("id")
            );
          `,
        ).run();

        // Step 2: Copy data from the old 'account' table to the new 'account_new' table
        db.prepare(`INSERT INTO "account_new" SELECT * FROM "account";`).run();

        // Step 3: Drop the old 'account' table
        db.prepare(`DROP TABLE account;`).run();

        // Step 4: Rename the new table to 'account'
        db.prepare(`ALTER TABLE account_new RENAME TO account;`).run();

        // Step 5: Recreate triggers for the 'account' table
        db.prepare(
          `
              CREATE TRIGGER IF NOT EXISTS after_insert_account_add_timestamp
              AFTER INSERT ON account
              BEGIN
                UPDATE account SET
                  createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                  updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
                WHERE id = NEW.id;
              END;
            `,
        ).run();
        db.prepare(
          `
              CREATE TRIGGER IF NOT EXISTS after_update_account_add_timestamp
              AFTER UPDATE ON account
              BEGIN
                UPDATE account SET
                  updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
                WHERE id = NEW.id;
              END;
            `,
        ).run();
      })();
      return true;
    } catch (error) {
      console.log('008 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('008 migration completed!');
    }
  },
};
