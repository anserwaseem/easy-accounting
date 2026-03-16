import type { Database, Statement } from 'better-sqlite3';
import type { DiscountProfile, ItemType, ProfileTypeDiscount } from 'types';
import { logErrors } from '../errorLogger';
import { DatabaseService } from './Database.service';
import { cast, normalizeSqliteBooleanRows } from '../utils/sqlite';

const SQLITE_ACTIVE_FIELD = ['isActive'] as const;
const SQLITE_ITEM_TYPE_BOOLEAN_FIELDS = ['isActive', 'isPrimary'] as const;

@logErrors
export class PricingService {
  private db: Database;

  private stmGetItemTypes!: Statement;

  private stmInsertItemType!: Statement;

  private stmUpdateItemTypeName!: Statement;

  private stmToggleItemType!: Statement;

  private stmGetDiscountProfiles!: Statement;

  private stmInsertDiscountProfile!: Statement;

  private stmUpdateDiscountProfileName!: Statement;

  private stmToggleDiscountProfile!: Statement;

  private stmCountAccountsByProfile!: Statement;

  private stmCountAccountUsingProfile!: Statement;

  private stmUnassignDiscountProfileFromAccount!: Statement;

  private stmDeleteDiscountProfile!: Statement;

  private stmGetProfileTypeDiscounts!: Statement;

  private stmUpsertProfileTypeDiscount!: Statement;

  private stmGetAutoDiscount!: Statement;

  private stmClearPrimaryItemType!: Statement;

  private stmSetPrimaryItemType!: Statement;

  private stmGetPrimaryItemType!: Statement;

  private stmClearPrimaryForItemType!: Statement;

  private stmCountInventoryByItemType!: Statement;

  private stmDeleteItemType!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.initPreparedStatements();
  }

  getItemTypes(): ItemType[] {
    const rows = this.stmGetItemTypes.all() as ItemType[];
    return normalizeSqliteBooleanRows(rows, SQLITE_ITEM_TYPE_BOOLEAN_FIELDS);
  }

  deleteItemType(id: number): boolean {
    const usage = this.stmCountInventoryByItemType.get({
      id: cast(id),
    }) as { count: number } | undefined;
    if ((usage?.count ?? 0) > 0) return false;

    const result = this.stmDeleteItemType.run({ id: cast(id) });
    return Boolean(result.changes);
  }

  getPrimaryItemType(): number | undefined {
    const row = this.stmGetPrimaryItemType.get() as { id: number } | undefined;
    return row?.id;
  }

  setPrimaryItemType(itemTypeId: number): boolean {
    return this.db.transaction(() => {
      this.stmClearPrimaryItemType.run();
      const result = this.stmSetPrimaryItemType.run({ id: cast(itemTypeId) });
      return Boolean(result.changes);
    })();
  }

  clearPrimaryItemType(): boolean {
    this.stmClearPrimaryItemType.run();
    return true;
  }

  insertItemType(name: string): boolean {
    const result = this.stmInsertItemType.run({ name: name.trim() });
    return Boolean(result.changes);
  }

  updateItemTypeName(id: number, name: string): boolean {
    const result = this.stmUpdateItemTypeName.run({
      id: cast(id),
      name: name.trim(),
    });
    return Boolean(result.changes);
  }

  toggleItemType(id: number, isActive: boolean): boolean {
    if (!isActive) {
      this.stmClearPrimaryForItemType.run({ id: cast(id) });
    }
    const result = this.stmToggleItemType.run({
      id: cast(id),
      isActive: cast(isActive),
    });
    return Boolean(result.changes);
  }

  getDiscountProfiles(): DiscountProfile[] {
    const rows = this.stmGetDiscountProfiles.all() as DiscountProfile[];
    return normalizeSqliteBooleanRows(rows, SQLITE_ACTIVE_FIELD);
  }

  insertDiscountProfile(name: string): boolean {
    const result = this.stmInsertDiscountProfile.run({
      name: name.trim(),
    });
    return Boolean(result.changes);
  }

  updateDiscountProfileName(id: number, name: string): boolean {
    const result = this.stmUpdateDiscountProfileName.run({
      id: cast(id),
      name: name.trim(),
    });
    return Boolean(result.changes);
  }

  toggleDiscountProfile(id: number, isActive: boolean): boolean {
    const result = this.stmToggleDiscountProfile.run({
      id: cast(id),
      isActive: cast(isActive),
    });
    return Boolean(result.changes);
  }

  deleteDiscountProfile(id: number): boolean {
    const linkedAccounts = this.stmCountAccountsByProfile.get({
      id: cast(id),
    }) as { count: number } | undefined;
    if ((linkedAccounts?.count ?? 0) > 0) return false;

    const result = this.stmDeleteDiscountProfile.run({
      id: cast(id),
    });
    return Boolean(result.changes);
  }

  deleteDiscountProfileFromAccount(
    accountId: number,
    profileId: number,
  ): boolean {
    const run = this.db.transaction(() => {
      const linkedAccounts = this.stmCountAccountsByProfile.get({
        id: cast(profileId),
      }) as { count: number } | undefined;
      if ((linkedAccounts?.count ?? 0) !== 1) return false;

      const targetAccount = this.stmCountAccountUsingProfile.get({
        accountId: cast(accountId),
        profileId: cast(profileId),
      }) as { count: number } | undefined;
      if ((targetAccount?.count ?? 0) !== 1) return false;

      const unlinked = this.stmUnassignDiscountProfileFromAccount.run({
        accountId: cast(accountId),
        profileId: cast(profileId),
      });
      if (!unlinked.changes) return false;

      const deleted = this.stmDeleteDiscountProfile.run({
        id: cast(profileId),
      });
      return Boolean(deleted.changes);
    });

    return run();
  }

  getProfileTypeDiscounts(profileId: number): ProfileTypeDiscount[] {
    return this.stmGetProfileTypeDiscounts.all({
      profileId: cast(profileId),
    }) as ProfileTypeDiscount[];
  }

  saveProfileTypeDiscounts(
    profileId: number,
    discounts: Array<{ itemTypeId: number; discountPercent: number }>,
  ): boolean {
    const run = this.db.transaction(() => {
      for (const discount of discounts) {
        const itemTypeId = Number(discount.itemTypeId);
        const discountPercent = Number(discount.discountPercent);
        if (!Number.isFinite(itemTypeId) || itemTypeId <= 0) continue;

        this.stmUpsertProfileTypeDiscount.run({
          profileId: cast(profileId),
          itemTypeId: cast(itemTypeId),
          discountPercent: Number.isFinite(discountPercent)
            ? discountPercent
            : 0,
        });
      }
    });

    run();
    return true;
  }

  getAutoDiscount(accountId: number, inventoryId: number): number {
    const result = this.stmGetAutoDiscount.get({
      accountId: cast(accountId),
      inventoryId: cast(inventoryId),
    }) as { discountPercent?: number } | undefined;
    return Number(result?.discountPercent ?? 0);
  }

  private initPreparedStatements() {
    this.stmGetItemTypes = this.db.prepare(`
      SELECT
        it.id,
        it.name,
        it.isActive,
        it.isPrimary,
        it.createdAt,
        it.updatedAt,
        COUNT(inv.id) AS inventoryCount
      FROM item_types it
      LEFT JOIN inventory inv ON inv.itemTypeId = it.id
      GROUP BY
        it.id,
        it.name,
        it.isActive,
        it.isPrimary,
        it.createdAt,
        it.updatedAt
      ORDER BY it.id
    `);

    this.stmInsertItemType = this.db.prepare(`
      INSERT INTO item_types (name, isActive, isPrimary)
      VALUES (@name, 1, 0)
    `);

    this.stmUpdateItemTypeName = this.db.prepare(`
      UPDATE item_types
      SET name = @name
      WHERE id = @id
    `);

    this.stmToggleItemType = this.db.prepare(`
      UPDATE item_types
      SET isActive = @isActive
      WHERE id = @id
    `);

    this.stmGetDiscountProfiles = this.db.prepare(`
      SELECT
        dp.id,
        dp.name,
        dp.isActive,
        dp.createdAt,
        dp.updatedAt,
        COUNT(a.id) AS accountCount
      FROM discount_profiles dp
      LEFT JOIN account a ON a.discountProfileId = dp.id
      LEFT JOIN chart c ON c.id = a.chartId
      WHERE c.type = 'Asset' OR c.type IS NULL
      GROUP BY dp.id, dp.name, dp.isActive, dp.createdAt, dp.updatedAt
      ORDER BY dp.id
    `);

    this.stmInsertDiscountProfile = this.db.prepare(`
      INSERT INTO discount_profiles (name, isActive)
      VALUES (@name, 1)
    `);

    this.stmUpdateDiscountProfileName = this.db.prepare(`
      UPDATE discount_profiles
      SET name = @name
      WHERE id = @id
    `);

    this.stmToggleDiscountProfile = this.db.prepare(`
      UPDATE discount_profiles
      SET isActive = @isActive
      WHERE id = @id
    `);

    this.stmCountAccountsByProfile = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM account
      WHERE discountProfileId = @id
    `);

    this.stmCountAccountUsingProfile = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM account
      WHERE id = @accountId
        AND discountProfileId = @profileId
    `);

    this.stmUnassignDiscountProfileFromAccount = this.db.prepare(`
      UPDATE account
      SET discountProfileId = NULL
      WHERE id = @accountId
        AND discountProfileId = @profileId
    `);

    this.stmDeleteDiscountProfile = this.db.prepare(`
      DELETE FROM discount_profiles
      WHERE id = @id
    `);

    this.stmGetProfileTypeDiscounts = this.db.prepare(`
      SELECT
        ptd.id,
        ptd.profileId,
        ptd.itemTypeId,
        ptd.discountPercent,
        ptd.createdAt,
        ptd.updatedAt,
        it.name AS itemTypeName
      FROM profile_type_discounts ptd
      JOIN item_types it ON it.id = ptd.itemTypeId
      WHERE ptd.profileId = @profileId
      ORDER BY ptd.itemTypeId
    `);

    this.stmUpsertProfileTypeDiscount = this.db.prepare(`
      INSERT INTO profile_type_discounts (profileId, itemTypeId, discountPercent)
      VALUES (@profileId, @itemTypeId, @discountPercent)
      ON CONFLICT(profileId, itemTypeId) DO UPDATE SET
        discountPercent = excluded.discountPercent
    `);

    this.stmGetAutoDiscount = this.db.prepare(`
      SELECT COALESCE(ptd.discountPercent, 0) AS discountPercent
      FROM account a
      LEFT JOIN discount_profiles dp
        ON dp.id = a.discountProfileId
       AND dp.isActive = 1
      LEFT JOIN inventory i ON i.id = @inventoryId
      LEFT JOIN profile_type_discounts ptd
        ON ptd.profileId = dp.id
       AND ptd.itemTypeId = i.itemTypeId
      WHERE a.id = @accountId
      LIMIT 1
    `);

    this.stmGetPrimaryItemType = this.db.prepare(`
      SELECT id FROM item_types WHERE isPrimary = 1 LIMIT 1
    `);

    this.stmClearPrimaryItemType = this.db.prepare(`
      UPDATE item_types SET isPrimary = 0
    `);

    this.stmSetPrimaryItemType = this.db.prepare(`
      UPDATE item_types SET isPrimary = 1 WHERE id = @id
    `);

    this.stmClearPrimaryForItemType = this.db.prepare(`
      UPDATE item_types SET isPrimary = 0 WHERE id = @id
    `);

    this.stmCountInventoryByItemType = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM inventory
      WHERE itemTypeId = @id
    `);

    this.stmDeleteItemType = this.db.prepare(`
      DELETE FROM item_types
      WHERE id = @id
    `);
  }
}
