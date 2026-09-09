import { get } from 'lodash';
import type {
  ApiResponse,
  AttributeDefinition,
  UpsertAttributeDefinition,
  ApplyListPositionsResult,
  ApplyStockAdjustmentPayload,
  BulkPriceListPositionPatch,
  BulkPriceListPositionResult,
  InsertInventoryItem,
  InventoryItem,
  InventoryOpeningStock,
  ReportResponse,
  SetOpeningStockItem,
  StockAdjustment,
  StockAsOfReportResponse,
  StockAsOfRow,
  UpdateInventoryItem,
} from 'types';
import type { DatabaseDriver } from '../db/driver';
import { INVENTORY_BASELINE_REASON } from '../db/inventoryBaselineBackfill';
import type { KeyValueStore, SessionContext } from '../ports';
import { logErrors } from '../errorLogger';
import { itemNameError } from '../utils/itemName';
import { cast, raise } from '../utils/sqlite';
import { parseJsonRecord, parseListPrices } from '../utils/inventoryJson';

const SQL = {
  inventoryExists: `
      SELECT COUNT(*) AS 'count' from inventory;
    `,

  // docs/derived-state-design.md §6 migration 028: quantity now comes from
  // inventory_quantity_view (canon), LEFT JOINed with COALESCE(...,0) for
  // items with no movements yet. `i.*` is listed first and the view's
  // quantity alias second so the alias overwrites the stored column of the
  // same name when better-sqlite3 builds the row object (columns are
  // assigned to the result object in SELECT order, so a later same-named
  // column wins) — no need to enumerate every other `inventory` column by
  // hand.
  //
  // listPricesJson: { priceListId: price } for every list this item is priced
  // on; parsed in getInventory so the renderer gets a plain object
  getInventory: `
      SELECT i.*, it.name AS itemTypeName,
             COALESCE(iq.quantity, 0) AS quantity,
             (
               SELECT json_group_object(ip.priceListId, ip.price)
               FROM inventory_prices ip
               WHERE ip.inventoryId = i.id
             ) AS listPricesJson
      FROM inventory i
      LEFT JOIN item_types it ON it.id = i.itemTypeId
      LEFT JOIN inventory_quantity_view iq ON iq.inventoryId = i.id
      ORDER BY (i.listPosition IS NULL), i.listPosition ASC, i.id ASC;
    `,
  // Write-path-only: exact pre-cutover SQL against the stored `quantity`
  // column. Used only by setOpeningStock's resetOthersToZero branch to
  // capture each item's prior STORED quantity for the inventory_opening_stock
  // audit column (`old_quantity`) — that write path stays exactly as today
  // (see the class doc comment), so its input must stay the stored value.
  getInventoryStoredForReset: `
      SELECT i.*, it.name AS itemTypeName,
             (
               SELECT json_group_object(ip.priceListId, ip.price)
               FROM inventory_prices ip
               WHERE ip.inventoryId = i.id
             ) AS listPricesJson
      FROM inventory i
      LEFT JOIN item_types it ON it.id = i.itemTypeId
      ORDER BY (i.listPosition IS NULL), i.listPosition ASC, i.id ASC;
    `,

  insertItem: `
      INSERT INTO inventory (name, description, descriptionUrdu, price, title, itemTypeId, listPosition)
      VALUES (@name, @description, @descriptionUrdu, @price, @title, @itemTypeId, @listPosition);
    `,

  updateItem: `
      UPDATE inventory
      SET price = @price,
          description = @description,
          descriptionUrdu = @descriptionUrdu,
          title = @title,
          itemTypeId = @itemTypeId,
          listPosition = @listPosition
      WHERE id = @id;
    `,

  getOpeningStock: `
      SELECT * FROM inventory_opening_stock ORDER BY inventoryId
    `,

  upsertOpeningStock: `
      INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate, old_quantity)
      VALUES (@inventoryId, @quantity, @asOfDate, @old_quantity)
      ON CONFLICT(inventoryId) DO UPDATE SET
        quantity = excluded.quantity,
        asOfDate = excluded.asOfDate,
        old_quantity = excluded.old_quantity
    `,

  updateInventoryQuantity: `
      UPDATE inventory SET quantity = quantity + ? WHERE id = ?
    `,

  setInventoryQuantity: `
      UPDATE inventory SET quantity = ? WHERE id = ?
    `,

  insertStockAdjustment: `
      INSERT INTO stock_adjustments (inventoryId, quantityDelta, reason, date)
      VALUES (@inventoryId, @quantityDelta, @reason, @date)
    `,

  // Structural/import baseline rows (INVENTORY_BASELINE_REASON) participate
  // fully in quantity math (inventory_quantity_view) but were never a screen
  // in the desktop app — excluded here so they never leak into user-facing
  // adjustment lists/history. The reason value is a hardcoded, quote-free
  // constant (see its own doc comment), interpolated directly since it is
  // not user input.
  getStockAdjustments: `
      SELECT * FROM stock_adjustments
      WHERE COALESCE(reason,'') != '${INVENTORY_BASELINE_REASON}'
      ORDER BY date DESC, id DESC
    `,

  getStockAdjustmentsByInventoryId: `
      SELECT * FROM stock_adjustments
      WHERE inventoryId = ? AND COALESCE(reason,'') != '${INVENTORY_BASELINE_REASON}'
      ORDER BY date DESC, id DESC
    `,

  getInventoryQuantity: `
      SELECT quantity FROM inventory WHERE id = ?
    `,

  getInventoryIdByName: `
      SELECT id FROM inventory WHERE TRIM(name) = ? LIMIT 1
    `,

  // Excludes structural baseline rows (see getStockAdjustments above) so an
  // item whose only "history" is the carried-over import baseline does not
  // show a history indicator it never earned. opening_stock arm is
  // unchanged — it is not a per-adjustment record.
  getInventoryIdsWithHistory: `
      SELECT DISTINCT inventoryId AS id
      FROM (
        SELECT inventoryId FROM inventory_opening_stock
        UNION ALL
        SELECT inventoryId FROM stock_adjustments
        WHERE COALESCE(reason,'') != '${INVENTORY_BASELINE_REASON}'
      );
    `,

  // Get all inventory items (unfiltered). Report-only reads (getInventoryHealth,
  // getStockAsOf) — quantity comes from inventory_quantity_view (canon), same
  // column-order-wins trick as getInventory above.
  getAllInventory: `
      SELECT i.*, it.name AS itemTypeName, COALESCE(iq.quantity, 0) AS quantity
      FROM inventory i
      LEFT JOIN item_types it ON it.id = i.itemTypeId
      LEFT JOIN inventory_quantity_view iq ON iq.inventoryId = i.id
      ORDER BY (i.listPosition IS NULL), i.listPosition ASC, i.id ASC
    `,

  // Get all inventory items filtered by item type IDs using JSON1
  getAllInventoryByItemTypes: `
      SELECT i.*, it.name AS itemTypeName, COALESCE(iq.quantity, 0) AS quantity
      FROM inventory i
      LEFT JOIN item_types it ON it.id = i.itemTypeId
      LEFT JOIN inventory_quantity_view iq ON iq.inventoryId = i.id
      WHERE i.itemTypeId IN (SELECT value FROM json_each(@itemTypeIdsJson))
      ORDER BY (i.listPosition IS NULL), i.listPosition ASC, i.id ASC
    `,

  upsertInventoryPrice: `
      INSERT INTO inventory_prices (inventoryId, priceListId, price)
      VALUES (?, ?, ?)
      ON CONFLICT(inventoryId, priceListId) DO UPDATE SET price = excluded.price
    `,

  deleteInventoryPrice: `
      DELETE FROM inventory_prices WHERE inventoryId = ? AND priceListId = ?
    `,

  // usageCount tells the UI whether a definition is safe to delete, and how
  // much data a change would affect
  getAttributeDefinitions: `
      SELECT ad.id, ad.key, ad.label, ad.unit, ad.valueType, ad.sortOrder,
             ad.isActive, ad.isPublic,
             (SELECT COUNT(*) FROM inventory i
               WHERE i.attributes IS NOT NULL
                 AND json_extract(i.attributes, '$.' || ad.key) IS NOT NULL
             ) AS usageCount
      FROM attribute_definitions ad
      ORDER BY ad.sortOrder ASC, ad.label ASC
    `,

  deleteAttributeDefinition: `
      DELETE FROM attribute_definitions WHERE id = ?
    `,

  countAttributeUsage: `
      SELECT COUNT(*) AS c FROM inventory
      WHERE attributes IS NOT NULL
        AND json_extract(attributes, '$.' || ?) IS NOT NULL
    `,

  // strips one key from every item's attributes; an item left with no
  // attributes stores NULL so the "has attributes" publish check stays true
  // to its meaning
  removeAttributeFromItems: `
      UPDATE inventory
         SET attributes = CASE
               WHEN json_remove(attributes, '$.' || @key) = '{}' THEN NULL
               ELSE json_remove(attributes, '$.' || @key)
             END
       WHERE attributes IS NOT NULL
         AND json_extract(attributes, '$.' || @key) IS NOT NULL
    `,

  // a NULL sortOrder means "append": the next value is derived from the
  // current MAX, so deleting a definition can never make a later insert
  // collide with an existing order (counting rows would)
  insertAttributeDefinition: `
      INSERT OR IGNORE INTO attribute_definitions
        (key, label, unit, valueType, isPublic, sortOrder)
      VALUES (
        @key, @label, @unit, @valueType, @isPublic,
        COALESCE(
          @sortOrder,
          (SELECT COALESCE(MAX(sortOrder), 0) + 1 FROM attribute_definitions)
        )
      )
    `,

  updateAttributeDefinition: `
      UPDATE attribute_definitions
      SET label = @label, unit = @unit, valueType = @valueType,
          isPublic = @isPublic, sortOrder = @sortOrder
      WHERE id = @id
    `,

  toggleAttributeDefinition: `
      UPDATE attribute_definitions SET isActive = ? WHERE id = ?
    `,

  setAttributeDefinitionPublic: `
      UPDATE attribute_definitions SET isPublic = ? WHERE id = ?
    `,

  setItemExcluded: `
      UPDATE inventory SET excludeFromCatalog = ? WHERE id = ?
    `,

  // the whitelist the catalog builder narrows public attributes to
  getPublicAttributeKeys: `
      SELECT key FROM attribute_definitions
       WHERE isPublic = 1 AND isActive = 1
       ORDER BY sortOrder ASC, label ASC
    `,

  setAttributeDefinitionOrder: `
      UPDATE attribute_definitions SET sortOrder = ? WHERE id = ?
    `,

  updateInventoryAttributes: `
      UPDATE inventory SET attributes = ? WHERE id = ?
    `,

  getInventoryIdsByTrimName: `
      SELECT id FROM inventory WHERE TRIM(name) = TRIM(?)
    `,

  updateInventoryListPositionById: `
      UPDATE inventory SET listPosition = ? WHERE id = ?
    `,

  updatePriceAndListPositionById: `
      UPDATE inventory
      SET price = @price, listPosition = @listPosition
      WHERE id = @id
    `,

  // Sale quantity aggregate WITH lastDate (for inventory health)
  getSaleAggregateHealth: `
      SELECT ii.inventoryId, SUM(ii.quantity) AS totalQty, MAX(i.date) AS lastDate
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE i.invoiceType = 'Sale'
        AND i.isQuotation = 0
        AND i.isReturned = 0
        AND i.date >= ?
        AND i.date <= ?
      GROUP BY ii.inventoryId
    `,

  // Purchase quantity aggregate WITH lastDate (for inventory health)
  getPurchaseAggregateHealth: `
      SELECT ii.inventoryId, SUM(ii.quantity) AS totalQty, MAX(i.date) AS lastDate
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE i.invoiceType = 'Purchase'
        AND i.isQuotation = 0
        AND i.isReturned = 0
        AND i.date >= ?
        AND i.date <= ?
      GROUP BY ii.inventoryId
    `,

  // invoice # for the latest sale line per inventory in range (tie-break: higher invoice id)
  getSaleLastInvoiceHealth: `
      SELECT inventoryId, invoiceNumber
      FROM (
        SELECT
          ii.inventoryId,
          i.invoiceNumber,
          ROW_NUMBER() OVER (
            PARTITION BY ii.inventoryId
            ORDER BY i.date DESC, i.id DESC
          ) AS rn
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoiceId
        WHERE i.invoiceType = 'Sale'
          AND i.isQuotation = 0
          AND i.isReturned = 0
          AND i.date >= ?
          AND i.date <= ?
      )
      WHERE rn = 1
    `,

  // invoice # for the latest purchase line per inventory in range
  getPurchaseLastInvoiceHealth: `
      SELECT inventoryId, invoiceNumber
      FROM (
        SELECT
          ii.inventoryId,
          i.invoiceNumber,
          ROW_NUMBER() OVER (
            PARTITION BY ii.inventoryId
            ORDER BY i.date DESC, i.id DESC
          ) AS rn
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoiceId
        WHERE i.invoiceType = 'Purchase'
          AND i.isQuotation = 0
          AND i.isReturned = 0
          AND i.date >= ?
          AND i.date <= ?
      )
      WHERE rn = 1
    `,

  // Stock adjustment aggregate
  getAdjustmentAggregate: `
      SELECT inventoryId, SUM(quantityDelta) AS totalDelta, MAX(date) AS lastDate
      FROM stock_adjustments
      WHERE date >= ? AND date <= ?
      GROUP BY inventoryId
    `,

  getSaleLastDateEver: `
      SELECT ii.inventoryId, MAX(i.date) AS lastDate
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE i.invoiceType = 'Sale'
        AND i.isQuotation = 0
        AND i.isReturned = 0
      GROUP BY ii.inventoryId
    `,

  getPurchaseLastDateEver: `
      SELECT ii.inventoryId, MAX(i.date) AS lastDate
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE i.invoiceType = 'Purchase'
        AND i.isQuotation = 0
        AND i.isReturned = 0
      GROUP BY ii.inventoryId
    `,

  // Excludes structural baseline rows: a synthesized 2000-01-01 import
  // baseline is not a human "last adjusted" date and must not surface as
  // one in report columns that read this.
  getAdjustmentLastDateEver: `
      SELECT inventoryId, MAX(date) AS lastDate
      FROM stock_adjustments
      WHERE COALESCE(reason,'') != '${INVENTORY_BASELINE_REASON}'
      GROUP BY inventoryId
    `,

  stockAsOfInvoiceDeltaAfter: `
      SELECT ii.inventoryId,
        COALESCE(SUM(
          CASE
            WHEN COALESCE(i.isQuotation, 0) != 0 THEN 0
            WHEN i.invoiceType = 'Sale' THEN
              CASE WHEN COALESCE(i.isReturned, 0) = 0 THEN
                CASE WHEN i.date > ? THEN -ii.quantity ELSE 0 END
              ELSE
                (CASE WHEN i.date > ? THEN -ii.quantity ELSE 0 END) +
                (CASE
                  WHEN i.returnedAt IS NOT NULL AND i.returnedAt > ?
                  THEN ii.quantity
                  ELSE 0
                END)
              END
            WHEN i.invoiceType = 'Purchase' THEN
              CASE WHEN COALESCE(i.isReturned, 0) = 0 THEN
                CASE WHEN i.date > ? THEN ii.quantity ELSE 0 END
              ELSE
                (CASE WHEN i.date > ? THEN ii.quantity ELSE 0 END) +
                (CASE
                  WHEN i.returnedAt IS NOT NULL AND i.returnedAt > ?
                  THEN -ii.quantity
                  ELSE 0
                END)
              END
            ELSE 0
          END
        ), 0) AS deltaQty
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      GROUP BY ii.inventoryId
    `,

  stockAsOfAdjustmentDeltaAfter: `
      SELECT inventoryId,
        COALESCE(SUM(quantityDelta), 0) AS deltaQty
      FROM stock_adjustments
      WHERE date > ?
      GROUP BY inventoryId
    `,

  // docs/derived-state-design.md §6 migration 028, D3 (setOpeningStock
  // absolute overwrite): unconditional sum of every recorded movement for
  // one item — the SAME CASE logic as inventory_quantity_view's two inner
  // subqueries (migrations/027.js), minus the opening-stock term. Used by
  // setOpeningStock to size a compensating stock_adjustments row so that
  // inventory_quantity_view keeps agreeing with the absolute value the user
  // just set via setInventoryQuantity, even when movements already exist for
  // the item (see insertCompensatingResetAdjustment below).
  movementsForItem: `
      SELECT
        COALESCE((
          SELECT SUM(
            CASE
              WHEN COALESCE(inv.isQuotation, 0) != 0 THEN 0
              WHEN inv.invoiceType = 'Sale' THEN
                CASE WHEN COALESCE(inv.isReturned, 0) = 0 THEN -ii.quantity ELSE 0 END
              WHEN inv.invoiceType = 'Purchase' THEN
                CASE WHEN COALESCE(inv.isReturned, 0) = 0 THEN ii.quantity ELSE 0 END
              ELSE 0
            END
          )
          FROM invoice_items ii
          JOIN invoices inv ON inv.id = ii.invoiceId
          WHERE ii.inventoryId = ?
        ), 0)
        +
        COALESCE((
          SELECT SUM(sa.quantityDelta)
          FROM stock_adjustments sa
          WHERE sa.inventoryId = ?
        ), 0) AS movements
    `,
};

/** docs/derived-state-design.md §6 migration 028, D3. */
const STOCKTAKE_RESET_REASON = 'Stocktake correction (opening stock reset)';

/**
 * Platform-free port of src/main/services/Inventory.service.ts — identical
 * SQL and behavior, async against the DatabaseDriver.
 *
 * Not user-scoped (inventory is installation-wide, unlike account/chart), so
 * `session` is accepted only for constructor-shape consistency with the rest
 * of the core services and is currently unused.
 *
 * `store` is optional and mirrors the one config value the original service
 * reads from electron-store's publish config (`publish.reservedNameChars`)
 * via `getPublishConfig()` — a module that itself depends on Electron's
 * `safeStorage` and so cannot be imported into core. When `store` is not
 * supplied (or the key is unset), name validation allows every character,
 * matching the original's default (empty reserved-chars) behavior.
 */
@logErrors
export class InventoryService {
  private db: DatabaseDriver;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private session: SessionContext;

  private store?: KeyValueStore;

  constructor(deps: {
    db: DatabaseDriver;
    session: SessionContext;
    store?: KeyValueStore;
  }) {
    this.db = deps.db;
    this.session = deps.session;
    this.store = deps.store;
  }

  async doesInventoryExist(): Promise<boolean> {
    const result = await this.db.get<{ count: number }>(SQL.inventoryExists);
    return get(result, 'count', 0) > 0;
  }

  async getInventory(): Promise<InventoryItem[]> {
    const results = await this.db.all<
      Omit<InventoryItem, 'attributes' | 'listPrices'> & {
        attributes?: string | null;
        listPricesJson?: string | null;
      }
    >(SQL.getInventory);
    return results.map(({ attributes, listPricesJson, ...item }) => ({
      ...item,
      attributes: parseJsonRecord(attributes),
      listPrices: parseListPrices(listPricesJson),
    }));
  }

  /** All custom attribute definitions, in display order. */
  async getAttributeDefinitions(): Promise<AttributeDefinition[]> {
    return this.db.all<AttributeDefinition>(SQL.getAttributeDefinitions);
  }

  /** Creates a definition (no-op when the key exists) or updates one by id. */
  async upsertAttributeDefinition(
    input: UpsertAttributeDefinition,
  ): Promise<boolean> {
    const key = input.key?.trim();
    const label = input.label?.trim();
    if (!key || !label) return false;
    const params = {
      key,
      label,
      unit: input.unit?.trim() || null,
      valueType: input.valueType,
      // publishing is opt-in: a new attribute is private until marked public,
      // so an internal key cannot reach the public catalog by being forgotten
      isPublic: input.isPublic ? 1 : 0,
      // null lets the insert append after the current highest order
      sortOrder: input.sortOrder ?? null,
    };
    if (input.id) {
      const result = await this.db.run(SQL.updateAttributeDefinition, {
        ...params,
        sortOrder: input.sortOrder ?? 0,
        id: cast(input.id),
      });
      return result.changes > 0;
    }
    const result = await this.db.run(SQL.insertAttributeDefinition, params);
    return result.changes > 0;
  }

  /**
   * Deletes a definition.
   *
   * When items still use it, the call reports the usage instead of deleting, so
   * the caller can confirm first. Passing `force` then deletes the definition
   * AND strips its value from every item, in one transaction — values left
   * behind would keep appearing in the published catalog with no way to edit
   * them.
   */
  async deleteAttributeDefinition(
    id: number,
    force = false,
  ): Promise<{ deleted: boolean; usageCount: number; valuesRemoved: number }> {
    const defs = await this.getAttributeDefinitions();
    const def = defs.find((d) => d.id === id);
    if (!def) return { deleted: false, usageCount: 0, valuesRemoved: 0 };

    const usageRow = await this.db.get<{ c: number }>(SQL.countAttributeUsage, [
      def.key,
    ]);
    const usageCount = usageRow?.c ?? 0;
    if (usageCount > 0 && !force) {
      return { deleted: false, usageCount, valuesRemoved: 0 };
    }

    let valuesRemoved = 0;
    let deleted = false;
    await this.db.transaction(async () => {
      if (usageCount > 0) {
        const result = await this.db.run(SQL.removeAttributeFromItems, {
          key: def.key,
        });
        valuesRemoved = result.changes;
      }
      const result = await this.db.run(SQL.deleteAttributeDefinition, [
        cast(id),
      ]);
      deleted = result.changes > 0;
    });

    return { deleted, usageCount, valuesRemoved };
  }

  /**
   * Rewrites display order from the given id sequence, assigning 1..N.
   *
   * Normalising rather than swapping two values makes the operation idempotent
   * and self-healing: any gaps or duplicate orders left by older data are
   * cleaned up as a side effect of the next move.
   */
  async reorderAttributeDefinitions(orderedIds: number[]): Promise<boolean> {
    if (orderedIds.length === 0) return false;
    const defs = await this.getAttributeDefinitions();
    const known = new Set(defs.map((d) => d.id));
    const ids = orderedIds.filter((id) => known.has(id));
    if (ids.length === 0) return false;

    await this.db.transaction(async () => {
      for (const [index, id] of ids.entries()) {
        // eslint-disable-next-line no-await-in-loop
        await this.db.run(SQL.setAttributeDefinitionOrder, [
          index + 1,
          cast(id),
        ]);
      }
    });
    return true;
  }

  /** Marks an attribute publishable (or not) — see CatalogOptions.publicAttributeKeys. */
  async setAttributeDefinitionPublic(
    id: number,
    isPublic: boolean,
  ): Promise<boolean> {
    const result = await this.db.run(SQL.setAttributeDefinitionPublic, [
      isPublic ? 1 : 0,
      cast(id),
    ]);
    return result.changes > 0;
  }

  /**
   * Holds an item back from the published catalog, or releases it.
   *
   * Separate from price, image and attributes so a business never has to damage
   * its own data — deleting a price to stop something being sold online — to
   * make a publishing decision.
   */
  async setItemExcludedFromCatalog(
    id: number,
    excluded: boolean,
  ): Promise<boolean> {
    const result = await this.db.run(SQL.setItemExcluded, [
      excluded ? 1 : 0,
      cast(id),
    ]);
    return result.changes > 0;
  }

  /** Attribute keys marked public and active — the catalog whitelist. */
  async getPublicAttributeKeys(): Promise<string[]> {
    const rows = await this.db.all<{ key: string }>(SQL.getPublicAttributeKeys);
    return rows.map((r) => r.key);
  }

  async setAttributeDefinitionActive(
    id: number,
    isActive: boolean,
  ): Promise<boolean> {
    const result = await this.db.run(SQL.toggleAttributeDefinition, [
      cast(isActive),
      cast(id),
    ]);
    return result.changes > 0;
  }

  /**
   * Replaces an item's attributes. Keys with an empty value are dropped so the
   * stored JSON stays free of blanks, which keeps the published catalog clean
   * and keeps the "has attributes" publish check meaningful.
   */
  async updateInventoryAttributes(
    inventoryId: number,
    attributes: Record<string, unknown>,
  ): Promise<boolean> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attributes ?? {})) {
      if (value === '' || value === null || value === undefined) continue;
      cleaned[key] = value;
    }
    const json =
      Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
    const result = await this.db.run(SQL.updateInventoryAttributes, [
      json,
      cast(inventoryId),
    ]);
    return result.changes > 0;
  }

  async saveInventory(inventory: InventoryItem[]): Promise<boolean> {
    if (inventory.length === 0) {
      return false;
    }

    let success = true;
    await this.db.transaction(async () => {
      for (const item of inventory) {
        this.assertNameAllowed(item.name);
        // eslint-disable-next-line no-await-in-loop
        const result = await this.db.run(SQL.insertItem, {
          name: item.name,
          description: item.description ?? null,
          descriptionUrdu: item.descriptionUrdu?.trim() || null,
          price: item.price,
          title: item.title?.trim() || null,
          itemTypeId: item.itemTypeId ?? null,
          listPosition: item.listPosition ?? null,
        });
        if (!result.changes) {
          success = false;
          throw new Error(`Failed to insert inventory item: ${item.name}`);
        }
      }
    });

    return success;
  }

  /**
   * Rejects a name using a character this installation has reserved.
   *
   * Enforced in the service rather than only in the form: names also arrive via
   * import and via IPC, and a name that breaks the downstream path mapping
   * fails silently later (a product carrying another product's image), so it is
   * worth refusing at the single point every write goes through.
   */
  private assertNameAllowed(name: string): void {
    const reserved = this.store?.get('publish.reservedNameChars');
    const error = itemNameError(
      name,
      typeof reserved === 'string' ? reserved : '',
    );
    if (error) throw new Error(error);
  }

  async insertItem(item: InsertInventoryItem): Promise<boolean> {
    this.assertNameAllowed(item.name);
    const result = await this.db.run(SQL.insertItem, {
      ...item,
      description: item.description ?? null,
      descriptionUrdu: item.descriptionUrdu?.trim() || null,
      // same rule as updateItem: blank stores NULL, and the key must be present
      // either way or the statement's @title parameter has nothing to bind to
      title: item.title?.trim() || null,
      itemTypeId: item.itemTypeId ?? null,
      listPosition: item.listPosition ?? null,
    });
    return Boolean(result.changes);
  }

  async updateItem(item: UpdateInventoryItem): Promise<boolean> {
    if (item.name) this.assertNameAllowed(item.name);
    const result = await this.db.run(SQL.updateItem, {
      ...item,
      id: cast(item.id),
      description: item.description ?? null,
      descriptionUrdu: item.descriptionUrdu?.trim() || null,
      // blank stores NULL, not '': "no title" must have one representation, or
      // a consumer choosing between a title and a composed one has to test for
      // both and one caller will forget
      title: item.title?.trim() || null,
      itemTypeId: item.itemTypeId ?? null,
      listPosition: item.listPosition ?? null,
    });
    return Boolean(result.changes);
  }

  async getOpeningStock(): Promise<InventoryOpeningStock[]> {
    return this.db.all<InventoryOpeningStock>(SQL.getOpeningStock);
  }

  async setOpeningStock(
    items: SetOpeningStockItem[],
    asOfDate?: string,
    resetOthersToZero = false,
  ): Promise<ApiResponse> {
    try {
      await this.db.transaction(async () => {
        const touchedIds = new Set<number>();

        for (const item of items) {
          const name = item.name?.trim();
          if (!name) {
            raise('Item name is required');
          }
          // eslint-disable-next-line no-await-in-loop
          let inventoryId = await this.resolveInventoryIdByName(name);
          if (inventoryId == null) {
            // eslint-disable-next-line no-await-in-loop
            const result = await this.db.run(SQL.insertItem, {
              name,
              description: null,
              descriptionUrdu: null,
              price: 0,
              title: null,
              itemTypeId: null,
              listPosition: null,
            });
            inventoryId = Number(result.lastInsertRowid);
            if (!inventoryId) {
              raise(`Failed to create inventory item: ${name}`);
            }
          }
          // eslint-disable-next-line no-await-in-loop
          const currentRow = await this.db.get<{ quantity: number }>(
            SQL.getInventoryQuantity,
            [cast(inventoryId)],
          );
          const oldQuantity = get(currentRow, 'quantity', 0);
          // eslint-disable-next-line no-await-in-loop
          await this.db.run(SQL.setInventoryQuantity, [
            item.quantity,
            cast(inventoryId),
          ]);
          // eslint-disable-next-line no-await-in-loop
          await this.db.run(SQL.upsertOpeningStock, {
            inventoryId: cast(inventoryId),
            quantity: item.quantity,
            asOfDate: asOfDate ?? null,
            old_quantity: oldQuantity,
          });
          // eslint-disable-next-line no-await-in-loop
          await this.insertCompensatingResetAdjustment(inventoryId, asOfDate);

          touchedIds.add(inventoryId);
        }

        if (resetOthersToZero) {
          const allInventory = await this.db.all<InventoryItem>(
            SQL.getInventoryStoredForReset,
          );
          for (const row of allInventory) {
            if (touchedIds.has(row.id)) continue;

            const oldQuantity = row.quantity;
            // eslint-disable-next-line no-await-in-loop
            await this.db.run(SQL.setInventoryQuantity, [0, cast(row.id)]);
            // eslint-disable-next-line no-await-in-loop
            await this.db.run(SQL.upsertOpeningStock, {
              inventoryId: cast(row.id),
              quantity: 0,
              asOfDate: asOfDate ?? null,
              old_quantity: oldQuantity,
            });
            // eslint-disable-next-line no-await-in-loop
            await this.insertCompensatingResetAdjustment(row.id, asOfDate);
          }
        }
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /**
   * docs/derived-state-design.md §6 migration 028, D3.
   *
   * setOpeningStock's `setInventoryQuantity` write is an ABSOLUTE overwrite
   * of the stored counter — kept exactly as today (dual-write rule: it is
   * the source of truth for the legacy stored `inventory.quantity` column).
   * But inventory_quantity_view sums FORWARD from `inventory_opening_stock`
   * over every recorded movement unconditionally, so if movements already
   * exist for this item, the view would otherwise double-count them (once
   * baked into the old counter this reset just overwrote, once counted
   * again live from invoice_items/stock_adjustments).
   *
   * Fix: when movements already exist, insert one compensating
   * `stock_adjustments` row that cancels exactly the sum of every existing
   * movement (invoice-driven and adjustment-driven) — sized by
   * `SQL.movementsForItem`, the same CASE logic as
   * `inventory_quantity_view`'s inner subqueries, minus the opening-stock
   * term. That reduces the view's formula to
   * `newOpeningStock + movements + (-movements) = newOpeningStock`, which is
   * exactly the absolute value the user just set — matching what
   * `setInventoryQuantity` already put in the stored column.
   *
   * Crucially this compensating row is inserted WITHOUT calling
   * `updateInventoryQuantity` (the relative stored-counter write) — it only
   * affects `inventory_quantity_view`'s live SUM, never the stored counter,
   * so the stored column stays exactly what `setInventoryQuantity` set it
   * to (the dual-write rule's stored-side invariant is preserved).
   *
   * No-op when no movements exist yet (the common "Getting Started" case,
   * where the view already agreed with the stored counter before this
   * cutover) — inserting a zero-delta row would be harmless but pointless.
   */
  private async insertCompensatingResetAdjustment(
    inventoryId: number,
    asOfDate?: string,
  ): Promise<void> {
    const row = await this.db.get<{ movements: number }>(SQL.movementsForItem, [
      cast(inventoryId),
      cast(inventoryId),
    ]);
    const movements = get(row, 'movements', 0);
    if (!movements) return;
    await this.db.run(SQL.insertStockAdjustment, {
      inventoryId: cast(inventoryId),
      quantityDelta: -movements,
      reason: STOCKTAKE_RESET_REASON,
      date: asOfDate ?? cast(new Date()),
    });
  }

  private async resolveInventoryIdByName(
    name: string | undefined,
  ): Promise<number | null> {
    if (!name?.trim()) return null;
    const row = await this.db.get<{ id: number }>(SQL.getInventoryIdByName, [
      name.trim(),
    ]);
    return get(row, 'id', null);
  }

  async applyStockAdjustment(
    payload: ApplyStockAdjustmentPayload,
  ): Promise<ApiResponse> {
    try {
      const { inventoryId, quantityDelta, reason, date } = payload;
      const row = await this.db.get<{ quantity: number }>(
        SQL.getInventoryQuantity,
        [cast(inventoryId)],
      );
      if (!row) {
        return { success: false, error: 'Inventory item not found' };
      }
      const newQuantity = get(row, 'quantity', 0) + quantityDelta;
      if (newQuantity < 0) {
        return {
          success: false,
          error: 'Resulting quantity cannot be negative',
        };
      }
      const dateStr = date ?? cast(new Date());
      await this.db.transaction(async () => {
        await this.db.run(SQL.insertStockAdjustment, {
          inventoryId: cast(inventoryId),
          quantityDelta,
          reason: reason ?? null,
          date: dateStr,
        });
        await this.db.run(SQL.updateInventoryQuantity, [
          quantityDelta,
          cast(inventoryId),
        ]);
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async getStockAdjustments(inventoryId?: number): Promise<StockAdjustment[]> {
    if (inventoryId != null) {
      return this.db.all<StockAdjustment>(
        SQL.getStockAdjustmentsByInventoryId,
        [cast(inventoryId)],
      );
    }
    return this.db.all<StockAdjustment>(SQL.getStockAdjustments);
  }

  async getInventoryIdsWithHistory(): Promise<number[]> {
    const rows = await this.db.all<{ id: number }>(
      SQL.getInventoryIdsWithHistory,
    );
    return rows.map((r) => r.id);
  }

  /**
   * updates price + listPosition for known inventory ids in one transaction.
   * only dirty patches should be sent from the renderer.
   */
  async bulkUpdatePricesAndListPositions(
    patches: BulkPriceListPositionPatch[],
  ): Promise<BulkPriceListPositionResult> {
    if (patches.length === 0) {
      return { updated: 0 };
    }

    let updated = 0;
    await this.db.transaction(async () => {
      for (const patch of patches) {
        if (!Number.isFinite(patch.id) || patch.id <= 0) {
          raise(`Invalid inventory id: ${patch.id}`);
        }
        if (!Number.isFinite(patch.price) || patch.price < 0) {
          raise(`Invalid price for inventory id ${patch.id}`);
        }
        if (
          patch.listPosition != null &&
          (!Number.isFinite(patch.listPosition) ||
            !Number.isInteger(patch.listPosition) ||
            patch.listPosition < 0)
        ) {
          raise(`Invalid list # for inventory id ${patch.id}`);
        }
        // eslint-disable-next-line no-await-in-loop
        const result = await this.db.run(SQL.updatePriceAndListPositionById, {
          id: cast(patch.id),
          price: patch.price,
          listPosition: patch.listPosition,
        });
        updated += result.changes;

        // named price lists: a null price removes the item from that list
        for (const entry of patch.listPrices ?? []) {
          if (!Number.isFinite(entry.priceListId) || entry.priceListId <= 0) {
            raise(`Invalid price list id for inventory id ${patch.id}`);
          }
          if (
            entry.price != null &&
            (!Number.isFinite(entry.price) || entry.price < 0)
          ) {
            raise(
              `Invalid ${entry.priceListId} list price for inventory id ${patch.id}`,
            );
          }
          if (entry.price == null) {
            // eslint-disable-next-line no-await-in-loop
            await this.db.run(SQL.deleteInventoryPrice, [
              cast(patch.id),
              cast(entry.priceListId),
            ]);
          } else {
            // eslint-disable-next-line no-await-in-loop
            await this.db.run(SQL.upsertInventoryPrice, [
              cast(patch.id),
              cast(entry.priceListId),
              entry.price,
            ]);
          }
        }
      }
    });

    return { updated };
  }

  /**
   * sets listPosition for existing rows matched by TRIM(name); skips ambiguous duplicate names.
   */
  async applyListPositions(
    rows: Array<{ name: string; listPosition: number }>,
  ): Promise<ApplyListPositionsResult> {
    let updated = 0;
    const notFoundNames: string[] = [];
    const ambiguousNames: string[] = [];
    for (const r of rows) {
      const name = r.name?.trim();
      if (!name) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const matches = await this.db.all<{ id: number }>(
        SQL.getInventoryIdsByTrimName,
        [name],
      );
      if (matches.length === 0) {
        notFoundNames.push(name);
      } else if (matches.length > 1) {
        ambiguousNames.push(name);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await this.db.run(SQL.updateInventoryListPositionById, [
          r.listPosition,
          cast(matches[0].id),
        ]);
        updated += 1;
      }
    }
    return {
      updated,
      notFoundNames,
      ambiguousNames,
    };
  }

  /** Inventory Health report: snapshot KPIs + movement data for all inventory items. */
  async getInventoryHealth(
    _filters: { startDate: string; endDate: string; itemTypeIds?: number[] } = {
      startDate: new Date(Date.now() - 30 * 86400000)
        .toISOString()
        .split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
    },
  ): Promise<ReportResponse> {
    const { startDate, endDate, itemTypeIds } = _filters;
    const sqlStartDate =
      startDate.length === 10 ? `${startDate}T00:00:00.000Z` : startDate;
    const sqlEndDate =
      endDate.length === 10 ? `${endDate}T23:59:59.999Z` : endDate;
    const dayCount = Math.max(
      1,
      Math.ceil(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) /
          86400000,
      ),
    );

    // get all inventory items with optional type name, filtered by type if specified
    let allItems: Array<InventoryItem & { itemTypeName?: string | null }>;
    if (itemTypeIds && itemTypeIds.length > 0) {
      allItems = await this.db.all<
        InventoryItem & { itemTypeName?: string | null }
      >(SQL.getAllInventoryByItemTypes, {
        itemTypeIdsJson: JSON.stringify(itemTypeIds),
      });
    } else {
      allItems = await this.db.all<
        InventoryItem & { itemTypeName?: string | null }
      >(SQL.getAllInventory);
    }

    if (allItems.length === 0) {
      return {
        kpis: {
          totalItems: 0,
          inStockItems: 0,
          zeroStockItems: 0,
          negativeStockItems: 0,
          lowCoverageItems: 0,
          deadStockItems: 0,
          noTypeItems: 0,
          zeroPriceItems: 0,
          itemsWithAnyIssue: 0,
        },
        series: [],
        rows: [],
        anomalies: [],
        exportRows: [],
      };
    }

    // aggregate movement data from sale invoices (posted, non-returned)
    const soldInDate: Record<number, { qty: number; lastDate: string }> = {};
    const saleQtyRows = await this.db.all<{
      inventoryId: number;
      totalQty: number;
      lastDate: string;
    }>(SQL.getSaleAggregateHealth, [sqlStartDate, sqlEndDate]);

    for (const row of saleQtyRows) {
      soldInDate[row.inventoryId] = {
        qty: row.totalQty,
        lastDate: row.lastDate,
      };
    }

    const lastSaleInvoiceByInventory: Record<number, number> = {};
    const saleLastInvoiceRows = await this.db.all<{
      inventoryId: number;
      invoiceNumber: number;
    }>(SQL.getSaleLastInvoiceHealth, [sqlStartDate, sqlEndDate]);
    for (const row of saleLastInvoiceRows) {
      lastSaleInvoiceByInventory[row.inventoryId] = row.invoiceNumber;
    }

    // aggregate movement data from purchase invoices (posted, non-returned)
    const purchasedInDate: Record<number, { qty: number; lastDate: string }> =
      {};
    const purchaseQtyRows = await this.db.all<{
      inventoryId: number;
      totalQty: number;
      lastDate: string;
    }>(SQL.getPurchaseAggregateHealth, [sqlStartDate, sqlEndDate]);

    for (const row of purchaseQtyRows) {
      purchasedInDate[row.inventoryId] = {
        qty: row.totalQty,
        lastDate: row.lastDate,
      };
    }

    const lastPurchaseInvoiceByInventory: Record<number, number> = {};
    const purchaseLastInvoiceRows = await this.db.all<{
      inventoryId: number;
      invoiceNumber: number;
    }>(SQL.getPurchaseLastInvoiceHealth, [sqlStartDate, sqlEndDate]);
    for (const row of purchaseLastInvoiceRows) {
      lastPurchaseInvoiceByInventory[row.inventoryId] = row.invoiceNumber;
    }

    // aggregate stock adjustment movement
    const adjustmentInDate: Record<number, { qty: number; lastDate: string }> =
      {};
    const adjQtyRows = await this.db.all<{
      inventoryId: number;
      totalDelta: number;
      lastDate: string;
    }>(SQL.getAdjustmentAggregate, [sqlStartDate, sqlEndDate]);

    for (const row of adjQtyRows) {
      adjustmentInDate[row.inventoryId] = {
        qty: row.totalDelta,
        lastDate: row.lastDate,
      };
    }

    // last movement date per Item across all history (for days since movement + dead stock)
    const lastSaleEverDate: Record<number, string> = {};
    for (const row of await this.db.all<{
      inventoryId: number;
      lastDate: string;
    }>(SQL.getSaleLastDateEver)) {
      lastSaleEverDate[row.inventoryId] = row.lastDate;
    }
    const lastPurchaseEverDate: Record<number, string> = {};
    for (const row of await this.db.all<{
      inventoryId: number;
      lastDate: string;
    }>(SQL.getPurchaseLastDateEver)) {
      lastPurchaseEverDate[row.inventoryId] = row.lastDate;
    }
    const lastAdjEverDate: Record<number, string> = {};
    for (const row of await this.db.all<{
      inventoryId: number;
      lastDate: string;
    }>(SQL.getAdjustmentLastDateEver)) {
      lastAdjEverDate[row.inventoryId] = row.lastDate;
    }

    // build rows + compute flags
    const rows: Array<Record<string, unknown>> = [];
    let deadStockCount = 0;
    let lowCoverageCount = 0;
    let zeroStockCount = 0;
    let negativeStockCount = 0;
    let noTypeItemCount = 0;
    let zeroPriceCount = 0;

    for (const item of allItems) {
      const onHand = get(item, 'quantity', 0);
      const soldQty = soldInDate[item.id]?.qty ?? 0;
      const lastSaleDate = soldInDate[item.id]?.lastDate ?? null;
      const lastSaleInvoiceNumber =
        lastSaleDate != null
          ? lastSaleInvoiceByInventory[item.id] ?? null
          : null;
      const purchasedQty = purchasedInDate[item.id]?.qty ?? 0;
      const lastPurchaseDate = purchasedInDate[item.id]?.lastDate ?? null;
      const lastPurchaseInvoiceNumber =
        lastPurchaseDate != null
          ? lastPurchaseInvoiceByInventory[item.id] ?? null
          : null;
      const adjQty = adjustmentInDate[item.id]?.qty ?? 0;
      const lastAdjDate = adjustmentInDate[item.id]?.lastDate ?? null;

      // last movement ever (not limited to report range): max of sale / purchase / adjustment
      const movementDatesEver = [
        lastSaleEverDate[item.id],
        lastPurchaseEverDate[item.id],
        lastAdjEverDate[item.id],
      ].filter(Boolean) as string[];
      const lastMovementDate =
        movementDatesEver.length > 0 ? movementDatesEver.sort().at(-1)! : null;

      const daysSinceMovement = lastMovementDate
        ? Math.floor(
            (new Date().getTime() - new Date(lastMovementDate).getTime()) /
              86400000,
          )
        : null;

      const dailyVelocity = soldQty > 0 ? soldQty / dayCount : null;
      const daysOfCover =
        dailyVelocity != null && dailyVelocity > 0
          ? onHand / dailyVelocity
          : null;

      // issue flags
      const flags: string[] = [];
      if (onHand === 0) {
        flags.push('zero-stock');
        zeroStockCount++;
      }
      if (onHand < 0) {
        flags.push('negative-stock');
        negativeStockCount++;
      }
      if (daysOfCover != null && daysOfCover < 7) {
        flags.push('critical-coverage');
      } else if (daysOfCover != null && daysOfCover < 14) {
        flags.push('low-coverage');
        lowCoverageCount++;
      }
      if (
        onHand > 0 &&
        (daysSinceMovement == null || daysSinceMovement >= 90)
      ) {
        flags.push('dead-stock');
        deadStockCount++;
      }
      if (!item.itemTypeId && !item.itemTypeName) {
        flags.push('no-type');
        noTypeItemCount++;
      }
      const price = get(item, 'price', 0);
      if (price === 0) {
        flags.push('zero-price');
        zeroPriceCount++;
      }

      rows.push({
        itemId: item.id,
        itemTypeId: item.itemTypeId ?? null,
        item: get(item, 'name', ''),
        itemType: item.itemTypeName ?? null,
        listPosition:
          item.listPosition == null ? null : Number(item.listPosition),
        price,
        onHandQty: onHand,
        soldQtyInDate: soldQty,
        purchasedQtyInDate: purchasedQty,
        adjustmentQtyInDate: adjQty,
        lastSaleDate,
        lastSaleInvoiceNumber,
        lastPurchaseDate,
        lastPurchaseInvoiceNumber,
        lastAdjustmentDate: lastAdjDate,
        lastMovementDate,
        daysSinceMovement,
        daysOfCover:
          daysOfCover != null ? Math.round(daysOfCover * 10) / 10 : null,
        flags: flags.join(', '),
      });
    }

    const inStockCount = allItems.filter(
      (i) => get(i, 'quantity', 0) > 0,
    ).length;

    // one anomaly per row-level flag (same tokens as Issues column); counts can overlap across chips
    const rowHasIssueFlag = (flagsStr: unknown, flag: string): boolean => {
      const tokens = String(flagsStr ?? '')
        .split(', ')
        .map((t) => t.trim())
        .filter(Boolean);
      return tokens.includes(flag);
    };
    const rowsForFlag = (flag: string) =>
      rows.filter((r) =>
        rowHasIssueFlag((r as { flags?: string }).flags, flag),
      );

    const anomalies = (
      [
        ['zero-stock', 'Out of stock'],
        ['negative-stock', 'Negative stock'],
        ['critical-coverage', 'Critical coverage (< 7 days)'],
        [
          'low-coverage',
          'Low coverage (7–14 days at period sales rate; excludes critical)',
        ],
        [
          'dead-stock',
          'Dead stock (on hand, no movement ever or last movement ≥ 90 days ago)',
        ],
        ['no-type', 'No item type assigned'],
        ['zero-price', 'Zero price'],
      ] as const
    ).map(([type, message]) => {
      const matched = rowsForFlag(type);
      return { type, message, count: matched.length, rows: matched };
    });

    const itemsWithAnyIssue = rows.filter(
      (r) => String((r as { flags?: string }).flags ?? '').trim().length > 0,
    ).length;

    return {
      kpis: {
        totalItems: allItems.length,
        inStockItems: inStockCount,
        zeroStockItems: zeroStockCount,
        negativeStockItems: negativeStockCount,
        lowCoverageItems: lowCoverageCount,
        deadStockItems: deadStockCount,
        noTypeItems: noTypeItemCount,
        zeroPriceItems: zeroPriceCount,
        itemsWithAnyIssue,
      },
      series: [],
      rows,
      anomalies,
      exportRows: rows,
    };
  }

  /**
   * On-hand at end of asOfDate (day end), rewound from current inventory.quantity.
   * delta = posted purchases − sales + adjustments with timestamp strictly after as-of end;
   * quantityAsOf = currentQuantity − delta. Trusts live quantity as anchor (matches invoice-driven stock).
   * Quotations excluded; returned invoices apply sale/purchase reversal when returnedAt is after as-of end.
   */
  async getStockAsOf(
    filters: { asOfDate: string; itemTypeIds?: number[] } = {
      asOfDate: new Date().toISOString().split('T')[0],
    },
  ): Promise<StockAsOfReportResponse> {
    const { asOfDate, itemTypeIds } = filters;
    const sqlAsOfEnd =
      asOfDate.length === 10 ? `${asOfDate}T23:59:59.999Z` : asOfDate;

    let allItems: Array<InventoryItem & { itemTypeName?: string | null }>;
    if (itemTypeIds && itemTypeIds.length > 0) {
      allItems = await this.db.all<
        InventoryItem & { itemTypeName?: string | null }
      >(SQL.getAllInventoryByItemTypes, {
        itemTypeIdsJson: JSON.stringify(itemTypeIds),
      });
    } else {
      allItems = await this.db.all<
        InventoryItem & { itemTypeName?: string | null }
      >(SQL.getAllInventory);
    }

    const invoiceDeltaRows = await this.db.all<{
      inventoryId: number;
      deltaQty: number;
    }>(SQL.stockAsOfInvoiceDeltaAfter, [
      sqlAsOfEnd,
      sqlAsOfEnd,
      sqlAsOfEnd,
      sqlAsOfEnd,
      sqlAsOfEnd,
      sqlAsOfEnd,
    ]);
    const adjDeltaRows = await this.db.all<{
      inventoryId: number;
      deltaQty: number;
    }>(SQL.stockAsOfAdjustmentDeltaAfter, [sqlAsOfEnd]);

    const invoiceDelta = new Map<number, number>();
    for (const r of invoiceDeltaRows) {
      invoiceDelta.set(r.inventoryId, Number(r.deltaQty));
    }
    const adjDelta = new Map<number, number>();
    for (const r of adjDeltaRows) {
      adjDelta.set(r.inventoryId, Number(r.deltaQty));
    }

    const rows: StockAsOfRow[] = [];

    for (const item of allItems) {
      const { id } = item;

      const currentQty = get(item, 'quantity', 0);
      const deltaAfter = (invoiceDelta.get(id) ?? 0) + (adjDelta.get(id) ?? 0);
      const qtyAsOf = currentQty - deltaAfter;

      rows.push({
        itemId: id,
        itemTypeId: item.itemTypeId ?? null,
        item: get(item, 'name', ''),
        itemType: item.itemTypeName ?? null,
        listPosition:
          item.listPosition == null ? null : Number(item.listPosition),
        quantityAsOf: qtyAsOf,
        currentQuantity: currentQty,
        unitPrice: get(item, 'price', 0),
      });
    }

    return {
      asOfDateEnd: sqlAsOfEnd,
      rows,
    };
  }
}
