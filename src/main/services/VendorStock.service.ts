import type { Database, Statement } from 'better-sqlite3';
import { get, toNumber } from 'lodash';
import type {
  ApiResponse,
  CreateVendorIssuePayload,
  VendorIssueListItem,
  VendorIssueView,
  VendorStockActivityFilters,
  VendorStockActivityItem,
  VendorStockActivityResponse,
  VendorStockMovementType,
  VendorStockOpeningRow,
  VendorStockPurchaseLine,
  VendorStockRow,
} from '../../types';
import { logErrors } from '../errorLogger';
import { raise } from '../utils/general';
import { cast, uncastBoolean } from '../utils/sqlite';
import { DatabaseService } from './Database.service';

@logErrors
export class VendorStockService {
  private db: Database;

  private stmGetTracksVendorStock!: Statement;

  private stmGetVendorStockQty!: Statement;

  private stmUpsertVendorStockDelta!: Statement;

  private stmSetVendorStockQty!: Statement;

  private stmInsertMovement!: Statement;

  private stmGetOnHand!: Statement;

  private stmGetOnHandForVendor!: Statement;

  private stmResolveAccountByCode!: Statement;

  private stmResolveAccountByName!: Statement;

  private stmResolveInventoryByName!: Statement;

  private stmGetNextIssueNumber!: Statement;

  private stmInsertIssue!: Statement;

  private stmInsertIssueItem!: Statement;

  private stmGetIssues!: Statement;

  private stmGetIssueHeader!: Statement;

  private stmGetIssueItems!: Statement;

  private stmSumMovementsBefore!: Statement;

  private stmSumMovementsInRange!: Statement;

  private stmGetAccountName!: Statement;

  private stmGetInventoryIdsWithVendorStock!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.initPreparedStatements();
  }

  getOnHand(vendorAccountId?: number): VendorStockRow[] {
    if (vendorAccountId != null && vendorAccountId > 0) {
      return this.stmGetOnHandForVendor.all({
        vendorAccountId: cast(vendorAccountId),
      }) as VendorStockRow[];
    }
    return this.stmGetOnHand.all() as VendorStockRow[];
  }

  getTrackedVendorAccounts(): Array<{
    id: number;
    name: string;
    code?: number | string | null;
  }> {
    return this.db
      .prepare(
        `
      SELECT a.id, a.name, a.code
      FROM account a
      WHERE COALESCE(a.tracksVendorStock, 0) = 1
      ORDER BY a.name COLLATE NOCASE
    `,
      )
      .all() as Array<{ id: number; name: string; code?: number | string | null }>;
  }

  /**
   * set opening stock for one vendor from item name + qty rows.
   * does not touch warehouse inventory.quantity.
   */
  setOpeningStock(
    vendorAccountId: number,
    items: Array<{ name: string; quantity: number }>,
    asOfDate: string,
    resetOthersToZero = false,
  ): ApiResponse {
    try {
      this.assertTracksVendorStock(vendorAccountId);
      this.db.transaction(() => {
        this.setOpeningStockWithoutTransaction(
          vendorAccountId,
          items,
          asOfDate,
          resetOthersToZero,
        );
      })();
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /**
   * multi-vendor opening import: each row has vendor code/name + item name + qty.
   */
  importOpeningStock(
    rows: VendorStockOpeningRow[],
    asOfDate: string,
    resetOthersToZero = false,
  ): ApiResponse {
    try {
      if (!rows.length) {
        return { success: false, error: 'No rows to import' };
      }

      this.db.transaction(() => {
        const byVendor = new Map<
          number,
          Array<{ name: string; quantity: number }>
        >();

        for (const row of rows) {
          const vendorAccountId = this.resolveVendorAccountId(
            row.vendorCode,
            row.vendorName,
          );
          this.assertTracksVendorStock(vendorAccountId);
          const list = byVendor.get(vendorAccountId) ?? [];
          list.push({ name: row.name, quantity: row.quantity });
          byVendor.set(vendorAccountId, list);
        }

        for (const [vendorAccountId, items] of byVendor) {
          this.setOpeningStockWithoutTransaction(
            vendorAccountId,
            items,
            asOfDate,
            resetOthersToZero,
          );
        }
      })();
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  private setOpeningStockWithoutTransaction(
    vendorAccountId: number,
    items: Array<{ name: string; quantity: number }>,
    asOfDate: string,
    resetOthersToZero: boolean,
  ): void {
    const touched = new Set<number>();

    for (const item of items) {
      const name = item.name?.trim();
      if (!name) {
        raise('Item name is required');
      }
      const inventoryId =
        this.resolveInventoryIdByName(name) ??
        raise(`Inventory item not found: ${name}`);
      this.setQuantityAbsolute({
        vendorAccountId,
        inventoryId,
        quantity: item.quantity,
        date: asOfDate,
        movementType: 'opening',
        notes: 'Opening stock import',
      });
      touched.add(inventoryId);
    }

    if (resetOthersToZero) {
      const existing = this.stmGetOnHandForVendor.all({
        vendorAccountId: cast(vendorAccountId),
      }) as VendorStockRow[];
      for (const row of existing) {
        if (touched.has(row.inventoryId)) continue;
        this.setQuantityAbsolute({
          vendorAccountId,
          inventoryId: row.inventoryId,
          quantity: 0,
          date: asOfDate,
          movementType: 'opening',
          notes: 'Opening stock reset (not in file)',
        });
      }
    }
  }

  getNextIssueNumber(): number {
    const row = this.stmGetNextIssueNumber.get() as
      | { nextNumber: number }
      | undefined;
    return toNumber(row?.nextNumber) || 1;
  }

  createIssue(payload: CreateVendorIssuePayload): ApiResponse & {
    issueId?: number;
    issueNumber?: number;
  } {
    try {
      const { vendorAccountId, date, notes, items } = payload;
      if (!vendorAccountId || vendorAccountId < 1) {
        raise('Select a vendor account');
      }
      this.assertTracksVendorStock(vendorAccountId);
      if (!date) {
        raise('Date is required');
      }
      if (!items?.length) {
        raise('Add at least one line item');
      }
      for (const item of items) {
        if (!item.inventoryId || item.quantity <= 0) {
          raise('Each line needs an item and quantity > 0');
        }
      }

      let issueId = 0;
      let issueNumber = 0;

      this.db.transaction(() => {
        issueNumber = this.getNextIssueNumber();
        const result = this.stmInsertIssue.run({
          issueNumber: cast(issueNumber),
          vendorAccountId: cast(vendorAccountId),
          date,
          notes: notes?.trim() || null,
        });
        issueId = Number(result.lastInsertRowid);

        for (const item of items) {
          this.stmInsertIssueItem.run({
            issueId: cast(issueId),
            inventoryId: cast(item.inventoryId),
            quantity: item.quantity,
          });
          this.applyDelta({
            vendorAccountId,
            inventoryId: item.inventoryId,
            quantityDelta: item.quantity,
            movementType: 'issue',
            referenceType: 'vendor_issue',
            referenceId: issueId,
            date,
            notes: notes?.trim() || null,
          });
        }
      })();

      return { success: true, issueId, issueNumber };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  getIssues(): VendorIssueListItem[] {
    return this.stmGetIssues.all() as VendorIssueListItem[];
  }

  getIssue(issueId: number): VendorIssueView | null {
    const header = this.stmGetIssueHeader.get({
      issueId: cast(issueId),
    }) as Omit<VendorIssueView, 'items'> | undefined;
    if (!header) return null;
    const items = this.stmGetIssueItems.all({
      issueId: cast(issueId),
    }) as VendorIssueView['items'];
    return { ...header, items };
  }

  /**
   * called from InvoiceService when a purchase is posted/edited/returned.
   * skips accounts that do not track vendor stock. allows negative qty (warn via log).
   * must be called inside an existing db transaction.
   */
  applyPurchaseEffect(params: {
    invoiceId: number;
    date: string;
    lines: VendorStockPurchaseLine[];
    direction: 'purchase' | 'purchase_return';
  }): void {
    const { invoiceId, date, lines, direction } = params;
    const sign = direction === 'purchase' ? -1 : 1;

    for (const line of lines) {
      if (!line.accountId || !line.inventoryId || !line.quantity) continue;
      if (!this.tracksVendorStock(line.accountId)) continue;

      this.applyDelta({
        vendorAccountId: line.accountId,
        inventoryId: line.inventoryId,
        quantityDelta: sign * line.quantity,
        movementType: direction,
        referenceType: 'invoice',
        referenceId: invoiceId,
        date,
        notes: null,
      });
    }
  }

  getActivity(
    filters: VendorStockActivityFilters,
  ): VendorStockActivityResponse {
    const { vendorAccountId, startDate, endDate } = filters;
    if (!vendorAccountId) {
      raise('Select a vendor account');
    }
    this.assertTracksVendorStock(vendorAccountId);

    const accountName =
      (
        this.stmGetAccountName.get({
          accountId: cast(vendorAccountId),
        }) as { name?: string } | undefined
      )?.name ?? '';

    // inventory ids that ever had stock or movements for this vendor
    const idRows = this.stmGetInventoryIdsWithVendorStock.all({
      vendorAccountId: cast(vendorAccountId),
    }) as Array<{ inventoryId: number; inventoryName: string }>;

    const items: VendorStockActivityItem[] = idRows.map((row) => {
      const opening = this.sumMovementsBefore(
        vendorAccountId,
        row.inventoryId,
        startDate,
      );
      const range = this.sumMovementsInRange(
        vendorAccountId,
        row.inventoryId,
        startDate,
        endDate,
      );
      const closing =
        opening +
        range.issued +
        range.purchaseReturned +
        range.adjusted -
        range.purchased;

      return {
        inventoryId: row.inventoryId,
        inventoryName: row.inventoryName,
        opening,
        issued: range.issued,
        purchased: range.purchased,
        purchaseReturned: range.purchaseReturned,
        adjusted: range.adjusted,
        closing,
      };
    });

    return {
      vendorAccountId,
      vendorAccountName: accountName,
      startDate,
      endDate,
      items: items.filter(
        (i) =>
          i.opening !== 0 ||
          i.issued !== 0 ||
          i.purchased !== 0 ||
          i.purchaseReturned !== 0 ||
          i.adjusted !== 0 ||
          i.closing !== 0,
      ),
    };
  }

  private sumMovementsBefore(
    vendorAccountId: number,
    inventoryId: number,
    beforeDate: string,
  ): number {
    const row = this.stmSumMovementsBefore.get({
      vendorAccountId: cast(vendorAccountId),
      inventoryId: cast(inventoryId),
      beforeDate,
    }) as { total?: number } | undefined;
    return toNumber(row?.total) || 0;
  }

  private sumMovementsInRange(
    vendorAccountId: number,
    inventoryId: number,
    startDate: string,
    endDate: string,
  ): {
    issued: number;
    purchased: number;
    purchaseReturned: number;
    adjusted: number;
  } {
    const rows = this.stmSumMovementsInRange.all({
      vendorAccountId: cast(vendorAccountId),
      inventoryId: cast(inventoryId),
      startDate,
      endDate,
    }) as Array<{ movementType: VendorStockMovementType; total: number }>;

    const out = {
      issued: 0,
      purchased: 0,
      purchaseReturned: 0,
      adjusted: 0,
    };
    for (const r of rows) {
      const total = toNumber(r.total) || 0;
      if (r.movementType === 'issue' || r.movementType === 'opening') {
        // opening inside range counts as issued-equivalent inflow for the period
        // report: opening column uses before-start; in-range openings go to adjusted
        if (r.movementType === 'opening') {
          out.adjusted += total;
        } else {
          out.issued += total;
        }
      } else if (r.movementType === 'purchase') {
        out.purchased += Math.abs(total);
      } else if (r.movementType === 'purchase_return') {
        out.purchaseReturned += total;
      } else if (r.movementType === 'adjustment') {
        out.adjusted += total;
      }
    }
    return out;
  }

  private tracksVendorStock(accountId: number): boolean {
    const row = this.stmGetTracksVendorStock.get({
      accountId: cast(accountId),
    }) as { tracksVendorStock?: number | boolean } | undefined;
    return Boolean(uncastBoolean(row?.tracksVendorStock));
  }

  private assertTracksVendorStock(accountId: number): void {
    if (!this.tracksVendorStock(accountId)) {
      raise(
        'Account does not track vendor stock. Enable "Track vendor stock" on the account first.',
      );
    }
  }

  private resolveVendorAccountId(
    code?: string | number | null,
    name?: string | null,
  ): number {
    if (code != null && String(code).trim() !== '') {
      const byCode = this.stmResolveAccountByCode.get({
        code: String(code).trim(),
      }) as { id?: number } | undefined;
      if (byCode?.id) return byCode.id;
    }
    if (name != null && name.trim() !== '') {
      const byName = this.stmResolveAccountByName.get({
        name: name.trim(),
      }) as { id?: number } | undefined;
      if (byName?.id) return byName.id;
    }
    return raise(
      `Vendor not found (code=${code ?? ''}, name=${name ?? ''}). Use an existing account with Track vendor stock enabled.`,
    );
  }

  private resolveInventoryIdByName(name: string): number | null {
    const row = this.stmResolveInventoryByName.get(name.trim()) as
      | { id?: number }
      | undefined;
    return get(row, 'id', null);
  }

  private setQuantityAbsolute(params: {
    vendorAccountId: number;
    inventoryId: number;
    quantity: number;
    date: string;
    movementType: VendorStockMovementType;
    notes: string | null;
  }): void {
    const current =
      (
        this.stmGetVendorStockQty.get({
          vendorAccountId: cast(params.vendorAccountId),
          inventoryId: cast(params.inventoryId),
        }) as { quantity?: number } | undefined
      )?.quantity ?? 0;
    const delta = params.quantity - current;
    this.stmSetVendorStockQty.run({
      vendorAccountId: cast(params.vendorAccountId),
      inventoryId: cast(params.inventoryId),
      quantity: params.quantity,
    });
    if (delta !== 0) {
      this.stmInsertMovement.run({
        vendorAccountId: cast(params.vendorAccountId),
        inventoryId: cast(params.inventoryId),
        quantityDelta: delta,
        movementType: params.movementType,
        referenceType: null,
        referenceId: null,
        date: params.date,
        notes: params.notes,
      });
    }
  }

  private applyDelta(params: {
    vendorAccountId: number;
    inventoryId: number;
    quantityDelta: number;
    movementType: VendorStockMovementType;
    referenceType: string | null;
    referenceId: number | null;
    date: string;
    notes: string | null;
  }): void {
    if (params.quantityDelta === 0) return;

    this.stmUpsertVendorStockDelta.run({
      vendorAccountId: cast(params.vendorAccountId),
      inventoryId: cast(params.inventoryId),
      quantityDelta: params.quantityDelta,
    });

    this.stmInsertMovement.run({
      vendorAccountId: cast(params.vendorAccountId),
      inventoryId: cast(params.inventoryId),
      quantityDelta: params.quantityDelta,
      movementType: params.movementType,
      referenceType: params.referenceType,
      referenceId:
        params.referenceId == null ? null : cast(params.referenceId),
      date: params.date,
      notes: params.notes,
    });
  }

  private initPreparedStatements(): void {
    this.stmGetTracksVendorStock = this.db.prepare(`
      SELECT COALESCE(tracksVendorStock, 0) AS tracksVendorStock
      FROM account WHERE id = @accountId
    `);

    this.stmGetVendorStockQty = this.db.prepare(`
      SELECT quantity FROM vendor_stock
      WHERE vendorAccountId = @vendorAccountId AND inventoryId = @inventoryId
    `);

    this.stmUpsertVendorStockDelta = this.db.prepare(`
      INSERT INTO vendor_stock (vendorAccountId, inventoryId, quantity)
      VALUES (@vendorAccountId, @inventoryId, @quantityDelta)
      ON CONFLICT(vendorAccountId, inventoryId) DO UPDATE SET
        quantity = quantity + excluded.quantity
    `);

    this.stmSetVendorStockQty = this.db.prepare(`
      INSERT INTO vendor_stock (vendorAccountId, inventoryId, quantity)
      VALUES (@vendorAccountId, @inventoryId, @quantity)
      ON CONFLICT(vendorAccountId, inventoryId) DO UPDATE SET
        quantity = excluded.quantity
    `);

    this.stmInsertMovement = this.db.prepare(`
      INSERT INTO vendor_stock_movements (
        vendorAccountId, inventoryId, quantityDelta, movementType,
        referenceType, referenceId, date, notes
      ) VALUES (
        @vendorAccountId, @inventoryId, @quantityDelta, @movementType,
        @referenceType, @referenceId, @date, @notes
      )
    `);

    this.stmGetOnHand = this.db.prepare(`
      SELECT
        vs.vendorAccountId,
        a.name AS vendorAccountName,
        a.code AS vendorAccountCode,
        vs.inventoryId,
        inv.name AS inventoryName,
        vs.quantity
      FROM vendor_stock vs
      JOIN account a ON a.id = vs.vendorAccountId
      JOIN inventory inv ON inv.id = vs.inventoryId
      WHERE vs.quantity != 0
      ORDER BY a.name COLLATE NOCASE, inv.name COLLATE NOCASE
    `);

    this.stmGetOnHandForVendor = this.db.prepare(`
      SELECT
        vs.vendorAccountId,
        a.name AS vendorAccountName,
        a.code AS vendorAccountCode,
        vs.inventoryId,
        inv.name AS inventoryName,
        vs.quantity
      FROM vendor_stock vs
      JOIN account a ON a.id = vs.vendorAccountId
      JOIN inventory inv ON inv.id = vs.inventoryId
      WHERE vs.vendorAccountId = @vendorAccountId
      ORDER BY inv.name COLLATE NOCASE
    `);

    this.stmResolveAccountByCode = this.db.prepare(`
      SELECT id FROM account
      WHERE TRIM(CAST(code AS TEXT)) = TRIM(@code)
        AND COALESCE(tracksVendorStock, 0) = 1
      LIMIT 1
    `);

    this.stmResolveAccountByName = this.db.prepare(`
      SELECT id FROM account
      WHERE TRIM(name) = TRIM(@name)
        AND COALESCE(tracksVendorStock, 0) = 1
      LIMIT 1
    `);

    this.stmResolveInventoryByName = this.db.prepare(`
      SELECT id FROM inventory WHERE TRIM(name) = TRIM(?)
    `);

    this.stmGetNextIssueNumber = this.db.prepare(`
      SELECT COALESCE(MAX(issueNumber), 0) + 1 AS nextNumber FROM vendor_issues
    `);

    this.stmInsertIssue = this.db.prepare(`
      INSERT INTO vendor_issues (issueNumber, vendorAccountId, date, notes)
      VALUES (@issueNumber, @vendorAccountId, @date, @notes)
    `);

    this.stmInsertIssueItem = this.db.prepare(`
      INSERT INTO vendor_issue_items (issueId, inventoryId, quantity)
      VALUES (@issueId, @inventoryId, @quantity)
    `);

    this.stmGetIssues = this.db.prepare(`
      SELECT
        vi.id,
        vi.issueNumber,
        vi.vendorAccountId,
        a.name AS vendorAccountName,
        vi.date,
        vi.notes,
        vi.createdAt,
        COALESCE(SUM(vii.quantity), 0) AS totalQuantity,
        COUNT(vii.id) AS lineCount
      FROM vendor_issues vi
      JOIN account a ON a.id = vi.vendorAccountId
      LEFT JOIN vendor_issue_items vii ON vii.issueId = vi.id
      GROUP BY vi.id
      ORDER BY vi.issueNumber DESC
    `);

    this.stmGetIssueHeader = this.db.prepare(`
      SELECT
        vi.id,
        vi.issueNumber,
        vi.vendorAccountId,
        a.name AS vendorAccountName,
        vi.date,
        vi.notes,
        vi.createdAt,
        COALESCE((SELECT SUM(quantity) FROM vendor_issue_items WHERE issueId = vi.id), 0) AS totalQuantity,
        COALESCE((SELECT COUNT(*) FROM vendor_issue_items WHERE issueId = vi.id), 0) AS lineCount
      FROM vendor_issues vi
      JOIN account a ON a.id = vi.vendorAccountId
      WHERE vi.id = @issueId
    `);

    this.stmGetIssueItems = this.db.prepare(`
      SELECT
        vii.id,
        vii.inventoryId,
        inv.name AS inventoryName,
        vii.quantity
      FROM vendor_issue_items vii
      JOIN inventory inv ON inv.id = vii.inventoryId
      WHERE vii.issueId = @issueId
      ORDER BY vii.id
    `);

    this.stmSumMovementsBefore = this.db.prepare(`
      SELECT COALESCE(SUM(quantityDelta), 0) AS total
      FROM vendor_stock_movements
      WHERE vendorAccountId = @vendorAccountId
        AND inventoryId = @inventoryId
        AND datetime(date) < datetime(@beforeDate)
    `);

    this.stmSumMovementsInRange = this.db.prepare(`
      SELECT movementType, COALESCE(SUM(quantityDelta), 0) AS total
      FROM vendor_stock_movements
      WHERE vendorAccountId = @vendorAccountId
        AND inventoryId = @inventoryId
        AND datetime(date) >= datetime(@startDate)
        AND datetime(date) <= datetime(@endDate)
      GROUP BY movementType
    `);

    this.stmGetAccountName = this.db.prepare(`
      SELECT name FROM account WHERE id = @accountId
    `);

    this.stmGetInventoryIdsWithVendorStock = this.db.prepare(`
      SELECT DISTINCT inventoryId, inventoryName FROM (
        SELECT vs.inventoryId, inv.name AS inventoryName
        FROM vendor_stock vs
        JOIN inventory inv ON inv.id = vs.inventoryId
        WHERE vs.vendorAccountId = @vendorAccountId
        UNION
        SELECT m.inventoryId, inv.name AS inventoryName
        FROM vendor_stock_movements m
        JOIN inventory inv ON inv.id = m.inventoryId
        WHERE m.vendorAccountId = @vendorAccountId
      )
      ORDER BY inventoryName COLLATE NOCASE
    `);
  }
}
