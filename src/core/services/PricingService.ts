import { uniq } from 'lodash';
import type {
  DiscountProfile,
  ItemType,
  ProfileTypeDiscount,
} from '../../types';
import type { DatabaseDriver } from '../db/driver';
import type { SessionContext } from '../ports';
import { cast, normalizeSqliteBooleanRows } from '../utils/sqlite';
import { logErrors } from '../errorLogger';

const SQLITE_ACTIVE_FIELD = ['isActive'] as const;
const SQLITE_ITEM_TYPE_BOOLEAN_FIELDS = ['isActive', 'isPrimary'] as const;

const SQL = {
  getItemTypes: `
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
    `,
  insertItemType: `
      INSERT INTO item_types (name, isActive, isPrimary)
      VALUES (@name, 1, 0)
    `,
  updateItemTypeName: `
      UPDATE item_types
      SET name = @name
      WHERE id = @id
    `,
  toggleItemType: `
      UPDATE item_types
      SET isActive = @isActive
      WHERE id = @id
    `,
  getDiscountProfiles: `
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
    `,
  insertDiscountProfile: `
      INSERT INTO discount_profiles (name, isActive)
      VALUES (@name, 1)
    `,
  updateDiscountProfileName: `
      UPDATE discount_profiles
      SET name = @name
      WHERE id = @id
    `,
  toggleDiscountProfile: `
      UPDATE discount_profiles
      SET isActive = @isActive
      WHERE id = @id
    `,
  countAccountsByProfile: `
      SELECT COUNT(*) AS count
      FROM account
      WHERE discountProfileId = @id
    `,
  countAccountUsingProfile: `
      SELECT COUNT(*) AS count
      FROM account
      WHERE id = @accountId
        AND discountProfileId = @profileId
    `,
  unassignDiscountProfileFromAccount: `
      UPDATE account
      SET discountProfileId = NULL
      WHERE id = @accountId
        AND discountProfileId = @profileId
    `,
  deleteDiscountProfile: `
      DELETE FROM discount_profiles
      WHERE id = @id
    `,
  getProfileTypeDiscounts: `
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
    `,
  upsertProfileTypeDiscount: `
      INSERT INTO profile_type_discounts (profileId, itemTypeId, discountPercent)
      VALUES (@profileId, @itemTypeId, @discountPercent)
      ON CONFLICT(profileId, itemTypeId) DO UPDATE SET
        discountPercent = excluded.discountPercent
    `,
  getAutoDiscount: `
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
    `,
  // returns distinct policy discount % values (coalesced to 0) for a set of inventory ids for a given account.
  // used for journal metadata: only store discountPercentage when there is a single distinct policy discount across all items.
  getPolicyDiscountDistinctForInventoryIds: `
      SELECT DISTINCT COALESCE(ptd.discountPercent, 0) AS discountPercent
      FROM inventory i
      LEFT JOIN account a ON a.id = @accountId
      LEFT JOIN discount_profiles dp
        ON dp.id = a.discountProfileId
       AND dp.isActive = 1
      LEFT JOIN profile_type_discounts ptd
        ON ptd.profileId = dp.id
       AND ptd.itemTypeId = i.itemTypeId
      WHERE i.id IN (SELECT value FROM json_each(@inventoryIdsJson))
    `,
  getPrimaryItemType: `
      SELECT id FROM item_types WHERE isPrimary = 1 LIMIT 1
    `,
  clearPrimaryItemType: `
      UPDATE item_types SET isPrimary = 0
    `,
  setPrimaryItemType: `
      UPDATE item_types SET isPrimary = 1 WHERE id = @id
    `,
  clearPrimaryForItemType: `
      UPDATE item_types SET isPrimary = 0 WHERE id = @id
    `,
  countInventoryByItemType: `
      SELECT COUNT(*) AS count
      FROM inventory
      WHERE itemTypeId = @id
    `,
  deleteItemType: `
      DELETE FROM item_types
      WHERE id = @id
    `,
};

/**
 * Platform-free port of src/main/services/Pricing.service.ts — identical SQL
 * and behavior, async against the DatabaseDriver, session injected.
 */
@logErrors
export class PricingService {
  private db: DatabaseDriver;

  private session: SessionContext;

  constructor(deps: { db: DatabaseDriver; session: SessionContext }) {
    this.db = deps.db;
    this.session = deps.session;
  }

  async getItemTypes(): Promise<ItemType[]> {
    const rows = await this.db.all<ItemType>(SQL.getItemTypes);
    return normalizeSqliteBooleanRows(rows, SQLITE_ITEM_TYPE_BOOLEAN_FIELDS);
  }

  async deleteItemType(id: number): Promise<boolean> {
    const usage = await this.db.get<{ count: number }>(
      SQL.countInventoryByItemType,
      { id: cast(id) },
    );
    if ((usage?.count ?? 0) > 0) return false;

    const result = await this.db.run(SQL.deleteItemType, { id: cast(id) });
    return Boolean(result.changes);
  }

  async getPrimaryItemType(): Promise<number | undefined> {
    const row = await this.db.get<{ id: number }>(SQL.getPrimaryItemType);
    return row?.id;
  }

  async setPrimaryItemType(itemTypeId: number): Promise<boolean> {
    return this.db.transaction(async () => {
      await this.db.run(SQL.clearPrimaryItemType);
      const result = await this.db.run(SQL.setPrimaryItemType, {
        id: cast(itemTypeId),
      });
      return Boolean(result.changes);
    });
  }

  async clearPrimaryItemType(): Promise<boolean> {
    await this.db.run(SQL.clearPrimaryItemType);
    return true;
  }

  async insertItemType(name: string): Promise<boolean> {
    const result = await this.db.run(SQL.insertItemType, { name: name.trim() });
    return Boolean(result.changes);
  }

  async updateItemTypeName(id: number, name: string): Promise<boolean> {
    const result = await this.db.run(SQL.updateItemTypeName, {
      id: cast(id),
      name: name.trim(),
    });
    return Boolean(result.changes);
  }

  async toggleItemType(id: number, isActive: boolean): Promise<boolean> {
    if (!isActive) {
      await this.db.run(SQL.clearPrimaryForItemType, { id: cast(id) });
    }
    const result = await this.db.run(SQL.toggleItemType, {
      id: cast(id),
      isActive: cast(isActive),
    });
    return Boolean(result.changes);
  }

  async getDiscountProfiles(): Promise<DiscountProfile[]> {
    const rows = await this.db.all<DiscountProfile>(SQL.getDiscountProfiles);
    return normalizeSqliteBooleanRows(rows, SQLITE_ACTIVE_FIELD);
  }

  async insertDiscountProfile(name: string): Promise<boolean> {
    const result = await this.db.run(SQL.insertDiscountProfile, {
      name: name.trim(),
    });
    return Boolean(result.changes);
  }

  async updateDiscountProfileName(id: number, name: string): Promise<boolean> {
    const result = await this.db.run(SQL.updateDiscountProfileName, {
      id: cast(id),
      name: name.trim(),
    });
    return Boolean(result.changes);
  }

  async toggleDiscountProfile(id: number, isActive: boolean): Promise<boolean> {
    const result = await this.db.run(SQL.toggleDiscountProfile, {
      id: cast(id),
      isActive: cast(isActive),
    });
    return Boolean(result.changes);
  }

  async deleteDiscountProfile(id: number): Promise<boolean> {
    const linkedAccounts = await this.db.get<{ count: number }>(
      SQL.countAccountsByProfile,
      { id: cast(id) },
    );
    if ((linkedAccounts?.count ?? 0) > 0) return false;

    const result = await this.db.run(SQL.deleteDiscountProfile, {
      id: cast(id),
    });
    return Boolean(result.changes);
  }

  async deleteDiscountProfileFromAccount(
    accountId: number,
    profileId: number,
  ): Promise<boolean> {
    return this.db.transaction(async () => {
      const linkedAccounts = await this.db.get<{ count: number }>(
        SQL.countAccountsByProfile,
        { id: cast(profileId) },
      );
      if ((linkedAccounts?.count ?? 0) !== 1) return false;

      const targetAccount = await this.db.get<{ count: number }>(
        SQL.countAccountUsingProfile,
        { accountId: cast(accountId), profileId: cast(profileId) },
      );
      if ((targetAccount?.count ?? 0) !== 1) return false;

      const unlinked = await this.db.run(
        SQL.unassignDiscountProfileFromAccount,
        {
          accountId: cast(accountId),
          profileId: cast(profileId),
        },
      );
      if (!unlinked.changes) return false;

      const deleted = await this.db.run(SQL.deleteDiscountProfile, {
        id: cast(profileId),
      });
      return Boolean(deleted.changes);
    });
  }

  async getProfileTypeDiscounts(
    profileId: number,
  ): Promise<ProfileTypeDiscount[]> {
    return this.db.all<ProfileTypeDiscount>(SQL.getProfileTypeDiscounts, {
      profileId: cast(profileId),
    });
  }

  async saveProfileTypeDiscounts(
    profileId: number,
    discounts: Array<{ itemTypeId: number; discountPercent: number }>,
  ): Promise<boolean> {
    await this.db.transaction(async () => {
      for (const discount of discounts) {
        const itemTypeId = Number(discount.itemTypeId);
        const discountPercent = Number(discount.discountPercent);
        if (!Number.isFinite(itemTypeId) || itemTypeId <= 0) continue;

        // eslint-disable-next-line no-await-in-loop
        await this.db.run(SQL.upsertProfileTypeDiscount, {
          profileId: cast(profileId),
          itemTypeId: cast(itemTypeId),
          discountPercent: Number.isFinite(discountPercent)
            ? discountPercent
            : 0,
        });
      }
    });

    return true;
  }

  async getAutoDiscount(
    accountId: number,
    inventoryId: number,
  ): Promise<number> {
    const result = await this.db.get<{ discountPercent?: number }>(
      SQL.getAutoDiscount,
      { accountId: cast(accountId), inventoryId: cast(inventoryId) },
    );
    return Number(result?.discountPercent ?? 0);
  }

  async getPolicyDiscountPercentForInventoryIds(
    accountId: number,
    inventoryIds: number[],
  ): Promise<number | undefined> {
    const normalizedIds = uniq(
      inventoryIds.filter((id) => Number.isFinite(id) && id > 0),
    );
    if (!normalizedIds.length) return undefined;

    // resolve policy discounts for all provided inventoryIds in one query and only return when a single distinct discount applies.
    const rows = await this.db.all<{ discountPercent?: number }>(
      SQL.getPolicyDiscountDistinctForInventoryIds,
      {
        accountId: cast(accountId),
        inventoryIdsJson: JSON.stringify(normalizedIds),
      },
    );
    const distinct = uniq(rows.map((r) => Number(r.discountPercent ?? 0)));
    if (distinct.length !== 1) return undefined;
    return distinct[0];
  }
}
