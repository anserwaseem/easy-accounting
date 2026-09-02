module.exports = {
  name: '025_add_customer_groups',
  up: (db) => {
    try {
      const hasColumn = (tableName, columnName) => {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        return columns.some((column) => column.name === columnName);
      };

      const hasTable = (tableName) =>
        db
          .prepare(
            `SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name=?`,
          )
          .get(tableName).c > 0;

      db.transaction(() => {
        // A customer is split into one account per item-type tier: a base
        // account (e.g. code RWP-KITAB) plus typed variants whose code appends
        // the item type name (RWP-KITAB-T). Until now that relationship lived
        // only as a naming convention, resolved by string matching at the one
        // place that needed it — and shop names repeat across cities, so a
        // name-first match can bind a typed account to the wrong city's base
        // account. This table stores the relationship as a fact.
        db.prepare(
          `
            CREATE TABLE IF NOT EXISTS "customer_groups" (
              "id" INTEGER PRIMARY KEY AUTOINCREMENT,
              "name" TEXT NOT NULL,
              "createdAt" DATETIME,
              "updatedAt" DATETIME
            )
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_insert_customer_groups_add_timestamp
            AFTER INSERT ON customer_groups
            BEGIN
              UPDATE customer_groups SET
                createdAt = datetime(CURRENT_TIMESTAMP, 'localtime'),
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        db.prepare(
          `
            CREATE TRIGGER IF NOT EXISTS after_update_customer_groups_add_timestamp
            AFTER UPDATE ON customer_groups
            BEGIN
              UPDATE customer_groups SET
                updatedAt = datetime(CURRENT_TIMESTAMP, 'localtime')
              WHERE id = NEW.id;
            END;
          `,
        ).run();

        if (!hasColumn('account', 'customerGroupId')) {
          db.prepare(
            `ALTER TABLE "account" ADD COLUMN "customerGroupId" INTEGER REFERENCES "customer_groups"("id")`,
          ).run();
        }

        // Conservative auto-seeding from account codes — codes only, never
        // names: 215 shop names repeat across cities in real data, so name
        // equality is precisely the ambiguity this table exists to remove.
        //
        // Each account's base code is its code with one trailing
        // '-<itemTypeName>' suffix stripped (case-insensitive, trimmed; item
        // type names read from item_types, not hardcoded). Accounts whose base
        // codes are exactly equal (case-insensitively) form a group, and only
        // groups with 2 or more members are stored — a lone code proves
        // nothing. Empty/NULL codes stay ungrouped. Anything the codes cannot
        // prove is left NULL for a person to assign in the UI.
        //
        // Seeding runs only while no grouping data exists at all, so a re-run
        // (or a database where a person already curated groups) is untouched.
        const alreadySeeded =
          db.prepare(`SELECT count(*) AS c FROM customer_groups`).get().c > 0 ||
          db
            .prepare(
              `SELECT count(*) AS c FROM account WHERE customerGroupId IS NOT NULL`,
            )
            .get().c > 0;

        if (alreadySeeded) return;

        // longest-first so a longer type name is never shadowed by a shorter
        // one that happens to be its own suffix
        const itemTypeSuffixes = (
          hasTable('item_types')
            ? db.prepare(`SELECT name FROM item_types`).all()
            : []
        )
          .map((r) =>
            String(r.name ?? '')
              .trim()
              .toLowerCase(),
          )
          .filter((n) => n.length > 0)
          .sort((a, b) => b.length - a.length);

        const toBaseCode = (codeLower) => {
          for (const suffix of itemTypeSuffixes) {
            if (
              codeLower.length > suffix.length + 1 &&
              codeLower.endsWith(`-${suffix}`)
            ) {
              return codeLower.slice(0, codeLower.length - suffix.length - 1);
            }
          }
          return codeLower;
        };

        const accounts = db
          .prepare(`SELECT id, name, code FROM account`)
          .all()
          .map((a) => ({
            id: a.id,
            name: String(a.name ?? '').trim(),
            codeLower: String(a.code ?? '')
              .trim()
              .toLowerCase(),
          }))
          .filter((a) => a.codeLower.length > 0);

        const groupsByBaseCode = new Map();
        accounts.forEach((account) => {
          const baseCode = toBaseCode(account.codeLower);
          if (!groupsByBaseCode.has(baseCode)) {
            groupsByBaseCode.set(baseCode, []);
          }
          groupsByBaseCode.get(baseCode).push(account);
        });

        const insertGroup = db.prepare(
          `INSERT INTO customer_groups (name) VALUES (?)`,
        );
        const assignAccount = db.prepare(
          `UPDATE account SET customerGroupId = ? WHERE id = ?`,
        );

        groupsByBaseCode.forEach((members, baseCode) => {
          if (members.length < 2) return;

          // group name: the base account's name (the member whose full code IS
          // the base code, i.e. carries no type suffix); when no such member
          // exists, the shortest member name (ties broken by id for
          // determinism)
          const shortestName = (rows) =>
            rows.reduce((best, row) => {
              if (!best) return row;
              if (row.name.length < best.name.length) return row;
              if (row.name.length === best.name.length && row.id < best.id) {
                return row;
              }
              return best;
            }, undefined);

          const baseMembers = members.filter((m) => m.codeLower === baseCode);
          const named = shortestName(
            baseMembers.length > 0 ? baseMembers : members,
          );
          const groupName =
            named && named.name.length > 0 ? named.name : baseCode;

          const groupId = insertGroup.run(groupName).lastInsertRowid;
          members.forEach((member) => assignAccount.run(groupId, member.id));
        });
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
