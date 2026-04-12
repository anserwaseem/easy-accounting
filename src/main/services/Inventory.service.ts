import type { Database, Statement } from 'better-sqlite3';
import { get } from 'lodash';
import type {
  ApiResponse,
  ApplyStockAdjustmentPayload,
  InsertInventoryItem,
  InventoryItem,
  InventoryOpeningStock,
  ReportResponse,
  SetOpeningStockItem,
  StockAdjustment,
  UpdateInventoryItem,
} from 'types';
import { logErrors } from '../errorLogger';
import { DatabaseService } from './Database.service';
import { cast } from '../utils/sqlite';
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

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.initPreparedStatements();
  }

  doesInventoryExist(): boolean {
    const result = <number | undefined>this.stmInventoryExists.get();
    return get(result, 'count', 0) > 0;
  }

  getInventory(): InventoryItem[] {
    const results = this.stmGetInventory.all() as InventoryItem[];
    return results;
  }

  saveInventory(inventory: InventoryItem[]): boolean {
    if (inventory.length === 0) {
      return false;
    }

    let success = true;
    this.db.transaction(() => {
      for (const item of inventory) {
        const result = this.stmInsertItem.run({
          name: item.name,
          description: item.description,
          price: item.price,
          itemTypeId: item.itemTypeId ?? null,
        });
        if (!result.changes) {
          success = false;
          throw new Error(`Failed to insert inventory item: ${item.name}`);
        }
      }
    })();

    return success;
  }

  insertItem(item: InsertInventoryItem): boolean {
    const result = this.stmInsertItem.run({ ...item });
    return Boolean(result.changes);
  }

  updateItem(item: UpdateInventoryItem): boolean {
    const result = this.stmUpdateItem.run({
      ...item,
      id: cast(item.id),
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

  private initPreparedStatements() {
    this.stmInventoryExists = this.db.prepare(`
      SELECT COUNT(*) AS 'count' from inventory;
    `);

    this.stmGetInventory = this.db.prepare(`
      SELECT i.*, it.name AS itemTypeName
      FROM inventory i
      LEFT JOIN item_types it ON it.id = i.itemTypeId
      ORDER BY i.id;
    `);

    this.stmInsertItem = this.db.prepare(`
      INSERT INTO inventory (name, description, price, itemTypeId)
      VALUES (@name, @description, @price, @itemTypeId);
    `);

    this.stmUpdateItem = this.db.prepare(`
      UPDATE inventory
      SET price = @price, description = @description, itemTypeId = @itemTypeId
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
      ORDER BY i.id
    `);

    // Get all inventory items filtered by item type IDs using JSON1
    this.stmGetAllInventoryByItemTypes = this.db.prepare(`
      SELECT i.*, it.name AS itemTypeName
      FROM inventory i
      LEFT JOIN item_types it ON it.id = i.itemTypeId
      WHERE i.itemTypeId IN (SELECT value FROM json_each(@itemTypeIdsJson))
      ORDER BY i.id
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
  }
}
