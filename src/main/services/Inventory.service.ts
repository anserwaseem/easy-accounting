import type { Database, Statement } from 'better-sqlite3';
import { get } from 'lodash';
import type {
  InsertInventoryItem,
  InventoryItem,
  UpdateInventoryItem,
} from 'types';
import { logErrors } from '../errorLogger';
import { DatabaseService } from './Database.service';
import { cast } from '../utils/sqlite';

@logErrors
export class InventoryService {
  private db: Database;

  private stmInventoryExists!: Statement;

  private stmGetInventory!: Statement;

  private stmInsertItem!: Statement;

  private stmUpdateItem!: Statement;

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

  private initPreparedStatements() {
    this.stmInventoryExists = this.db.prepare(`
      SELECT COUNT(*) AS 'count' from inventory;
    `);

    this.stmGetInventory = this.db.prepare(`
      SELECT * FROM inventory
      WHERE quantity > 0 AND price > 0
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
  }
}
