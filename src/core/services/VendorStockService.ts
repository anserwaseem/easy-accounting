import { get, toNumber } from 'lodash';
import type {
  ApiResponse,
  CreateVendorIssuePayload,
  UpdateVendorIssuePayload,
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
import { familyHeadId } from '../../lib/inventoryFamily';
import type { DatabaseDriver } from '../db/driver';
import { logErrors } from '../errorLogger';
import { cast, raise, uncastBoolean } from '../utils/sqlite';

const SQL = {
  getTracksVendorStock: `
      SELECT COALESCE(tracksVendorStock, 0) AS tracksVendorStock
      FROM account WHERE id = @accountId
    `,
  getVendorStockQty: `
      SELECT quantity FROM vendor_stock
      WHERE vendorAccountId = @vendorAccountId AND inventoryId = @inventoryId
    `,
  upsertVendorStockDelta: `
      INSERT INTO vendor_stock (vendorAccountId, inventoryId, quantity)
      VALUES (@vendorAccountId, @inventoryId, @quantityDelta)
      ON CONFLICT(vendorAccountId, inventoryId) DO UPDATE SET
        quantity = quantity + excluded.quantity
    `,
  setVendorStockQty: `
      INSERT INTO vendor_stock (vendorAccountId, inventoryId, quantity)
      VALUES (@vendorAccountId, @inventoryId, @quantity)
      ON CONFLICT(vendorAccountId, inventoryId) DO UPDATE SET
        quantity = excluded.quantity
    `,
  insertMovement: `
      INSERT INTO vendor_stock_movements (
        vendorAccountId, inventoryId, quantityDelta, movementType,
        referenceType, referenceId, date, notes
      ) VALUES (
        @vendorAccountId, @inventoryId, @quantityDelta, @movementType,
        @referenceType, @referenceId, @date, @notes
      )
    `,
  getOnHand: `
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
    `,
  getOnHandForVendor: `
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
        AND vs.quantity != 0
      ORDER BY inv.name COLLATE NOCASE
    `,
  getTrackedVendorAccounts: `
      SELECT a.id, a.name, a.code
      FROM account a
      WHERE COALESCE(a.tracksVendorStock, 0) = 1
      ORDER BY a.name COLLATE NOCASE
    `,
  resolveAccountByCode: `
      SELECT id FROM account
      WHERE TRIM(CAST(code AS TEXT)) = TRIM(@code)
        AND COALESCE(tracksVendorStock, 0) = 1
      LIMIT 1
    `,
  resolveAccountByName: `
      SELECT id FROM account
      WHERE TRIM(name) = TRIM(@name)
        AND COALESCE(tracksVendorStock, 0) = 1
      LIMIT 1
    `,
  resolveInventoryByName: `
      SELECT id FROM inventory WHERE TRIM(name) = TRIM(?)
    `,
  resolveInventoryNameById: `
      SELECT name FROM inventory WHERE id = ?
    `,
  getInventoryParent: `
      SELECT id, parentId FROM inventory WHERE id = ?
    `,
  remapMovements: `
      UPDATE vendor_stock_movements
      SET inventoryId = ?
      WHERE inventoryId = ?
    `,
  remapIssueItems: `
      UPDATE vendor_issue_items
      SET inventoryId = ?
      WHERE inventoryId = ?
    `,
  getVendorStockRowsForInventory: `
      SELECT vendorAccountId, quantity
      FROM vendor_stock
      WHERE inventoryId = ?
    `,
  deleteVendorStockRow: `
      DELETE FROM vendor_stock
      WHERE vendorAccountId = ? AND inventoryId = ?
    `,
  getNextIssueNumber: `
      SELECT COALESCE(MAX(issueNumber), 0) + 1 AS nextNumber FROM vendor_issues
    `,
  insertIssue: `
      INSERT INTO vendor_issues (issueNumber, vendorAccountId, date, notes)
      VALUES (@issueNumber, @vendorAccountId, @date, @notes)
    `,
  insertIssueItem: `
      INSERT INTO vendor_issue_items (issueId, inventoryId, quantity)
      VALUES (@issueId, @inventoryId, @quantity)
    `,
  updateIssue: `
      UPDATE vendor_issues
      SET vendorAccountId = @vendorAccountId,
          date = @date,
          notes = @notes
      WHERE id = @issueId
    `,
  deleteIssueItems: `
      DELETE FROM vendor_issue_items WHERE issueId = @issueId
    `,
  deleteIssueMovements: `
      DELETE FROM vendor_stock_movements
      WHERE referenceType = 'vendor_issue' AND referenceId = @issueId
    `,
  deleteIssue: `
      DELETE FROM vendor_issues WHERE id = @issueId
    `,
  getIssues: `
      SELECT
        vi.id,
        vi.issueNumber,
        vi.vendorAccountId,
        a.name AS vendorAccountName,
        vi.date,
        vi.notes,
        vi.createdAt,
        vi.updatedAt,
        COALESCE(SUM(vii.quantity), 0) AS totalQuantity,
        COUNT(vii.id) AS lineCount
      FROM vendor_issues vi
      JOIN account a ON a.id = vi.vendorAccountId
      LEFT JOIN vendor_issue_items vii ON vii.issueId = vi.id
      GROUP BY vi.id
      ORDER BY vi.issueNumber DESC
    `,
  getIssueHeader: `
      SELECT
        vi.id,
        vi.issueNumber,
        vi.vendorAccountId,
        a.name AS vendorAccountName,
        vi.date,
        vi.notes,
        vi.createdAt,
        vi.updatedAt,
        COALESCE((SELECT SUM(quantity) FROM vendor_issue_items WHERE issueId = vi.id), 0) AS totalQuantity,
        COALESCE((SELECT COUNT(*) FROM vendor_issue_items WHERE issueId = vi.id), 0) AS lineCount
      FROM vendor_issues vi
      JOIN account a ON a.id = vi.vendorAccountId
      WHERE vi.id = @issueId
    `,
  getIssueItems: `
      SELECT
        vii.id,
        vii.inventoryId,
        inv.name AS inventoryName,
        vii.quantity
      FROM vendor_issue_items vii
      JOIN inventory inv ON inv.id = vii.inventoryId
      WHERE vii.issueId = @issueId
      ORDER BY vii.id
    `,
  sumMovementsBefore: `
      SELECT COALESCE(SUM(quantityDelta), 0) AS total
      FROM vendor_stock_movements
      WHERE vendorAccountId = @vendorAccountId
        AND inventoryId = @inventoryId
        AND datetime(date) < datetime(@beforeDate)
    `,
  sumMovementsInRange: `
      SELECT movementType, COALESCE(SUM(quantityDelta), 0) AS total
      FROM vendor_stock_movements
      WHERE vendorAccountId = @vendorAccountId
        AND inventoryId = @inventoryId
        AND datetime(date) >= datetime(@startDate)
        AND datetime(date) < datetime(@endDate, '+1 day')
      GROUP BY movementType
    `,
  getAccountName: `
      SELECT name FROM account WHERE id = @accountId
    `,
  getInventoryIdsWithVendorStock: `
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
    `,
};

/**
 * Platform-free port of src/main/services/VendorStock.service.ts — identical
 * SQL and behavior, async against the DatabaseDriver.
 */
@logErrors
export class VendorStockService {
  private db: DatabaseDriver;

  constructor(deps: { db: DatabaseDriver }) {
    this.db = deps.db;
  }

  async getOnHand(vendorAccountId?: number): Promise<VendorStockRow[]> {
    if (vendorAccountId != null && vendorAccountId > 0) {
      return this.db.all<VendorStockRow>(SQL.getOnHandForVendor, {
        vendorAccountId: cast(vendorAccountId),
      });
    }
    return this.db.all<VendorStockRow>(SQL.getOnHand);
  }

  async getTrackedVendorAccounts(): Promise<
    Array<{ id: number; name: string; code?: number | string | null }>
  > {
    return this.db.all(SQL.getTrackedVendorAccounts);
  }

  /**
   * set opening stock for one vendor from item name + qty rows.
   * does not touch warehouse inventory.quantity.
   */
  async setOpeningStock(
    vendorAccountId: number,
    items: Array<{ name: string; quantity: number }>,
    asOfDate: string,
    resetOthersToZero = false,
  ): Promise<ApiResponse> {
    try {
      await this.assertTracksVendorStock(vendorAccountId);
      await this.db.transaction(async () => {
        await this.setOpeningStockWithoutTransaction(
          vendorAccountId,
          items,
          asOfDate,
          resetOthersToZero,
        );
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /**
   * multi-vendor opening import: each row has vendor code/name + item name + qty.
   */
  async importOpeningStock(
    rows: VendorStockOpeningRow[],
    asOfDate: string,
    resetOthersToZero = false,
  ): Promise<ApiResponse> {
    try {
      if (!rows.length) {
        return { success: false, error: 'No rows to import' };
      }

      await this.db.transaction(async () => {
        const byVendor = new Map<
          number,
          Array<{ name: string; quantity: number }>
        >();

        for (const row of rows) {
          // eslint-disable-next-line no-await-in-loop
          const vendorAccountId = await this.resolveVendorAccountId(
            row.vendorCode,
            row.vendorName,
          );
          // eslint-disable-next-line no-await-in-loop
          await this.assertTracksVendorStock(vendorAccountId);
          const list = byVendor.get(vendorAccountId) ?? [];
          list.push({ name: row.name, quantity: row.quantity });
          byVendor.set(vendorAccountId, list);
        }

        for (const [vendorAccountId, items] of byVendor) {
          // eslint-disable-next-line no-await-in-loop
          await this.setOpeningStockWithoutTransaction(
            vendorAccountId,
            items,
            asOfDate,
            resetOthersToZero,
          );
        }
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  private async setOpeningStockWithoutTransaction(
    vendorAccountId: number,
    items: Array<{ name: string; quantity: number }>,
    asOfDate: string,
    resetOthersToZero: boolean,
  ): Promise<void> {
    // opening is family-keyed: variant names coerce to head; same-head rows sum
    const qtyByHead = new Map<number, number>();

    for (const item of items) {
      const name = item.name?.trim();
      if (!name) {
        raise('Item name is required');
      }
      // eslint-disable-next-line no-await-in-loop
      const resolvedId = await this.resolveInventoryIdByName(name);
      const inventoryId =
        resolvedId ?? raise(`Inventory item not found: ${name}`);
      // eslint-disable-next-line no-await-in-loop
      const headId = await this.resolveFamilyHeadId(inventoryId);
      qtyByHead.set(headId, (qtyByHead.get(headId) ?? 0) + item.quantity);
    }

    const touched = new Set<number>();
    for (const [inventoryId, quantity] of qtyByHead) {
      // eslint-disable-next-line no-await-in-loop
      await this.setQuantityAbsolute({
        vendorAccountId,
        inventoryId,
        quantity,
        date: asOfDate,
        movementType: 'opening',
        notes: 'Opening stock import',
      });
      touched.add(inventoryId);
    }

    if (resetOthersToZero) {
      const existing = await this.db.all<VendorStockRow>(
        SQL.getOnHandForVendor,
        { vendorAccountId: cast(vendorAccountId) },
      );
      for (const row of existing) {
        if (touched.has(row.inventoryId)) continue;
        // eslint-disable-next-line no-await-in-loop
        await this.setQuantityAbsolute({
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

  /**
   * vendor WIP is keyed by family head (parentId ?? id).
   * purchase of any variant consumes the same pool as a send of the head.
   */
  async resolveFamilyHeadId(inventoryId: number): Promise<number> {
    const row = await this.db.get<{ id: number; parentId?: number | null }>(
      SQL.getInventoryParent,
      [cast(inventoryId)],
    );
    if (!row) {
      return raise(`Inventory item not found: #${inventoryId}`);
    }
    return familyHeadId({ id: row.id, parentId: row.parentId });
  }

  /**
   * when an orphan is linked to a family head, fold any WIP still keyed on the
   * orphan into the head so purchase consume stays one pool.
   * must run inside a db transaction (caller owns it).
   */
  async remapInventoryToFamilyHead(
    fromInventoryId: number,
    toHeadId: number,
  ): Promise<void> {
    if (fromInventoryId === toHeadId) return;

    await this.db.run(SQL.remapMovements, [
      cast(toHeadId),
      cast(fromInventoryId),
    ]);
    await this.db.run(SQL.remapIssueItems, [
      cast(toHeadId),
      cast(fromInventoryId),
    ]);

    const orphanRows = await this.db.all<{
      vendorAccountId: number;
      quantity: number;
    }>(SQL.getVendorStockRowsForInventory, [cast(fromInventoryId)]);

    for (const row of orphanRows) {
      // eslint-disable-next-line no-await-in-loop
      await this.db.run(SQL.upsertVendorStockDelta, {
        vendorAccountId: cast(row.vendorAccountId),
        inventoryId: cast(toHeadId),
        quantityDelta: row.quantity,
      });
      // eslint-disable-next-line no-await-in-loop
      await this.db.run(SQL.deleteVendorStockRow, [
        cast(row.vendorAccountId),
        cast(fromInventoryId),
      ]);
    }
  }

  async getNextIssueNumber(): Promise<number> {
    const row = await this.db.get<{ nextNumber: number }>(
      SQL.getNextIssueNumber,
    );
    return toNumber(row?.nextNumber) || 1;
  }

  async createIssue(payload: CreateVendorIssuePayload): Promise<
    ApiResponse & {
      issueId?: number;
      issueNumber?: number;
    }
  > {
    try {
      await this.validateIssuePayload(payload);

      let issueId = 0;
      let issueNumber = 0;

      await this.db.transaction(async () => {
        issueNumber = await this.getNextIssueNumber();
        const result = await this.db.run(SQL.insertIssue, {
          issueNumber: cast(issueNumber),
          vendorAccountId: cast(payload.vendorAccountId),
          date: payload.date,
          notes: payload.notes?.trim() || null,
        });
        issueId = Number(result.lastInsertRowid);

        await this.insertIssueLinesAndStock(
          issueId,
          payload.vendorAccountId,
          payload.date,
          payload.notes,
          payload.items,
        );
      });

      return { success: true, issueId, issueNumber };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async getIssues(): Promise<VendorIssueListItem[]> {
    return this.db.all<VendorIssueListItem>(SQL.getIssues);
  }

  async getIssue(issueId: number): Promise<VendorIssueView | null> {
    const header = await this.db.get<Omit<VendorIssueView, 'items'>>(
      SQL.getIssueHeader,
      { issueId: cast(issueId) },
    );
    if (!header) return null;
    const items = await this.db.all<VendorIssueView['items'][number]>(
      SQL.getIssueItems,
      { issueId: cast(issueId) },
    );
    return { ...header, items };
  }

  async updateIssue(
    issueId: number,
    payload: UpdateVendorIssuePayload,
  ): Promise<ApiResponse & { issueId?: number; issueNumber?: number }> {
    try {
      const existing =
        (await this.getIssue(issueId)) ?? raise('Send to vendor not found');
      await this.validateIssuePayload(payload);

      await this.db.transaction(async () => {
        await this.clearIssueStockAndLines(existing);
        await this.db.run(SQL.updateIssue, {
          issueId: cast(issueId),
          vendorAccountId: cast(payload.vendorAccountId),
          date: payload.date,
          notes: payload.notes?.trim() || null,
        });
        await this.insertIssueLinesAndStock(
          issueId,
          payload.vendorAccountId,
          payload.date,
          payload.notes,
          payload.items,
        );
      });

      return {
        success: true,
        issueId,
        issueNumber: existing.issueNumber,
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async deleteIssue(issueId: number): Promise<ApiResponse> {
    try {
      const existing =
        (await this.getIssue(issueId)) ?? raise('Send to vendor not found');

      await this.db.transaction(async () => {
        await this.clearIssueStockAndLines(existing);
        await this.db.run(SQL.deleteIssue, { issueId: cast(issueId) });
      });

      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /**
   * called from InvoiceService when a purchase is posted/edited/returned.
   * skips accounts that do not track vendor stock. allows negative qty.
   * must be called inside an existing db transaction.
   * returns short user-facing messages for toasts — one line per family head,
   * not per invoice line (variants collapse into the same pool).
   */
  async applyPurchaseEffect(params: {
    invoiceId: number;
    date: string;
    lines: VendorStockPurchaseLine[];
    direction: 'purchase' | 'purchase_return';
  }): Promise<string[]> {
    const { invoiceId, date, lines, direction } = params;
    const sign = direction === 'purchase' ? -1 : 1;

    // aggregate first so toast is one row per family, not a running play-by-play
    const deltaByKey = new Map<
      string,
      { accountId: number; headId: number; delta: number }
    >();

    for (const line of lines) {
      if (!line.accountId || !line.inventoryId || !line.quantity) continue;
      // eslint-disable-next-line no-await-in-loop
      if (!(await this.tracksVendorStock(line.accountId))) continue;

      // eslint-disable-next-line no-await-in-loop
      const headId = await this.resolveFamilyHeadId(line.inventoryId);
      const quantityDelta = sign * line.quantity;

      // eslint-disable-next-line no-await-in-loop
      await this.applyDelta({
        vendorAccountId: line.accountId,
        inventoryId: headId,
        quantityDelta,
        movementType: direction,
        referenceType: 'invoice',
        referenceId: invoiceId,
        date,
        notes: null,
      });

      const key = `${line.accountId}:${headId}`;
      const existing = deltaByKey.get(key);
      if (existing) {
        existing.delta += quantityDelta;
      } else {
        deltaByKey.set(key, {
          accountId: line.accountId,
          headId,
          delta: quantityDelta,
        });
      }
    }

    const messages: string[] = [];
    for (const { accountId, headId, delta } of deltaByKey.values()) {
      // eslint-disable-next-line no-await-in-loop
      const qtyRow = await this.db.get<{ quantity?: number }>(
        SQL.getVendorStockQty,
        {
          vendorAccountId: cast(accountId),
          inventoryId: cast(headId),
        },
      );
      const newQty = qtyRow?.quantity ?? 0;
      // eslint-disable-next-line no-await-in-loop
      const nameRow = await this.db.get<{ name?: string }>(
        SQL.resolveInventoryNameById,
        [cast(headId)],
      );
      const headName = nameRow?.name ?? `Item #${headId}`;
      const deltaText = delta > 0 ? `+${delta}` : String(delta);
      messages.push(`${headName}: ${deltaText} (now ${newQty})`);
      if (newQty < 0) {
        messages.push(`Warning: ${headName} at vendor is negative (${newQty})`);
      }
    }

    return messages;
  }

  async getActivity(
    filters: VendorStockActivityFilters,
  ): Promise<VendorStockActivityResponse> {
    const { vendorAccountId, startDate, endDate } = filters;
    if (!vendorAccountId) {
      raise('Select a vendor account');
    }
    await this.assertTracksVendorStock(vendorAccountId);

    const accountRow = await this.db.get<{ name?: string }>(
      SQL.getAccountName,
      {
        accountId: cast(vendorAccountId),
      },
    );
    const accountName = accountRow?.name ?? '';

    const idRows = await this.db.all<{
      inventoryId: number;
      inventoryName: string;
    }>(SQL.getInventoryIdsWithVendorStock, {
      vendorAccountId: cast(vendorAccountId),
    });

    const items: VendorStockActivityItem[] = [];
    for (const row of idRows) {
      // eslint-disable-next-line no-await-in-loop
      const opening = await this.sumMovementsBefore(
        vendorAccountId,
        row.inventoryId,
        startDate,
      );
      // eslint-disable-next-line no-await-in-loop
      const range = await this.sumMovementsInRange(
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

      items.push({
        inventoryId: row.inventoryId,
        inventoryName: row.inventoryName,
        opening,
        issued: range.issued,
        purchased: range.purchased,
        purchaseReturned: range.purchaseReturned,
        adjusted: range.adjusted,
        closing,
      });
    }

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

  private async sumMovementsBefore(
    vendorAccountId: number,
    inventoryId: number,
    beforeDate: string,
  ): Promise<number> {
    const row = await this.db.get<{ total?: number }>(SQL.sumMovementsBefore, {
      vendorAccountId: cast(vendorAccountId),
      inventoryId: cast(inventoryId),
      beforeDate,
    });
    return toNumber(row?.total) || 0;
  }

  private async sumMovementsInRange(
    vendorAccountId: number,
    inventoryId: number,
    startDate: string,
    endDate: string,
  ): Promise<{
    issued: number;
    purchased: number;
    purchaseReturned: number;
    adjusted: number;
  }> {
    const rows = await this.db.all<{
      movementType: VendorStockMovementType;
      total: number;
    }>(SQL.sumMovementsInRange, {
      vendorAccountId: cast(vendorAccountId),
      inventoryId: cast(inventoryId),
      startDate,
      endDate,
    });

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

  private async tracksVendorStock(accountId: number): Promise<boolean> {
    const row = await this.db.get<{
      tracksVendorStock?: number | boolean;
    }>(SQL.getTracksVendorStock, { accountId: cast(accountId) });
    return Boolean(uncastBoolean(row?.tracksVendorStock));
  }

  private async assertTracksVendorStock(accountId: number): Promise<void> {
    if (!(await this.tracksVendorStock(accountId))) {
      raise(
        'Account does not track stock at vendor. Enable "Track stock at this vendor" on the account first.',
      );
    }
  }

  private async validateIssuePayload(
    payload: CreateVendorIssuePayload,
  ): Promise<void> {
    if (!payload.vendorAccountId || payload.vendorAccountId < 1) {
      raise('Select a vendor account');
    }
    await this.assertTracksVendorStock(payload.vendorAccountId);
    if (!payload.date) {
      raise('Date is required');
    }
    if (!payload.items?.length) {
      raise('Add at least one line item');
    }
    for (const item of payload.items) {
      if (!item.inventoryId || item.quantity <= 0) {
        raise('Each line needs an item and quantity > 0');
      }
    }
  }

  private async insertIssueLinesAndStock(
    issueId: number,
    vendorAccountId: number,
    date: string,
    notes: string | undefined,
    items: CreateVendorIssuePayload['items'],
  ): Promise<void> {
    const trimmedNotes = notes?.trim() || null;
    // coerce variants → family head so WIP pool matches purchase consume
    const qtyByHead = new Map<number, number>();
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      const headId = await this.resolveFamilyHeadId(item.inventoryId);
      qtyByHead.set(headId, (qtyByHead.get(headId) ?? 0) + item.quantity);
    }
    for (const [inventoryId, quantity] of qtyByHead) {
      // eslint-disable-next-line no-await-in-loop
      await this.db.run(SQL.insertIssueItem, {
        issueId: cast(issueId),
        inventoryId: cast(inventoryId),
        quantity,
      });
      // eslint-disable-next-line no-await-in-loop
      await this.applyDelta({
        vendorAccountId,
        inventoryId,
        quantityDelta: quantity,
        movementType: 'issue',
        referenceType: 'vendor_issue',
        referenceId: issueId,
        date,
        notes: trimmedNotes,
      });
    }
  }

  /**
   * reverse stock from an existing issue and remove its lines + issue movements.
   * leaves the vendor_issues header row in place (caller may update or delete it).
   */
  private async clearIssueStockAndLines(
    existing: VendorIssueView,
  ): Promise<void> {
    for (const item of existing.items) {
      // eslint-disable-next-line no-await-in-loop
      await this.db.run(SQL.upsertVendorStockDelta, {
        vendorAccountId: cast(existing.vendorAccountId),
        inventoryId: cast(item.inventoryId),
        quantityDelta: -item.quantity,
      });
    }
    await this.db.run(SQL.deleteIssueMovements, {
      issueId: cast(existing.id),
    });
    await this.db.run(SQL.deleteIssueItems, { issueId: cast(existing.id) });
  }

  private async resolveVendorAccountId(
    code?: string | number | null,
    name?: string | null,
  ): Promise<number> {
    if (code != null && String(code).trim() !== '') {
      const byCode = await this.db.get<{ id?: number }>(
        SQL.resolveAccountByCode,
        { code: String(code).trim() },
      );
      if (byCode?.id) return byCode.id;
    }
    if (name != null && name.trim() !== '') {
      const byName = await this.db.get<{ id?: number }>(
        SQL.resolveAccountByName,
        { name: name.trim() },
      );
      if (byName?.id) return byName.id;
    }
    return raise(
      `Vendor not found (code=${code ?? ''}, name=${
        name ?? ''
      }). Use an existing account with "Track stock at this vendor" enabled.`,
    );
  }

  private async resolveInventoryIdByName(name: string): Promise<number | null> {
    const row = await this.db.get<{ id?: number }>(SQL.resolveInventoryByName, [
      name.trim(),
    ]);
    return get(row, 'id', null);
  }

  private async setQuantityAbsolute(params: {
    vendorAccountId: number;
    inventoryId: number;
    quantity: number;
    date: string;
    movementType: VendorStockMovementType;
    notes: string | null;
  }): Promise<void> {
    const currentRow = await this.db.get<{ quantity?: number }>(
      SQL.getVendorStockQty,
      {
        vendorAccountId: cast(params.vendorAccountId),
        inventoryId: cast(params.inventoryId),
      },
    );
    const current = currentRow?.quantity ?? 0;
    const delta = params.quantity - current;
    await this.db.run(SQL.setVendorStockQty, {
      vendorAccountId: cast(params.vendorAccountId),
      inventoryId: cast(params.inventoryId),
      quantity: params.quantity,
    });
    if (delta !== 0) {
      await this.db.run(SQL.insertMovement, {
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

  private async applyDelta(params: {
    vendorAccountId: number;
    inventoryId: number;
    quantityDelta: number;
    movementType: VendorStockMovementType;
    referenceType: string | null;
    referenceId: number | null;
    date: string;
    notes: string | null;
  }): Promise<void> {
    if (params.quantityDelta === 0) return;

    await this.db.run(SQL.upsertVendorStockDelta, {
      vendorAccountId: cast(params.vendorAccountId),
      inventoryId: cast(params.inventoryId),
      quantityDelta: params.quantityDelta,
    });

    await this.db.run(SQL.insertMovement, {
      vendorAccountId: cast(params.vendorAccountId),
      inventoryId: cast(params.inventoryId),
      quantityDelta: params.quantityDelta,
      movementType: params.movementType,
      referenceType: params.referenceType,
      referenceId: params.referenceId == null ? null : cast(params.referenceId),
      date: params.date,
      notes: params.notes,
    });
  }
}
