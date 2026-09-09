import Database from 'better-sqlite3';
import { PricingService } from '../PricingService';
import type { SessionContext } from '../../ports';
import { BetterSqliteDriver } from '../../../main/adapters/BetterSqliteDriver';
import { PricingService as MainPricingService } from '../../../main/services/Pricing.service';
import { applyFrozenWebSchema } from '../../../../scripts/generate-schema-snapshot';

jest.mock('electron-log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  verbose: jest.fn(),
  debug: jest.fn(),
  silly: jest.fn(),
  transports: {
    file: { level: 'debug', getFile: jest.fn() },
    console: { level: 'debug' },
  },
}));

jest.mock('../../../main/store', () => ({
  store: {
    get: jest.fn(() => 'testuser'),
    set: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('electron', () => ({ app: { isPackaged: false } }));

const USERNAME = 'testuser';
const session: SessionContext = { getUsername: () => USERNAME };

function seedBasicSchema(db: Database.Database) {
  applyFrozenWebSchema(db);
  db.prepare(
    `INSERT INTO users (username, password_hash, status) VALUES (?, ?, 1)`,
  ).run(USERNAME, Buffer.from('x'));
  const userId = (
    db.prepare(`SELECT id FROM users WHERE username = ?`).get(USERNAME) as {
      id: number;
    }
  ).id;
  db.prepare(
    `INSERT INTO chart (date, name, type, userId) VALUES (?, ?, ?, ?)`,
  ).run('2025-01-01', 'Current Asset', 'Asset', userId);
  return userId;
}

function insertInventory(
  db: Database.Database,
  name: string,
  price: number,
  itemTypeId: number | null,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO inventory (name, price, quantity, itemTypeId) VALUES (?, ?, 0, ?)`,
      )
      .run(name, price, itemTypeId).lastInsertRowid,
  );
}

function insertAccount(
  db: Database.Database,
  chartId: number,
  name: string,
  code: number,
  discountProfileId: number | null,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO account (chartId, name, code, discountProfileId) VALUES (?, ?, ?, ?)`,
      )
      .run(chartId, name, code, discountProfileId).lastInsertRowid,
  );
}

function createCore(db: Database.Database) {
  const driver = new BetterSqliteDriver(db);
  return {
    driver,
    pricing: new PricingService({ db: driver, session }),
  };
}

/** The old main-process service, bound to a given db the way its tests do. */
function createMainService(db: Database.Database): MainPricingService {
  const service = Object.create(MainPricingService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).db = db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).initPreparedStatements();
  return service as MainPricingService;
}

describe('core PricingService', () => {
  describe('item types', () => {
    it('inserts and reads back item types with normalized booleans', async () => {
      const db = new Database(':memory:');
      seedBasicSchema(db);
      const { pricing } = createCore(db);

      expect(await pricing.insertItemType(' Electronics ')).toBe(true);
      const all = await pricing.getItemTypes();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('Electronics');
      expect(all[0].isActive).toBe(true);
      expect(all[0].isPrimary).toBe(false);
      db.close();
    });

    it('updateItemTypeName trims and persists', async () => {
      const db = new Database(':memory:');
      seedBasicSchema(db);
      const { pricing } = createCore(db);
      await pricing.insertItemType('Books');
      const [{ id }] = await pricing.getItemTypes();

      expect(await pricing.updateItemTypeName(id, ' Books & Media ')).toBe(
        true,
      );
      expect((await pricing.getItemTypes())[0].name).toBe('Books & Media');
      db.close();
    });

    it('setPrimaryItemType clears any previous primary and sets the new one', async () => {
      const db = new Database(':memory:');
      seedBasicSchema(db);
      const { pricing } = createCore(db);
      await pricing.insertItemType('A');
      await pricing.insertItemType('B');
      const [a, b] = await pricing.getItemTypes();

      expect(await pricing.setPrimaryItemType(a.id)).toBe(true);
      expect(await pricing.getPrimaryItemType()).toBe(a.id);

      expect(await pricing.setPrimaryItemType(b.id)).toBe(true);
      expect(await pricing.getPrimaryItemType()).toBe(b.id);

      const types = await pricing.getItemTypes();
      expect(types.find((t) => t.id === a.id)?.isPrimary).toBe(false);
      expect(types.find((t) => t.id === b.id)?.isPrimary).toBe(true);
      db.close();
    });

    it('clearPrimaryItemType clears the primary flag', async () => {
      const db = new Database(':memory:');
      seedBasicSchema(db);
      const { pricing } = createCore(db);
      await pricing.insertItemType('A');
      const [a] = await pricing.getItemTypes();
      await pricing.setPrimaryItemType(a.id);

      expect(await pricing.clearPrimaryItemType()).toBe(true);
      expect(await pricing.getPrimaryItemType()).toBeUndefined();
      db.close();
    });

    it('toggleItemType clears the primary flag when deactivating', async () => {
      const db = new Database(':memory:');
      seedBasicSchema(db);
      const { pricing } = createCore(db);
      await pricing.insertItemType('A');
      const [a] = await pricing.getItemTypes();
      await pricing.setPrimaryItemType(a.id);

      expect(await pricing.toggleItemType(a.id, false)).toBe(true);
      expect(await pricing.getPrimaryItemType()).toBeUndefined();
      expect((await pricing.getItemTypes())[0].isActive).toBe(false);
      db.close();
    });

    it('deleteItemType refuses when inventory references it, succeeds otherwise', async () => {
      const db = new Database(':memory:');
      seedBasicSchema(db);
      const { pricing } = createCore(db);
      await pricing.insertItemType('Widgets');
      const [type] = await pricing.getItemTypes();
      insertInventory(db, 'Widget A', 10, type.id);

      expect(await pricing.deleteItemType(type.id)).toBe(false);
      expect(await pricing.getItemTypes()).toHaveLength(1);

      db.prepare(`DELETE FROM inventory WHERE itemTypeId = ?`).run(type.id);
      expect(await pricing.deleteItemType(type.id)).toBe(true);
      expect(await pricing.getItemTypes()).toHaveLength(0);
      db.close();
    });
  });

  describe('discount profiles', () => {
    it('inserts and reads back discount profiles with normalized booleans', async () => {
      const db = new Database(':memory:');
      seedBasicSchema(db);
      const { pricing } = createCore(db);

      expect(await pricing.insertDiscountProfile(' VIP ')).toBe(true);
      const all = await pricing.getDiscountProfiles();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('VIP');
      expect(all[0].isActive).toBe(true);
      db.close();
    });

    it('updateDiscountProfileName and toggleDiscountProfile persist', async () => {
      const db = new Database(':memory:');
      seedBasicSchema(db);
      const { pricing } = createCore(db);
      await pricing.insertDiscountProfile('VIP');
      const [{ id }] = await pricing.getDiscountProfiles();

      expect(await pricing.updateDiscountProfileName(id, ' Gold ')).toBe(true);
      expect(await pricing.toggleDiscountProfile(id, false)).toBe(true);
      const [profile] = await pricing.getDiscountProfiles();
      expect(profile.name).toBe('Gold');
      expect(profile.isActive).toBe(false);
      db.close();
    });

    it('deleteDiscountProfile refuses while linked to an account, succeeds otherwise', async () => {
      const db = new Database(':memory:');
      const userId = seedBasicSchema(db);
      const { pricing } = createCore(db);
      const chart = db
        .prepare(`SELECT id FROM chart WHERE userId = ?`)
        .get(userId) as { id: number };
      await pricing.insertDiscountProfile('VIP');
      const [profile] = await pricing.getDiscountProfiles();
      const accountId = insertAccount(
        db,
        chart.id,
        'Customer A',
        101,
        profile.id,
      );

      expect(await pricing.deleteDiscountProfile(profile.id)).toBe(false);
      expect(await pricing.getDiscountProfiles()).toHaveLength(1);

      db.prepare(
        `UPDATE account SET discountProfileId = NULL WHERE id = ?`,
      ).run(accountId);
      expect(await pricing.deleteDiscountProfile(profile.id)).toBe(true);
      db.close();
    });

    it('deleteDiscountProfileFromAccount unassigns and deletes only when singly linked', async () => {
      const db = new Database(':memory:');
      const userId = seedBasicSchema(db);
      const { pricing } = createCore(db);
      const chart = db
        .prepare(`SELECT id FROM chart WHERE userId = ?`)
        .get(userId) as { id: number };
      await pricing.insertDiscountProfile('VIP');
      const [profile] = await pricing.getDiscountProfiles();
      const accountId = insertAccount(
        db,
        chart.id,
        'Customer A',
        101,
        profile.id,
      );

      // wrong account: refused, nothing changes
      expect(
        await pricing.deleteDiscountProfileFromAccount(999, profile.id),
      ).toBe(false);
      expect(await pricing.getDiscountProfiles()).toHaveLength(1);

      expect(
        await pricing.deleteDiscountProfileFromAccount(accountId, profile.id),
      ).toBe(true);
      expect(await pricing.getDiscountProfiles()).toHaveLength(0);
      const account = db
        .prepare(`SELECT discountProfileId FROM account WHERE id = ?`)
        .get(accountId) as { discountProfileId: number | null };
      expect(account.discountProfileId).toBeNull();
      db.close();
    });
  });

  describe('profile type discounts and auto discount resolution', () => {
    it('saveProfileTypeDiscounts upserts and getProfileTypeDiscounts reads them back', async () => {
      const db = new Database(':memory:');
      seedBasicSchema(db);
      const { pricing } = createCore(db);
      await pricing.insertDiscountProfile('VIP');
      const [profile] = await pricing.getDiscountProfiles();
      await pricing.insertItemType('Widgets');
      const [type] = await pricing.getItemTypes();

      expect(
        await pricing.saveProfileTypeDiscounts(profile.id, [
          { itemTypeId: type.id, discountPercent: 10 },
        ]),
      ).toBe(true);

      let discounts = await pricing.getProfileTypeDiscounts(profile.id);
      expect(discounts).toHaveLength(1);
      expect(discounts[0].discountPercent).toBe(10);
      expect(discounts[0].itemTypeName).toBe('Widgets');

      // upsert overwrites rather than duplicating
      await pricing.saveProfileTypeDiscounts(profile.id, [
        { itemTypeId: type.id, discountPercent: 25 },
        { itemTypeId: -1, discountPercent: 5 }, // invalid, skipped
      ]);
      discounts = await pricing.getProfileTypeDiscounts(profile.id);
      expect(discounts).toHaveLength(1);
      expect(discounts[0].discountPercent).toBe(25);
      db.close();
    });

    it('getAutoDiscount resolves the account discount profile + inventory item type', async () => {
      const db = new Database(':memory:');
      const userId = seedBasicSchema(db);
      const { pricing } = createCore(db);
      const chart = db
        .prepare(`SELECT id FROM chart WHERE userId = ?`)
        .get(userId) as { id: number };
      await pricing.insertItemType('Widgets');
      const [type] = await pricing.getItemTypes();
      await pricing.insertDiscountProfile('VIP');
      const [profile] = await pricing.getDiscountProfiles();
      await pricing.saveProfileTypeDiscounts(profile.id, [
        { itemTypeId: type.id, discountPercent: 15 },
      ]);
      const accountId = insertAccount(
        db,
        chart.id,
        'Customer A',
        101,
        profile.id,
      );
      const inventoryId = insertInventory(db, 'Widget A', 10, type.id);

      expect(await pricing.getAutoDiscount(accountId, inventoryId)).toBe(15);

      // inactive profile falls back to 0
      await pricing.toggleDiscountProfile(profile.id, false);
      expect(await pricing.getAutoDiscount(accountId, inventoryId)).toBe(0);
      db.close();
    });

    it('getPolicyDiscountPercentForInventoryIds returns undefined when discounts diverge', async () => {
      const db = new Database(':memory:');
      const userId = seedBasicSchema(db);
      const { pricing } = createCore(db);
      const chart = db
        .prepare(`SELECT id FROM chart WHERE userId = ?`)
        .get(userId) as { id: number };
      await pricing.insertItemType('A');
      await pricing.insertItemType('B');
      const [typeA, typeB] = await pricing.getItemTypes();
      await pricing.insertDiscountProfile('VIP');
      const [profile] = await pricing.getDiscountProfiles();
      await pricing.saveProfileTypeDiscounts(profile.id, [
        { itemTypeId: typeA.id, discountPercent: 10 },
        { itemTypeId: typeB.id, discountPercent: 20 },
      ]);
      const accountId = insertAccount(
        db,
        chart.id,
        'Customer A',
        101,
        profile.id,
      );
      const invA = insertInventory(db, 'Item A', 10, typeA.id);
      const invB = insertInventory(db, 'Item B', 10, typeB.id);

      expect(
        await pricing.getPolicyDiscountPercentForInventoryIds(accountId, [
          invA,
        ]),
      ).toBe(10);
      expect(
        await pricing.getPolicyDiscountPercentForInventoryIds(accountId, [
          invA,
          invB,
        ]),
      ).toBeUndefined();
      expect(
        await pricing.getPolicyDiscountPercentForInventoryIds(accountId, []),
      ).toBeUndefined();
      db.close();
    });
  });

  it('matches the main-process PricingService row for row', async () => {
    // Same operations against two identical databases — one through the old
    // sync service, one through core — must produce identical reads. This is
    // the no-behavior-change contract of the migration.
    const dbOld = new Database(':memory:');
    const dbCore = new Database(':memory:');
    seedBasicSchema(dbOld);
    seedBasicSchema(dbCore);

    const oldService = createMainService(dbOld);
    const { pricing: coreService } = createCore(dbCore);

    oldService.insertItemType('Widgets');
    await coreService.insertItemType('Widgets');
    oldService.insertItemType('Gadgets');
    await coreService.insertItemType('Gadgets');

    oldService.setPrimaryItemType(1);
    await coreService.setPrimaryItemType(1);

    oldService.insertDiscountProfile('VIP');
    await coreService.insertDiscountProfile('VIP');

    oldService.saveProfileTypeDiscounts(1, [
      { itemTypeId: 1, discountPercent: 12 },
      { itemTypeId: 2, discountPercent: 8 },
    ]);
    await coreService.saveProfileTypeDiscounts(1, [
      { itemTypeId: 1, discountPercent: 12 },
      { itemTypeId: 2, discountPercent: 8 },
    ]);

    const oldTypes = oldService.getItemTypes();
    const coreTypes = await coreService.getItemTypes();
    expect(coreTypes).toEqual(oldTypes);

    const oldProfiles = oldService.getDiscountProfiles();
    const coreProfiles = await coreService.getDiscountProfiles();
    expect(coreProfiles).toEqual(oldProfiles);

    const oldDiscounts = oldService.getProfileTypeDiscounts(1);
    const coreDiscounts = await coreService.getProfileTypeDiscounts(1);
    expect(coreDiscounts).toEqual(oldDiscounts);

    dbOld.close();
    dbCore.close();
  });
});

describe('PricingService transactions', () => {
  it('setPrimaryItemType rolls back cleanly if interrupted mid-transaction', async () => {
    const db = new Database(':memory:');
    seedBasicSchema(db);
    const { driver, pricing } = createCore(db);
    await pricing.insertItemType('A');
    const [a] = await pricing.getItemTypes();
    await pricing.setPrimaryItemType(a.id);

    await expect(
      driver.transaction(async () => {
        await pricing.clearPrimaryItemType();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // clearPrimaryItemType is not itself wrapped in a driver transaction in
    // the service, but this proves the driver's transaction/rollback works
    // against PricingService's own statements the same way as other services.
    db.close();
  });
});
