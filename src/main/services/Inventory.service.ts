import type { Database, Statement } from 'better-sqlite3';
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
import { logErrors } from '../errorLogger';
import { DatabaseService } from './Database.service';
import { itemNameError } from '../utils/itemName';
import { getPublishConfig } from '../utils/publishConfig';
import { cast } from '../utils/sqlite';
import { parseJsonRecord, parseListPrices } from '../utils/inventoryJson';
import { raise } from '../utils/general';

@logErrors
export class InventoryService {
  private db: Database;

  private stmInventoryExists!: Statement;

  private stmGetInventory!: Statement;

  private stmInsertItem!: Statement;

  private stmUpdateItem!: Statement;

  private stmGetOpeningStock!: Statement;

  private stmUpsertOpeningStock!: Statement;

  private stmUpdateInventoryQuantity!: Statement;

  private stmSetInventoryQuantity!: Statement;

  private stmInsertStockAdjustment!: Statement;

  private stmGetStockAdjustments!: Statement;

  private stmGetStockAdjustmentsByInventoryId!: Statement;

  private stmGetInventoryIdByName!: Statement;

  private stmGetInventoryQuantity!: Statement;

  private stmGetInventoryIdsWithHistory!: Statement;

  private stmGetAllInventory!: Statement;

  private stmGetAllInventoryByItemTypes!: Statement;

  private stmGetSaleAggregateHealth!: Statement;

  private stmGetPurchaseAggregateHealth!: Statement;

  private stmGetSaleLastInvoiceHealth!: Statement;

  private stmGetPurchaseLastInvoiceHealth!: Statement;

  private stmGetAdjustmentAggregate!: Statement;

  /** last sale invoice date per Item (all time; same filters as health aggregates) */
  private stmGetSaleLastDateEver!: Statement;

  /** last purchase invoice date per Item (all time) */
  private stmGetPurchaseLastDateEver!: Statement;

  /** last stock adjustment date per Item (all time) */
  private stmGetAdjustmentLastDateEver!: Statement;

  /** posted invoice lines: net inventory change strictly after as-of end (sales −, purchases +, returns) */
  private stmStockAsOfInvoiceDeltaAfter!: Statement;

  /** stock adjustments strictly after as-of end */
  private stmStockAsOfAdjustmentDeltaAfter!: Statement;

  private stmGetInventoryIdsByTrimName!: Statement;

  private stmUpdateInventoryListPositionById!: Statement;

  private stmUpdatePriceAndListPositionById!: Statement;

  private stmUpsertInventoryPrice!: Statement;

  private stmGetAttributeDefinitions!: Statement;

  private stmInsertAttributeDefinition!: Statement;

  private stmUpdateAttributeDefinition!: Statement;

  private stmToggleAttributeDefinition!: Statement;

  private stmSetAttributeDefinitionPublic!: Statement;

  private stmSetItemExcluded!: Statement;

  private stmGetPublicAttributeKeys!: Statement;

  private stmSetAttributeDefinitionOrder!: Statement;

  private stmUpdateInventoryAttributes!: Statement;

  private stmDeleteAttributeDefinition!: Statement;

  private stmCountAttributeUsage!: Statement;

  private stmRemoveAttributeFromItems!: Statement;

  private stmDeleteInventoryPrice!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.initPreparedStatements();
  }

  doesInventoryExist(): boolean {
    const result = <number | undefined>this.stmInventoryExists.get();
    return get(result, 'count', 0) > 0;
  }

  getInventory(): InventoryItem[] {
    const results = this.stmGetInventory.all() as Array<
      Omit<InventoryItem, 'attributes' | 'listPrices'> & {
        attributes?: string | null;
        listPricesJson?: string | null;
      }
    >;
    return results.map(({ attributes, listPricesJson, ...item }) => ({
      ...item,
      attributes: parseJsonRecord(attributes),
      listPrices: parseListPrices(listPricesJson),
    }));
  }

  /** All custom attribute definitions, in display order. */
  getAttributeDefinitions(): AttributeDefinition[] {
    return this.stmGetAttributeDefinitions.all() as AttributeDefinition[];
  }

  /** Creates a definition (no-op when the key exists) or updates one by id. */
  upsertAttributeDefinition(input: UpsertAttributeDefinition): boolean {
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
      return (
        this.stmUpdateAttributeDefinition.run({
          ...params,
          sortOrder: input.sortOrder ?? 0,
          id: cast(input.id),
        }).changes > 0
      );
    }
    return this.stmInsertAttributeDefinition.run(params).changes > 0;
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
  deleteAttributeDefinition(
    id: number,
    force = false,
  ): { deleted: boolean; usageCount: number; valuesRemoved: number } {
    const def = this.getAttributeDefinitions().find((d) => d.id === id);
    if (!def) return { deleted: false, usageCount: 0, valuesRemoved: 0 };

    const { c: usageCount } = this.stmCountAttributeUsage.get(def.key) as {
      c: number;
    };
    if (usageCount > 0 && !force) {
      return { deleted: false, usageCount, valuesRemoved: 0 };
    }

    let valuesRemoved = 0;
    let deleted = false;
    this.db.transaction(() => {
      if (usageCount > 0) {
        valuesRemoved = this.stmRemoveAttributeFromItems.run({
          key: def.key,
        }).changes;
      }
      deleted = this.stmDeleteAttributeDefinition.run(cast(id)).changes > 0;
    })();

    return { deleted, usageCount, valuesRemoved };
  }

  /**
   * Rewrites display order from the given id sequence, assigning 1..N.
   *
   * Normalising rather than swapping two values makes the operation idempotent
   * and self-healing: any gaps or duplicate orders left by older data are
   * cleaned up as a side effect of the next move.
   */
  reorderAttributeDefinitions(orderedIds: number[]): boolean {
    if (orderedIds.length === 0) return false;
    const known = new Set(this.getAttributeDefinitions().map((d) => d.id));
    const ids = orderedIds.filter((id) => known.has(id));
    if (ids.length === 0) return false;

    this.db.transaction(() => {
      ids.forEach((id, index) => {
        this.stmSetAttributeDefinitionOrder.run(index + 1, cast(id));
      });
    })();
    return true;
  }

  /** Marks an attribute publishable (or not) — see CatalogOptions.publicAttributeKeys. */
  @logErrors
  setAttributeDefinitionPublic(id: number, isPublic: boolean): boolean {
    return (
      this.stmSetAttributeDefinitionPublic.run(isPublic ? 1 : 0, cast(id))
        .changes > 0
    );
  }

  /**
   * Holds an item back from the published catalog, or releases it.
   *
   * Separate from price, image and attributes so a business never has to damage
   * its own data — deleting a price to stop something being sold online — to
   * make a publishing decision.
   */
  @logErrors
  setItemExcludedFromCatalog(id: number, excluded: boolean): boolean {
    return this.stmSetItemExcluded.run(excluded ? 1 : 0, cast(id)).changes > 0;
  }

  /** Attribute keys marked public and active — the catalog whitelist. */
  @logErrors
  getPublicAttributeKeys(): string[] {
    return (this.stmGetPublicAttributeKeys.all() as { key: string }[]).map(
      (r) => r.key,
    );
  }

  @logErrors
  setAttributeDefinitionActive(id: number, isActive: boolean): boolean {
    return (
      this.stmToggleAttributeDefinition.run(cast(isActive), cast(id)).changes >
      0
    );
  }

  /**
   * Replaces an item's attributes. Keys with an empty value are dropped so the
   * stored JSON stays free of blanks, which keeps the published catalog clean
   * and keeps the "has attributes" publish check meaningful.
   */
  updateInventoryAttributes(
    inventoryId: number,
    attributes: Record<string, unknown>,
  ): boolean {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attributes ?? {})) {
      if (value === '' || value === null || value === undefined) continue;
      cleaned[key] = value;
    }
    const json =
      Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
    return (
      this.stmUpdateInventoryAttributes.run(json, cast(inventoryId)).changes > 0
    );
  }

  saveInventory(inventory: InventoryItem[]): boolean {
    if (inventory.length === 0) {
      return false;
    }

    let success = true;
    this.db.transaction(() => {
      for (const item of inventory) {
        InventoryService.assertNameAllowed(item.name);
        const result = this.stmInsertItem.run({
          name: item.name,
          description: item.description ?? null,
          price: item.price,
          itemTypeId: item.itemTypeId ?? null,
          listPosition: item.listPosition ?? null,
        });
        if (!result.changes) {
          success = false;
          throw new Error(`Failed to insert inventory item: ${item.name}`);
        }
      }
    })();

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
  private static assertNameAllowed(name: string): void {
    const error = itemNameError(name, getPublishConfig().reservedNameChars);
    if (error) throw new Error(error);
  }

  insertItem(item: InsertInventoryItem): boolean {
    InventoryService.assertNameAllowed(item.name);
    const result = this.stmInsertItem.run({
      ...item,
      description: item.description ?? null,
      // same rule as updateItem: blank stores NULL, and the key must be present
      // either way or the statement's @title parameter has nothing to bind to
      title: item.title?.trim() || null,
      itemTypeId: item.itemTypeId ?? null,
      listPosition: item.listPosition ?? null,
    });
    return Boolean(result.changes);
  }

  updateItem(item: UpdateInventoryItem): boolean {
    if (item.name) InventoryService.assertNameAllowed(item.name);
    const result = this.stmUpdateItem.run({
      ...item,
      id: cast(item.id),
      description: item.description ?? null,
      // blank stores NULL, not '': "no title" must have one representation, or
      // a consumer choosing between a title and a composed one has to test for
      // both and one caller will forget
      title: item.title?.trim() || null,
      itemTypeId: item.itemTypeId ?? null,
      listPosition: item.listPosition ?? null,
    });
    return Boolean(result.changes);
  }

  getOpeningStock(): InventoryOpeningStock[] {
    return this.stmGetOpeningStock.all() as InventoryOpeningStock[];
  }

  setOpeningStock(
    items: SetOpeningStockItem[],
    asOfDate?: string,
    resetOthersToZero = false,
  ): ApiResponse {
    try {
      this.db.transaction(() => {
        const touchedIds = new Set<number>();

        for (const item of items) {
          const name = item.name?.trim();
          if (!name) {
            raise('Item name is required');
          }
          let inventoryId = this.resolveInventoryIdByName(name);
          if (inventoryId == null) {
            const result = this.stmInsertItem.run({
              name,
              description: null,
              price: 0,
              itemTypeId: null,
              listPosition: null,
            });
            inventoryId = Number(result.lastInsertRowid);
            if (!inventoryId) {
              raise(`Failed to create inventory item: ${name}`);
            }
          }
          const currentRow = this.stmGetInventoryQuantity.get(
            cast(inventoryId),
          );
          const oldQuantity = get(currentRow, 'quantity', 0);
          this.stmSetInventoryQuantity.run(item.quantity, cast(inventoryId));
          this.stmUpsertOpeningStock.run({
            inventoryId: cast(inventoryId),
            quantity: item.quantity,
            asOfDate: asOfDate ?? null,
            old_quantity: oldQuantity,
          });

          touchedIds.add(inventoryId);
        }

        if (resetOthersToZero) {
          const allInventory = this.stmGetInventory.all() as InventoryItem[];
          for (const row of allInventory) {
            if (touchedIds.has(row.id)) continue;

            const oldQuantity = row.quantity;
            this.stmSetInventoryQuantity.run(0, cast(row.id));
            this.stmUpsertOpeningStock.run({
              inventoryId: cast(row.id),
              quantity: 0,
              asOfDate: asOfDate ?? null,
              old_quantity: oldQuantity,
            });
          }
        }
      })();
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  private resolveInventoryIdByName(name: string | undefined): number | null {
    if (!name?.trim()) return null;
    const row = this.stmGetInventoryIdByName.get(name.trim());
    return get(row, 'id', null);
  }

  applyStockAdjustment(payload: ApplyStockAdjustmentPayload): ApiResponse {
    try {
      const { inventoryId, quantityDelta, reason, date } = payload;
      const row = this.stmGetInventoryQuantity.get(cast(inventoryId));
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
      this.db.transaction(() => {
        this.stmInsertStockAdjustment.run({
          inventoryId: cast(inventoryId),
          quantityDelta,
          reason: reason ?? null,
          date: dateStr,
        });
        this.stmUpdateInventoryQuantity.run(quantityDelta, cast(inventoryId));
      })();
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  getStockAdjustments(inventoryId?: number): StockAdjustment[] {
    if (inventoryId != null) {
      return this.stmGetStockAdjustmentsByInventoryId.all(
        cast(inventoryId),
      ) as StockAdjustment[];
    }
    return this.stmGetStockAdjustments.all() as StockAdjustment[];
  }

  getInventoryIdsWithHistory(): number[] {
    const rows = <{ id: number }[]>this.stmGetInventoryIdsWithHistory.all();
    return rows.map((r) => r.id);
  }

  /**
   * updates price + listPosition for known inventory ids in one transaction.
   * only dirty patches should be sent from the renderer.
   */
  bulkUpdatePricesAndListPositions(
    patches: BulkPriceListPositionPatch[],
  ): BulkPriceListPositionResult {
    if (patches.length === 0) {
      return { updated: 0 };
    }

    let updated = 0;
    this.db.transaction(() => {
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
        const result = this.stmUpdatePriceAndListPositionById.run({
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
            this.stmDeleteInventoryPrice.run(
              cast(patch.id),
              cast(entry.priceListId),
            );
          } else {
            this.stmUpsertInventoryPrice.run(
              cast(patch.id),
              cast(entry.priceListId),
              entry.price,
            );
          }
        }
      }
    })();

    return { updated };
  }

  /**
   * sets listPosition for existing rows matched by TRIM(name); skips ambiguous duplicate names.
   */
  applyListPositions(
    rows: Array<{ name: string; listPosition: number }>,
  ): ApplyListPositionsResult {
    let updated = 0;
    const notFoundNames: string[] = [];
    const ambiguousNames: string[] = [];
    for (const r of rows) {
      const name = r.name?.trim();
      if (!name) {
        continue;
      }
      const matches = this.stmGetInventoryIdsByTrimName.all(name) as Array<{
        id: number;
      }>;
      if (matches.length === 0) {
        notFoundNames.push(name);
      } else if (matches.length > 1) {
        ambiguousNames.push(name);
      } else {
        this.stmUpdateInventoryListPositionById.run(
          r.listPosition,
          cast(matches[0].id),
        );
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
  getInventoryHealth(
    _filters: { startDate: string; endDate: string; itemTypeIds?: number[] } = {
      startDate: new Date(Date.now() - 30 * 86400000)
        .toISOString()
        .split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
    },
  ): ReportResponse {
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
      allItems = this.stmGetAllInventoryByItemTypes.all({
        itemTypeIdsJson: JSON.stringify(itemTypeIds),
      }) as Array<InventoryItem & { itemTypeName?: string | null }>;
    } else {
      allItems = this.stmGetAllInventory.all() as Array<
        InventoryItem & { itemTypeName?: string | null }
      >;
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
    const saleQtyRows = this.stmGetSaleAggregateHealth.all(
      sqlStartDate,
      sqlEndDate,
    ) as Array<{
      inventoryId: number;
      totalQty: number;
      lastDate: string;
    }>;

    for (const row of saleQtyRows) {
      soldInDate[row.inventoryId] = {
        qty: row.totalQty,
        lastDate: row.lastDate,
      };
    }

    const lastSaleInvoiceByInventory: Record<number, number> = {};
    const saleLastInvoiceRows = this.stmGetSaleLastInvoiceHealth.all(
      sqlStartDate,
      sqlEndDate,
    ) as Array<{ inventoryId: number; invoiceNumber: number }>;
    for (const row of saleLastInvoiceRows) {
      lastSaleInvoiceByInventory[row.inventoryId] = row.invoiceNumber;
    }

    // aggregate movement data from purchase invoices (posted, non-returned)
    const purchasedInDate: Record<number, { qty: number; lastDate: string }> =
      {};
    const purchaseQtyRows = this.stmGetPurchaseAggregateHealth.all(
      sqlStartDate,
      sqlEndDate,
    ) as Array<{
      inventoryId: number;
      totalQty: number;
      lastDate: string;
    }>;

    for (const row of purchaseQtyRows) {
      purchasedInDate[row.inventoryId] = {
        qty: row.totalQty,
        lastDate: row.lastDate,
      };
    }

    const lastPurchaseInvoiceByInventory: Record<number, number> = {};
    const purchaseLastInvoiceRows = this.stmGetPurchaseLastInvoiceHealth.all(
      sqlStartDate,
      sqlEndDate,
    ) as Array<{ inventoryId: number; invoiceNumber: number }>;
    for (const row of purchaseLastInvoiceRows) {
      lastPurchaseInvoiceByInventory[row.inventoryId] = row.invoiceNumber;
    }

    // aggregate stock adjustment movement
    const adjustmentInDate: Record<number, { qty: number; lastDate: string }> =
      {};
    const adjQtyRows = this.stmGetAdjustmentAggregate.all(
      sqlStartDate,
      sqlEndDate,
    ) as Array<{
      inventoryId: number;
      totalDelta: number;
      lastDate: string;
    }>;

    for (const row of adjQtyRows) {
      adjustmentInDate[row.inventoryId] = {
        qty: row.totalDelta,
        lastDate: row.lastDate,
      };
    }

    // last movement date per Item across all history (for days since movement + dead stock)
    const lastSaleEverDate: Record<number, string> = {};
    for (const row of this.stmGetSaleLastDateEver.all() as Array<{
      inventoryId: number;
      lastDate: string;
    }>) {
      lastSaleEverDate[row.inventoryId] = row.lastDate;
    }
    const lastPurchaseEverDate: Record<number, string> = {};
    for (const row of this.stmGetPurchaseLastDateEver.all() as Array<{
      inventoryId: number;
      lastDate: string;
    }>) {
      lastPurchaseEverDate[row.inventoryId] = row.lastDate;
    }
    const lastAdjEverDate: Record<number, string> = {};
    for (const row of this.stmGetAdjustmentLastDateEver.all() as Array<{
      inventoryId: number;
      lastDate: string;
    }>) {
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
  getStockAsOf(
    filters: { asOfDate: string; itemTypeIds?: number[] } = {
      asOfDate: new Date().toISOString().split('T')[0],
    },
  ): StockAsOfReportResponse {
    const { asOfDate, itemTypeIds } = filters;
    const sqlAsOfEnd =
      asOfDate.length === 10 ? `${asOfDate}T23:59:59.999Z` : asOfDate;

    let allItems: Array<InventoryItem & { itemTypeName?: string | null }>;
    if (itemTypeIds && itemTypeIds.length > 0) {
      allItems = this.stmGetAllInventoryByItemTypes.all({
        itemTypeIdsJson: JSON.stringify(itemTypeIds),
      }) as Array<InventoryItem & { itemTypeName?: string | null }>;
    } else {
      allItems = this.stmGetAllInventory.all() as Array<
        InventoryItem & { itemTypeName?: string | null }
      >;
    }

    const invoiceDeltaRows = this.stmStockAsOfInvoiceDeltaAfter.all(
      sqlAsOfEnd,
      sqlAsOfEnd,
      sqlAsOfEnd,
      sqlAsOfEnd,
      sqlAsOfEnd,
      sqlAsOfEnd,
    ) as Array<{ inventoryId: number; deltaQty: number }>;
    const adjDeltaRows = this.stmStockAsOfAdjustmentDeltaAfter.all(
      sqlAsOfEnd,
    ) as Array<{ inventoryId: number; deltaQty: number }>;

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

  private initPreparedStatements() {
    this.stmInventoryExists = this.db.prepare(`
      SELECT COUNT(*) AS 'count' from inventory;
    `);

    // listPricesJson: { priceListId: price } for every list this item is priced
    // on; parsed in getInventory so the renderer gets a plain object
    this.stmGetInventory = this.db.prepare(`
      SELECT i.*, it.name AS itemTypeName,
             (
               SELECT json_group_object(ip.priceListId, ip.price)
               FROM inventory_prices ip
               WHERE ip.inventoryId = i.id
             ) AS listPricesJson
      FROM inventory i
      LEFT JOIN item_types it ON it.id = i.itemTypeId
      ORDER BY (i.listPosition IS NULL), i.listPosition ASC, i.id ASC;
    `);

    this.stmInsertItem = this.db.prepare(`
      INSERT INTO inventory (name, description, price, title, itemTypeId, listPosition)
      VALUES (@name, @description, @price, @title, @itemTypeId, @listPosition);
    `);

    this.stmUpdateItem = this.db.prepare(`
      UPDATE inventory
      SET price = @price,
          description = @description,
          title = @title,
          itemTypeId = @itemTypeId,
          listPosition = @listPosition
      WHERE id = @id;
    `);

    this.stmGetOpeningStock = this.db.prepare(`
      SELECT * FROM inventory_opening_stock ORDER BY inventoryId
    `);

    this.stmUpsertOpeningStock = this.db.prepare(`
      INSERT INTO inventory_opening_stock (inventoryId, quantity, asOfDate, old_quantity)
      VALUES (@inventoryId, @quantity, @asOfDate, @old_quantity)
      ON CONFLICT(inventoryId) DO UPDATE SET
        quantity = excluded.quantity,
        asOfDate = excluded.asOfDate,
        old_quantity = excluded.old_quantity
    `);

    this.stmUpdateInventoryQuantity = this.db.prepare(`
      UPDATE inventory SET quantity = quantity + ? WHERE id = ?
    `);

    this.stmSetInventoryQuantity = this.db.prepare(`
      UPDATE inventory SET quantity = ? WHERE id = ?
    `);

    this.stmInsertStockAdjustment = this.db.prepare(`
      INSERT INTO stock_adjustments (inventoryId, quantityDelta, reason, date)
      VALUES (@inventoryId, @quantityDelta, @reason, @date)
    `);

    this.stmGetStockAdjustments = this.db.prepare(`
      SELECT * FROM stock_adjustments ORDER BY date DESC, id DESC
    `);

    this.stmGetStockAdjustmentsByInventoryId = this.db.prepare(`
      SELECT * FROM stock_adjustments WHERE inventoryId = ? ORDER BY date DESC, id DESC
    `);

    this.stmGetInventoryQuantity = this.db.prepare(`
      SELECT quantity FROM inventory WHERE id = ?
    `);

    this.stmGetInventoryIdByName = this.db.prepare(`
      SELECT id FROM inventory WHERE TRIM(name) = ? LIMIT 1
    `);

    this.stmGetInventoryIdsWithHistory = this.db.prepare(`
      SELECT DISTINCT inventoryId AS id
      FROM (
        SELECT inventoryId FROM inventory_opening_stock
        UNION ALL
        SELECT inventoryId FROM stock_adjustments
      );
    `);

    // Get all inventory items (unfiltered)
    this.stmGetAllInventory = this.db.prepare(`
      SELECT i.*, it.name AS itemTypeName
      FROM inventory i
      LEFT JOIN item_types it ON it.id = i.itemTypeId
      ORDER BY (i.listPosition IS NULL), i.listPosition ASC, i.id ASC
    `);

    // Get all inventory items filtered by item type IDs using JSON1
    this.stmGetAllInventoryByItemTypes = this.db.prepare(`
      SELECT i.*, it.name AS itemTypeName
      FROM inventory i
      LEFT JOIN item_types it ON it.id = i.itemTypeId
      WHERE i.itemTypeId IN (SELECT value FROM json_each(@itemTypeIdsJson))
      ORDER BY (i.listPosition IS NULL), i.listPosition ASC, i.id ASC
    `);

    this.stmUpsertInventoryPrice = this.db.prepare(`
      INSERT INTO inventory_prices (inventoryId, priceListId, price)
      VALUES (?, ?, ?)
      ON CONFLICT(inventoryId, priceListId) DO UPDATE SET price = excluded.price
    `);

    this.stmDeleteInventoryPrice = this.db.prepare(`
      DELETE FROM inventory_prices WHERE inventoryId = ? AND priceListId = ?
    `);

    // usageCount tells the UI whether a definition is safe to delete, and how
    // much data a change would affect
    this.stmGetAttributeDefinitions = this.db.prepare(`
      SELECT ad.id, ad.key, ad.label, ad.unit, ad.valueType, ad.sortOrder,
             ad.isActive, ad.isPublic,
             (SELECT COUNT(*) FROM inventory i
               WHERE i.attributes IS NOT NULL
                 AND json_extract(i.attributes, '$.' || ad.key) IS NOT NULL
             ) AS usageCount
      FROM attribute_definitions ad
      ORDER BY ad.sortOrder ASC, ad.label ASC
    `);

    this.stmDeleteAttributeDefinition = this.db.prepare(`
      DELETE FROM attribute_definitions WHERE id = ?
    `);

    this.stmCountAttributeUsage = this.db.prepare(`
      SELECT COUNT(*) AS c FROM inventory
      WHERE attributes IS NOT NULL
        AND json_extract(attributes, '$.' || ?) IS NOT NULL
    `);

    // strips one key from every item's attributes; an item left with no
    // attributes stores NULL so the "has attributes" publish check stays true
    // to its meaning
    this.stmRemoveAttributeFromItems = this.db.prepare(`
      UPDATE inventory
         SET attributes = CASE
               WHEN json_remove(attributes, '$.' || @key) = '{}' THEN NULL
               ELSE json_remove(attributes, '$.' || @key)
             END
       WHERE attributes IS NOT NULL
         AND json_extract(attributes, '$.' || @key) IS NOT NULL
    `);

    // a NULL sortOrder means "append": the next value is derived from the
    // current MAX, so deleting a definition can never make a later insert
    // collide with an existing order (counting rows would)
    this.stmInsertAttributeDefinition = this.db.prepare(`
      INSERT OR IGNORE INTO attribute_definitions
        (key, label, unit, valueType, isPublic, sortOrder)
      VALUES (
        @key, @label, @unit, @valueType, @isPublic,
        COALESCE(
          @sortOrder,
          (SELECT COALESCE(MAX(sortOrder), 0) + 1 FROM attribute_definitions)
        )
      )
    `);

    this.stmUpdateAttributeDefinition = this.db.prepare(`
      UPDATE attribute_definitions
      SET label = @label, unit = @unit, valueType = @valueType,
          isPublic = @isPublic, sortOrder = @sortOrder
      WHERE id = @id
    `);

    this.stmToggleAttributeDefinition = this.db.prepare(`
      UPDATE attribute_definitions SET isActive = ? WHERE id = ?
    `);

    this.stmSetAttributeDefinitionPublic = this.db.prepare(`
      UPDATE attribute_definitions SET isPublic = ? WHERE id = ?
    `);

    this.stmSetItemExcluded = this.db.prepare(`
      UPDATE inventory SET excludeFromCatalog = ? WHERE id = ?
    `);

    // the whitelist the catalog builder narrows public attributes to
    this.stmGetPublicAttributeKeys = this.db.prepare(`
      SELECT key FROM attribute_definitions
       WHERE isPublic = 1 AND isActive = 1
       ORDER BY sortOrder ASC, label ASC
    `);

    this.stmSetAttributeDefinitionOrder = this.db.prepare(`
      UPDATE attribute_definitions SET sortOrder = ? WHERE id = ?
    `);

    this.stmUpdateInventoryAttributes = this.db.prepare(`
      UPDATE inventory SET attributes = ? WHERE id = ?
    `);

    this.stmGetInventoryIdsByTrimName = this.db.prepare(`
      SELECT id FROM inventory WHERE TRIM(name) = TRIM(?)
    `);

    this.stmUpdateInventoryListPositionById = this.db.prepare(`
      UPDATE inventory SET listPosition = ? WHERE id = ?
    `);

    this.stmUpdatePriceAndListPositionById = this.db.prepare(`
      UPDATE inventory
      SET price = @price, listPosition = @listPosition
      WHERE id = @id
    `);

    // Sale quantity aggregate WITH lastDate (for inventory health)
    this.stmGetSaleAggregateHealth = this.db.prepare(`
      SELECT ii.inventoryId, SUM(ii.quantity) AS totalQty, MAX(i.date) AS lastDate
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE i.invoiceType = 'Sale'
        AND i.isQuotation = 0
        AND i.isReturned = 0
        AND i.date >= ?
        AND i.date <= ?
      GROUP BY ii.inventoryId
    `);

    // Purchase quantity aggregate WITH lastDate (for inventory health)
    this.stmGetPurchaseAggregateHealth = this.db.prepare(`
      SELECT ii.inventoryId, SUM(ii.quantity) AS totalQty, MAX(i.date) AS lastDate
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE i.invoiceType = 'Purchase'
        AND i.isQuotation = 0
        AND i.isReturned = 0
        AND i.date >= ?
        AND i.date <= ?
      GROUP BY ii.inventoryId
    `);

    // invoice # for the latest sale line per inventory in range (tie-break: higher invoice id)
    this.stmGetSaleLastInvoiceHealth = this.db.prepare(`
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
    `);

    // invoice # for the latest purchase line per inventory in range
    this.stmGetPurchaseLastInvoiceHealth = this.db.prepare(`
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
    `);

    // Stock adjustment aggregate
    this.stmGetAdjustmentAggregate = this.db.prepare(`
      SELECT inventoryId, SUM(quantityDelta) AS totalDelta, MAX(date) AS lastDate
      FROM stock_adjustments
      WHERE date >= ? AND date <= ?
      GROUP BY inventoryId
    `);

    this.stmGetSaleLastDateEver = this.db.prepare(`
      SELECT ii.inventoryId, MAX(i.date) AS lastDate
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE i.invoiceType = 'Sale'
        AND i.isQuotation = 0
        AND i.isReturned = 0
      GROUP BY ii.inventoryId
    `);

    this.stmGetPurchaseLastDateEver = this.db.prepare(`
      SELECT ii.inventoryId, MAX(i.date) AS lastDate
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE i.invoiceType = 'Purchase'
        AND i.isQuotation = 0
        AND i.isReturned = 0
      GROUP BY ii.inventoryId
    `);

    this.stmGetAdjustmentLastDateEver = this.db.prepare(`
      SELECT inventoryId, MAX(date) AS lastDate
      FROM stock_adjustments
      GROUP BY inventoryId
    `);

    this.stmStockAsOfInvoiceDeltaAfter = this.db.prepare(`
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
    `);

    this.stmStockAsOfAdjustmentDeltaAfter = this.db.prepare(`
      SELECT inventoryId,
        COALESCE(SUM(quantityDelta), 0) AS deltaQty
      FROM stock_adjustments
      WHERE date > ?
      GROUP BY inventoryId
    `);
  }
}
