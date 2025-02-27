module.exports = {
  name: '007_add_address_phone1_phone2_goodsName_in_account_table',
  up: (db) => {
    try {
      db.transaction(() => {
        db.prepare(`ALTER TABLE "account" ADD COLUMN "address" TEXT;`).run();
        db.prepare(
          `ALTER TABLE "account" ADD COLUMN "phone1" VARCHAR(20);`,
        ).run();
        db.prepare(
          `ALTER TABLE "account" ADD COLUMN "phone2" VARCHAR(20);`,
        ).run();
        db.prepare(`ALTER TABLE "account" ADD COLUMN "goodsName" TEXT;`).run();
      })();
      return true;
    } catch (error) {
      console.log('007 migration error!');
      console.error(error);
      return error;
    } finally {
      console.log('007 migration completed!');
    }
  },
};
