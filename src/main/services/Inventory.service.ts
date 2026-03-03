import type { Database, Statement } from 'better-sqlite3';
import { get } from 'lodash';
import type {
  ApiResponse,
  ApplyStockAdjustmentPayload,
  InsertInventoryItem,
  InventoryItem,
  InventoryOpeningStock,
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

    const placeholders = inventory.map(() => '(?, ?, ?)').join(', ');
    const sql = `INSERT INTO inventory (name, description, price) VALUES ${placeholders}`;

    const stmInsertInventory = this.db.prepare(sql);

    const values = inventory.flatMap((item) => [
      item.name,
      item.description,
      item.price,
    ]);

    const result = stmInsertInventory.run(values);

    if (result.changes === 0) {
      return false;
    }

    return true;
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

  private initPreparedStatements() {
    this.stmInventoryExists = this.db.prepare(`
      SELECT COUNT(*) AS 'count' from inventory;
    `);

    this.stmGetInventory = this.db.prepare(`
      SELECT * FROM inventory
      ORDER BY id;
    `);

    this.stmInsertItem = this.db.prepare(`
      INSERT INTO inventory (name, description, price)
      VALUES (@name, @description, @price);
    `);

    this.stmUpdateItem = this.db.prepare(`
      UPDATE inventory
      SET price = @price, description = @description
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
  }
}
