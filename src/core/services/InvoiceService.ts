import { write, utils } from 'xlsx';
import { groupBy, orderBy, sumBy, toNumber, toString, uniq } from 'lodash';
import {
  InvoiceType,
  type Invoice,
  type InvoiceItem,
  type InvoiceItemView,
  type InvoiceView,
  type InvoicesExport,
  type InvoicesView,
  type PurchasesByVendorFilters,
  type PurchasesByVendorItem,
  type PurchasesByVendorResponse,
  type ReturnSaleInvoicePayload,
  type SalesByCustomerFilters,
  type SalesByCustomerItem,
  type SalesByCustomerResponse,
  type VendorStockPurchaseLine,
} from 'types';
import type { DatabaseDriver } from '../db/driver';
import type { SessionContext } from '../ports';
import { logErrors } from '../errorLogger';
import { getQuotationDisplayNumber } from '../../lib/quotationDisplay';
import { convertOrdinalDate } from '../utils/dateFormat';
import { JournalService } from './JournalService';
import { AccountService } from './AccountService';
import { PricingService } from './PricingService';
import { VendorStockService } from './VendorStockService';
import type { SqliteBoolean } from '../utils/sqlite';
import {
  cast,
  raise,
  normalizeSqliteBooleanRows,
  uncastBoolean,
} from '../utils/sqlite';
import {
  INVOICE_DISCOUNT_PERCENTAGE,
  DISCOUNT_ACCOUNT_NAME,
} from '../utils/constants';

/** values read from integer (0/1) or legacy boolean sqlite columns */
type SqliteBoolColumn = SqliteBoolean | boolean | number | null | undefined;

type InvoiceListSqliteRow = Omit<InvoicesView, 'isReturned' | 'isQuotation'> & {
  isReturned?: SqliteBoolColumn;
  isQuotation?: SqliteBoolColumn;
};

const INVOICE_LIST_SQLITE_BOOLEAN_KEYS = ['isReturned', 'isQuotation'] as const;

type PartyItemLine = {
  inventoryId: number;
  itemName: string;
  quantity: number;
  invoiceId: number;
  invoiceNumber: number;
  date: string;
  customerAccountId?: number;
  customerName?: string;
  customerCode?: string | number | null;
};

/** roll invoice lines into item rows with per-invoice qty breakdown. */
const rollupPartyItemLines = (lines: PartyItemLine[]) =>
  orderBy(
    Object.values(groupBy(lines, (row) => row.inventoryId)).map((itemLines) => {
      const first = itemLines[0];
      const invoices = orderBy(
        Object.values(
          groupBy(itemLines, (line) =>
            line.customerAccountId != null
              ? `${line.invoiceId}:${line.customerAccountId}`
              : String(line.invoiceId),
          ),
        ).map((invoiceLines) => ({
          invoiceId: invoiceLines[0].invoiceId,
          invoiceNumber: invoiceLines[0].invoiceNumber,
          date: invoiceLines[0].date,
          quantity: sumBy(invoiceLines, 'quantity'),
          ...(invoiceLines[0].customerAccountId != null
            ? {
                customerAccountId: invoiceLines[0].customerAccountId,
                customerName: invoiceLines[0].customerName ?? '',
                customerCode: invoiceLines[0].customerCode ?? null,
              }
            : {}),
        })),
        ['date', 'invoiceNumber'],
        ['asc', 'asc'],
      );
      return {
        inventoryId: first.inventoryId,
        itemName: first.itemName,
        quantity: sumBy(itemLines, 'quantity'),
        invoiceCount: invoices.length,
        invoices,
      };
    }),
    [(item) => item.itemName.toLowerCase()],
    ['asc'],
  );

/** one joined row per line from SQL.getInvoice before aggregating to InvoiceView */
type InvoiceDetailJoinedRowSqlite = InvoiceItemView & {
  id: number;
  date: string;
  invoiceNumber: number;
  invoiceType: InvoiceType;
  totalAmount?: number;
  extraDiscount?: number;
  extraDiscountAccountId?: number | null;
  invoiceHeaderAccountId?: number;
  biltyNumber?: string;
  cartons?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
  invoiceAccountName?: string;
  invoiceAccountNameUrdu?: string | null;
  invoiceAccountCode?: number | string | null;
  invoiceAccountAddress?: string | null;
  invoiceAccountAddressUrdu?: string | null;
  invoiceAccountGoodsName?: string | null;
  invoiceAccountGoodsNameUrdu?: string | null;
  invoiceAccountHeadName?: string | null;
  invoiceAccountHeadNameUrdu?: string | null;
  invoiceAccountHeadParentId?: number | null;
  itemRowAccountId?: number | null;
  accountCode?: number | string | null;
  accountNameUrdu?: string | null;
  isReturned?: SqliteBoolColumn;
  returnedAt?: string | null;
  returnReason?: string | null;
  isQuotation?: SqliteBoolColumn;
};

const SQL = {
  getNextInvoiceNumber: `
      SELECT (COALESCE(MAX(invoiceNumber), 0) + 1) AS 'invoiceNumber'
      FROM invoices
      WHERE invoiceType = ? AND COALESCE(isQuotation, 0) = 0
    `,
  getNextQuotationInvoiceNumber: `
      SELECT (COALESCE(MIN(invoiceNumber), 0) - 1) AS n
      FROM invoices
      WHERE invoiceType = ? AND COALESCE(isQuotation, 0) = 1
    `,
  insertInvoice: `
      INSERT INTO invoices (date, accountId, invoiceType, totalAmount, invoiceNumber, extraDiscount, biltyNumber, cartons, extraDiscountAccountId, isQuotation)
      VALUES (@date, @accountId, @invoiceType, @totalAmount, @invoiceNumber, @extraDiscount, @biltyNumber, @cartons, @extraDiscountAccountId, @isQuotation)
    `,
  finalizeQuotationConversion: `
      UPDATE invoices
      SET invoiceNumber = @invoiceNumber, isQuotation = 0
      WHERE id = @invoiceId
    `,
  // docs/derived-state-design.md §6 migration 028: "have" is a pure
  // informational read (shown to the user in the shortage error message,
  // gating whether a sale quotation may convert) that does not feed any
  // subsequent write's math — swapped to inventory_quantity_view (canon),
  // LEFT JOIN + COALESCE 0 for items with no recorded movements yet.
  aggregateInvoiceStockByLine: `
      SELECT
        ii.inventoryId AS inventoryId,
        SUM(ii.quantity) AS needQty,
        MAX(iv.name) AS itemName,
        MAX(COALESCE(iqv.quantity, 0)) AS haveQty
      FROM invoice_items ii
      JOIN inventory iv ON iv.id = ii.inventoryId
      LEFT JOIN inventory_quantity_view iqv ON iqv.inventoryId = iv.id
      WHERE ii.invoiceId = @invoiceId
      GROUP BY ii.inventoryId
    `,
  insertInvoiceItems: `
      INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId)
      VALUES (@invoiceId, @inventoryId, @quantity, (SELECT price FROM inventory WHERE id = @inventoryId), @discount, @accountId)
    `,
  updateInventoryItem: `
      UPDATE inventory
      SET quantity = quantity + ?
      WHERE id = ?
    `,
  // query detailed explanation:
  // 1. inner join invoices with account table to get the primary account name for each invoice
  // 2. left join invoice_items with account table to to include all invoices, even if they don't have invoice_items with an accountId
  // 3. left join account table with invoice_items to link the accountId to the account name
  // 4. combines all unique account names for an invoice into a single comma-separated string if multiple accounts are present for an invoice otherwise use the account name of the invoice.
  // 5. groups results by all non-aggregated columns, necessary because we're using GROUP_CONCAT, ensures we get one row per invoice with potentially multiple account names combined.
  getInvoices: `
      SELECT
        i.id,
        i.invoiceNumber,
        i.invoiceType,
        i.date,
        i.totalAmount,
        i.createdAt,
        i.updatedAt,
        COALESCE(
          NULLIF(GROUP_CONCAT(DISTINCT a2.code), ''),
          a.code
        ) AS 'accountCode',
        COALESCE(
          NULLIF(GROUP_CONCAT(DISTINCT a2.name), ''),
          a.name
        ) AS 'accountName',
        i.biltyNumber,
        i.cartons,
        COALESCE(i.isReturned, 0) AS isReturned,
        i.returnedAt,
        i.returnReason,
        COALESCE(i.isQuotation, 0) AS isQuotation,
        (SELECT COUNT(*) FROM journal j WHERE j.invoiceId = i.id) AS linkedJournalCount
      FROM invoices i
      JOIN account a ON i.accountId = a.id
      LEFT JOIN invoice_items ii ON i.id = ii.invoiceId AND ii.accountId IS NOT NULL
      LEFT JOIN account a2 ON ii.accountId = a2.id
      WHERE i.invoiceType = ? AND COALESCE(i.isQuotation, 0) = 0
      GROUP BY i.id, i.invoiceNumber, i.invoiceType, i.date, i.totalAmount, i.createdAt, i.updatedAt, a.code, a.name, i.biltyNumber, i.cartons, i.isReturned, i.returnedAt, i.returnReason, i.isQuotation
    `,
  getQuotationInvoices: `
      SELECT
        i.id,
        i.invoiceNumber,
        i.invoiceType,
        i.date,
        i.totalAmount,
        i.createdAt,
        i.updatedAt,
        COALESCE(
          NULLIF(GROUP_CONCAT(DISTINCT a2.code), ''),
          a.code
        ) AS 'accountCode',
        COALESCE(
          NULLIF(GROUP_CONCAT(DISTINCT a2.name), ''),
          a.name
        ) AS 'accountName',
        i.biltyNumber,
        i.cartons,
        COALESCE(i.isReturned, 0) AS isReturned,
        i.returnedAt,
        i.returnReason,
        COALESCE(i.isQuotation, 0) AS isQuotation,
        (SELECT COUNT(*) FROM journal j WHERE j.invoiceId = i.id) AS linkedJournalCount
      FROM invoices i
      JOIN account a ON i.accountId = a.id
      LEFT JOIN invoice_items ii ON i.id = ii.invoiceId AND ii.accountId IS NOT NULL
      LEFT JOIN account a2 ON ii.accountId = a2.id
      WHERE i.invoiceType = ? AND COALESCE(i.isQuotation, 0) = 1
      GROUP BY i.id, i.invoiceNumber, i.invoiceType, i.date, i.totalAmount, i.createdAt, i.updatedAt, a.code, a.name, i.biltyNumber, i.cartons, i.isReturned, i.returnedAt, i.returnReason, i.isQuotation
    `,
  getInvoice: `
      SELECT
        i.id,
        i.date,
        i.invoiceNumber,
        i.invoiceType,
        i.totalAmount,
        i.extraDiscount,
        i.extraDiscountAccountId,
        i.accountId AS invoiceHeaderAccountId,
        i.biltyNumber,
        i.cartons,
        i.createdAt,
        i.updatedAt,
        COALESCE(i.isReturned, 0) AS isReturned,
        i.returnedAt,
        i.returnReason,
        COALESCE(i.isQuotation, 0) AS isQuotation,
        a.name AS 'invoiceAccountName',
        a.nameUrdu AS 'invoiceAccountNameUrdu',
        a.code AS 'invoiceAccountCode',
        a.address AS 'invoiceAccountAddress',
        a.addressUrdu AS 'invoiceAccountAddressUrdu',
        a.goodsName AS 'invoiceAccountGoodsName',
        a.goodsNameUrdu AS 'invoiceAccountGoodsNameUrdu',
        headerChart.name AS 'invoiceAccountHeadName',
        headerChart.nameUrdu AS 'invoiceAccountHeadNameUrdu',
        headerChart.parentId AS 'invoiceAccountHeadParentId',
        ii.inventoryId,
        ii.quantity,
        ii.price,
        ii.discount,
        ii.accountId AS 'itemRowAccountId',
        iii.name as 'inventoryItemName',
        iii.description AS 'inventoryItemDescription',
        iii.descriptionUrdu AS 'inventoryItemDescriptionUrdu',
        it.name as 'itemTypeName',
        COALESCE(
          CASE WHEN ii.accountId IS NOT NULL THEN a2.name ELSE NULL END,
          a.name
        ) AS 'accountName',
        COALESCE(
          CASE WHEN ii.accountId IS NOT NULL THEN a2.nameUrdu ELSE NULL END,
          a.nameUrdu
        ) AS 'accountNameUrdu',
        COALESCE(
          CASE WHEN ii.accountId IS NOT NULL THEN a2.code ELSE NULL END,
          a.code
        ) AS 'accountCode'
      FROM invoices i
      JOIN account a ON i.accountId = a.id
      JOIN chart headerChart ON headerChart.id = a.chartId
      JOIN invoice_items ii ON i.id = ii.invoiceId
      JOIN inventory iii ON iii.id = ii.inventoryId
      LEFT JOIN item_types it ON it.id = iii.itemTypeId
      LEFT JOIN account a2 ON ii.accountId = a2.id AND ii.accountId IS NOT NULL
      WHERE i.id = @invoiceId
    `,
  doesInvoiceExist: `
      SELECT invoiceNumber, COALESCE(isQuotation, 0) AS isQuotation
      FROM invoices
      WHERE invoiceType = @invoiceType AND id = @invoiceId
      LIMIT 1
    `,
  adjacentInvoiceIdNext: `
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id > @invoiceId AND COALESCE(isQuotation, 0) = 0
      ORDER BY id ASC
      LIMIT 1
    `,
  adjacentInvoiceIdPrev: `
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id < @invoiceId AND COALESCE(isQuotation, 0) = 0
      ORDER BY id DESC
      LIMIT 1
    `,
  adjacentQuotationIdNext: `
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id > @invoiceId AND COALESCE(isQuotation, 0) = 1
      ORDER BY id ASC
      LIMIT 1
    `,
  adjacentQuotationIdPrev: `
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id < @invoiceId AND COALESCE(isQuotation, 0) = 1
      ORDER BY id DESC
      LIMIT 1
    `,
  getLastInvoiceNumber: `
      SELECT MAX(invoiceNumber) as lastInvoiceNumber
      FROM invoices
      WHERE invoiceType = ? AND COALESCE(isQuotation, 0) = 0
    `,
  getInvoiceIdsFromMinId: `
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id >= @fromInvoiceId AND COALESCE(isQuotation, 0) = 0
      ORDER BY id ASC
    `,
  getQuotationIdsFromMinId: `
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id >= @fromInvoiceId AND COALESCE(isQuotation, 0) = 1
      ORDER BY id ASC
    `,
  getSalePurchaseAccounts: `
          SELECT id, name
          FROM account
          WHERE LOWER(name) IN (?, ?)
        `,
  updateInvoiceBiltyAndCartons: `
      UPDATE invoices
      SET biltyNumber = @biltyNumber, cartons = @cartons
      WHERE id = @invoiceId
    `,
  deleteInvoiceItems: `
      DELETE FROM invoice_items WHERE invoiceId = @invoiceId
    `,
  getInvoiceItemsForUpdate: `
      SELECT
        ii.inventoryId,
        ii.quantity,
        COALESCE(ii.accountId, i.accountId) AS accountId
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE ii.invoiceId = @invoiceId
    `,
  getInvoiceHeader: `
      SELECT invoiceNumber, invoiceType, COALESCE(isQuotation, 0) AS isQuotation
      FROM invoices WHERE id = @invoiceId
    `,
  getPrevInvoiceDateForAccount: `
      SELECT date
      FROM invoices
      WHERE
        invoiceType = @invoiceType
        AND accountId = @accountId
        AND id != @invoiceId
        AND COALESCE(isQuotation, 0) = 0
        AND invoiceNumber < @invoiceNumber
      ORDER BY invoiceNumber DESC
      LIMIT 1
    `,
  getNextInvoiceDateForAccount: `
      SELECT date
      FROM invoices
      WHERE
        invoiceType = @invoiceType
        AND accountId = @accountId
        AND id != @invoiceId
        AND COALESCE(isQuotation, 0) = 0
        AND invoiceNumber > @invoiceNumber
      ORDER BY invoiceNumber ASC
      LIMIT 1
    `,
  updateInvoiceHeader: `
      UPDATE invoices SET
        date = @date,
        accountId = @accountId,
        totalAmount = @totalAmount,
        extraDiscount = @extraDiscount,
        biltyNumber = @biltyNumber,
        cartons = @cartons,
        extraDiscountAccountId = @extraDiscountAccountId
      WHERE id = @invoiceId
    `,
  // Write-path-only, unchanged by migration 028: both queries below feed
  // assertInventoryNonNegative, which runs immediately AFTER
  // updateInventoryItem's relative write to validate THAT stored write's
  // own result won't go negative — it must keep reading the stored
  // `inventory.quantity` column (the value the relative write just landed
  // on), or the guard would stop protecting the write it exists to guard.
  getInventoryQuantity: `
      SELECT quantity FROM inventory WHERE id = ?
    `,
  getInventoryNameQuantity: `
      SELECT name, quantity FROM inventory WHERE id = ?
    `,
  getInvoiceForReturn: `
      SELECT invoiceType, COALESCE(isReturned, 0) AS isReturned, COALESCE(isQuotation, 0) AS isQuotation
      FROM invoices WHERE id = @invoiceId
    `,
  markInvoiceReturned: `
      UPDATE invoices SET
        isReturned = 1,
        returnedAt = datetime('now', 'localtime'),
        returnReason = @returnReason
      WHERE id = @invoiceId
    `,
  getCurrentLocalDateTime: `
      SELECT datetime('now', 'localtime') AS returnedAt
    `,
  getInvoicesInDateRange: `
      SELECT i.id, i.invoiceNumber, i.invoiceType, i.date, i.totalAmount, a.name AS 'accountName', i.biltyNumber, i.cartons,
             SUM(ii.quantity) AS 'totalQuantity'
      FROM invoices i
      JOIN account a ON i.accountId = a.id
      JOIN invoice_items ii ON i.id = ii.invoiceId
      WHERE i.invoiceType = 'Sale' AND COALESCE(i.isQuotation, 0) = 0
        AND ( @startDate IS NULL OR @endDate IS NULL OR i.date BETWEEN @startDate AND @endDate )
      GROUP BY i.id
      ORDER BY i.invoiceNumber
    `,
  // sales performance report (getSalesPerformance) — static queries, unchanged from src/main/services/Invoice.service.ts
  salesPerfPostedTotals: `
        SELECT
          COUNT(id) AS invoiceCount,
          COALESCE(SUM(totalAmount), 0) AS totalAmount,
          COALESCE(AVG(totalAmount), 0) AS avgAmount
        FROM invoices
        WHERE invoiceType = 'Sale'
          AND isQuotation = 0
          AND isReturned = 0
          AND date >= ? AND date <= ?
      `,
  salesPerfPostedQty: `
        SELECT
          COALESCE(SUM(ii.quantity), 0) AS totalQty,
          COALESCE(AVG(ii.discount), 0) AS avgDiscount
        FROM invoices i
        JOIN invoice_items ii ON ii.invoiceId = i.id
        WHERE i.invoiceType = 'Sale'
          AND i.isQuotation = 0
          AND i.isReturned = 0
          AND i.date >= ? AND i.date <= ?
      `,
  salesPerfReturns: `
      SELECT
        COUNT(*) AS returnCount,
        COALESCE(SUM(i.totalAmount), 0) AS returnAmount
      FROM invoices i
      WHERE i.invoiceType = 'Sale'
        AND i.isReturned = 1
        AND i.returnedAt >= ? AND i.returnedAt <= ?
    `,
  salesPerfQuotationBacklogMetrics: `
      SELECT
        COUNT(*) AS quotationCount,
        COALESCE(SUM(i.totalAmount), 0) AS quotationAmount
      FROM invoices i
      WHERE i.invoiceType = 'Sale'
        AND i.isQuotation = 1
        AND i.isReturned = 0
    `,
  salesPerfTopGroupsByPolicy: `
        SELECT
          COALESCE(dp.name, 'No Policy') AS groupName,
          COALESCE(dp.id, -1) AS groupId,
          COALESCE(SUM(ii.quantity * ii.price * (1 - ii.discount / 100)), 0) AS totalAmount,
          COUNT(DISTINCT i.id) AS invoiceCount,
          COUNT(DISTINCT ii.accountId) AS customerCount
        FROM invoices i
        JOIN invoice_items ii ON ii.invoiceId = i.id
        JOIN account a ON a.id = ii.accountId
        LEFT JOIN discount_profiles dp ON dp.id = a.discountProfileId
        WHERE i.invoiceType = 'Sale'
          AND i.isQuotation = 0
          AND i.isReturned = 0
          AND i.date >= ? AND i.date <= ?
        GROUP BY a.discountProfileId
        ORDER BY totalAmount DESC

      `,
  salesPerfTopGroupsByAccount: `
        SELECT
          a.name AS groupName, a.id AS groupId, a.code AS groupCode,
          COALESCE(SUM(ii.quantity * ii.price * (1 - ii.discount / 100)), 0) AS totalAmount,
          COUNT(DISTINCT i.id) AS invoiceCount
        FROM invoices i
        JOIN invoice_items ii ON ii.invoiceId = i.id
        JOIN account a ON a.id = ii.accountId
        WHERE i.invoiceType = 'Sale'
          AND i.isQuotation = 0
          AND i.isReturned = 0
          AND i.date >= ? AND i.date <= ?
        GROUP BY ii.accountId
        ORDER BY totalAmount DESC

      `,
  salesPerfTopItems: `
      SELECT
        inv.name AS itemName, inv.id AS itemId,
        COALESCE(SUM(ii.quantity), 0) AS totalQty,
        COALESCE(SUM(ii.quantity * ii.price * (1 - ii.discount / 100)), 0) AS totalAmount
      FROM invoices i
      JOIN invoice_items ii ON ii.invoiceId = i.id
      JOIN inventory inv ON inv.id = ii.inventoryId
      WHERE i.invoiceType = 'Sale'
        AND i.isQuotation = 0
        AND i.isReturned = 0
        AND i.date >= ? AND i.date <= ?
      GROUP BY ii.inventoryId
      ORDER BY totalAmount DESC

    `,
  salesPerfReturnsDetail: `
      SELECT
        i.id, i.invoiceNumber, i.date, i.totalAmount, a.name AS customerName
      FROM invoices i
      JOIN account a ON a.id = i.accountId
      WHERE i.invoiceType = 'Sale'
        AND i.isReturned = 1
        AND i.returnedAt >= ? AND i.returnedAt <= ?
      ORDER BY i.returnedAt DESC
    `,
  salesPerfQuotationDetail: `
      SELECT
        i.id, i.invoiceNumber, i.date, i.totalAmount, a.name AS customerName
      FROM invoices i
      JOIN account a ON a.id = i.accountId
      WHERE i.invoiceType = 'Sale'
        AND i.isQuotation = 1
        AND i.isReturned = 0
      ORDER BY i.date DESC
    `,
  salesPerfPostedCompare: `
        SELECT
          COUNT(*) AS invoiceCount,
          COALESCE(SUM(i.totalAmount), 0) AS totalAmount,
          COALESCE(SUM(ii.quantity), 0) AS totalQty,
          COALESCE(AVG(i.totalAmount), 0) AS avgAmount,
          COALESCE(AVG(ii.discount), 0) AS avgDiscount
        FROM invoices i
        JOIN invoice_items ii ON ii.invoiceId = i.id
        WHERE i.invoiceType = 'Sale'
          AND i.isQuotation = 0
          AND i.isReturned = 0
          AND i.date >= ? AND i.date <= ?
      `,
  salesPerfReturnCompare: `
        SELECT
          COUNT(*) AS returnCount,
          COALESCE(SUM(i.totalAmount), 0) AS returnAmount
        FROM invoices i
        WHERE i.invoiceType = 'Sale'
          AND i.isReturned = 1
          AND i.returnedAt >= ? AND i.returnedAt <= ?
      `,
  salesPerfCompareTopGroupsByPolicy: `
          SELECT
            COALESCE(dp.name, 'No Policy') AS groupName,
            COALESCE(dp.id, -1) AS groupId,
            COALESCE(SUM(i.totalAmount), 0) AS totalAmount,
            COUNT(DISTINCT i.id) AS invoiceCount,
            COUNT(DISTINCT i.accountId) AS customerCount
          FROM invoices i
          JOIN account a ON a.id = i.accountId
          LEFT JOIN discount_profiles dp ON dp.id = a.discountProfileId
          JOIN invoice_items ii ON ii.invoiceId = i.id
          WHERE i.invoiceType = 'Sale'
            AND i.isQuotation = 0
            AND i.isReturned = 0
            AND i.date >= ? AND i.date <= ?
          GROUP BY a.discountProfileId
          ORDER BY totalAmount DESC

        `,
  salesPerfCompareTopGroupsByAccount: `
          SELECT
            a.name AS groupName, a.id AS groupId, a.code AS groupCode,
            COALESCE(SUM(i.totalAmount), 0) AS totalAmount,
            COUNT(DISTINCT i.id) AS invoiceCount
          FROM invoices i
          JOIN account a ON a.id = i.accountId
          JOIN invoice_items ii ON ii.invoiceId = i.id
          WHERE i.invoiceType = 'Sale'
            AND i.isQuotation = 0
            AND i.isReturned = 0
            AND i.date >= ? AND i.date <= ?
          GROUP BY i.accountId
          ORDER BY totalAmount DESC

        `,
  salesPerfCompareTopItems: `
        SELECT
          inv.name AS itemName, inv.id AS itemId,
          COALESCE(SUM(ii.quantity), 0) AS totalQty,
          COALESCE(SUM(ii.quantity * ii.price * (1 - ii.discount / 100)), 0) AS totalAmount
        FROM invoices i
        JOIN invoice_items ii ON ii.invoiceId = i.id
        JOIN inventory inv ON inv.id = ii.inventoryId
        WHERE i.invoiceType = 'Sale'
          AND i.isQuotation = 0
          AND i.isReturned = 0
          AND i.date >= ? AND i.date <= ?
        GROUP BY ii.inventoryId
        ORDER BY totalAmount DESC

      `,
  getPurchasesByVendorLines: `
      SELECT
        inv.id AS inventoryId,
        inv.name AS itemName,
        ii.quantity AS quantity,
        i.id AS invoiceId,
        i.invoiceNumber AS invoiceNumber,
        i.date AS date
      FROM invoices i
      JOIN invoice_items ii ON ii.invoiceId = i.id
      JOIN inventory inv ON inv.id = ii.inventoryId
      WHERE i.invoiceType = 'Purchase'
        AND COALESCE(i.isQuotation, 0) = 0
        AND COALESCE(i.isReturned, 0) = 0
        AND i.date >= @startDate
        AND i.date <= @endDate
        AND COALESCE(ii.accountId, i.accountId) = @vendorAccountId
    `,
};

/**
 * Platform-free port of src/main/services/Invoice.service.ts — identical SQL
 * and behavior, async against the DatabaseDriver, session and other core
 * services injected.
 */
@logErrors
export class InvoiceService {
  private db: DatabaseDriver;

  private session: SessionContext;

  private journalService: JournalService;

  private accountService: AccountService;

  private pricingService: PricingService;

  private vendorStockService: VendorStockService;

  constructor(deps: {
    db: DatabaseDriver;
    session: SessionContext;
    journalService: JournalService;
    accountService: AccountService;
    pricingService: PricingService;
    vendorStockService: VendorStockService;
  }) {
    this.db = deps.db;
    this.session = deps.session;
    this.journalService = deps.journalService;
    this.accountService = deps.accountService;
    this.pricingService = deps.pricingService;
    this.vendorStockService = deps.vendorStockService;
  }

  async getNextInvoiceNumber(
    invoiceType: InvoiceType,
  ): Promise<number | undefined> {
    const invoice = await this.db.get<{ invoiceNumber: number }>(
      SQL.getNextInvoiceNumber,
      [invoiceType],
    );
    return invoice?.invoiceNumber;
  }

  /**
   * persists a quotation: header + line items, negative placeholder invoiceNumber, no inventory or journals.
   */
  async insertQuotationInvoice(
    invoiceType: InvoiceType,
    invoice: Invoice,
  ): Promise<{ invoiceId: number }> {
    return this.db.transaction(async () => {
      return this.insertQuotationInvoiceWithoutTransaction(
        invoice,
        invoiceType,
      );
    });
  }

  async getQuotationInvoices(
    invoiceType: InvoiceType,
  ): Promise<InvoicesView[]> {
    const raw = await this.db.all<InvoiceListSqliteRow>(
      SQL.getQuotationInvoices,
      [invoiceType],
    );
    return normalizeSqliteBooleanRows(
      raw,
      INVOICE_LIST_SQLITE_BOOLEAN_KEYS,
    ) as InvoicesView[];
  }

  async updateQuotationInvoice(
    invoiceId: number,
    invoice: Invoice,
  ): Promise<void> {
    await this.db.transaction(async () => {
      await this.updateQuotationInvoiceWithoutTransaction(invoiceId, invoice);
    });
  }

  async convertQuotationInvoice(invoiceId: number): Promise<{
    invoiceNumber: number;
    vendorStockMessages?: string[];
  }> {
    return this.db.transaction(async () => {
      return this.convertQuotationInvoiceWithoutTransaction(invoiceId);
    });
  }

  async getInvoices(invoiceType: InvoiceType): Promise<InvoicesView[]> {
    const raw = await this.db.all<InvoiceListSqliteRow>(SQL.getInvoices, [
      invoiceType,
    ]);
    return normalizeSqliteBooleanRows(
      raw,
      INVOICE_LIST_SQLITE_BOOLEAN_KEYS,
    ) as InvoicesView[];
  }

  async getInvoice(invoiceId: number): Promise<InvoiceView> {
    const result = await this.db.all<InvoiceDetailJoinedRowSqlite>(
      SQL.getInvoice,
      { invoiceId: cast(invoiceId) },
    );

    const isSingleAccount =
      uniq(result.map((item) => item.accountName)).length === 1;
    const invoiceAccountCodes = uniq(
      result
        .map((item) => item.accountCode)
        .filter(
          (c): c is number | string =>
            (typeof c === 'number' && Number.isFinite(c)) ||
            typeof c === 'string',
        )
        .map((c) => String(c)),
    );
    const isSingleCode = invoiceAccountCodes.length <= 1;

    const res = result.reduce((prev, cur) => {
      if (!prev.id) {
        prev.id = cur.id;
        prev.date = cur.date;
        prev.invoiceNumber = cur.invoiceNumber;
        prev.invoiceType = cur.invoiceType;
        prev.totalAmount = cur.totalAmount;
        prev.extraDiscount = cur.extraDiscount;
        prev.biltyNumber = cur.biltyNumber;
        prev.cartons = cur.cartons ?? undefined;
        prev.createdAt = cur.createdAt;
        prev.updatedAt = cur.updatedAt;
        prev.extraDiscountAccountId = cur.extraDiscountAccountId ?? undefined;
        prev.invoiceHeaderAccountId = cur.invoiceHeaderAccountId;
        prev.isReturned = Boolean(uncastBoolean(cur.isReturned));
        prev.returnedAt = cur.returnedAt ?? null;
        prev.returnReason = cur.returnReason ?? null;
        prev.isQuotation = Boolean(uncastBoolean(cur.isQuotation));
        // for multi-account invoices, show all customer/vendor names and codes (similar to list view)
        prev.accountName = cur.invoiceAccountName ?? cur.accountName;
        prev.accountNameUrdu =
          cur.invoiceAccountNameUrdu ?? cur.accountNameUrdu ?? null;
        if (isSingleCode) {
          prev.accountCode =
            cur.invoiceAccountCode != null
              ? String(cur.invoiceAccountCode)
              : null;
        }
        prev.accountAddress = cur.invoiceAccountAddress ?? null;
        prev.accountAddressUrdu = cur.invoiceAccountAddressUrdu ?? null;
        prev.accountGoodsName = cur.invoiceAccountGoodsName ?? null;
        prev.accountGoodsNameUrdu = cur.invoiceAccountGoodsNameUrdu ?? null;
        prev.accountHeadName =
          cur.invoiceAccountHeadParentId != null &&
          Number(cur.invoiceAccountHeadParentId) > 0
            ? cur.invoiceAccountHeadName ?? null
            : null;
        prev.accountHeadNameUrdu =
          cur.invoiceAccountHeadParentId != null &&
          Number(cur.invoiceAccountHeadParentId) > 0
            ? cur.invoiceAccountHeadNameUrdu ?? null
            : null;
        prev.invoiceItems = [];
      }
      prev.invoiceItems.push({
        inventoryId: cur.inventoryId,
        quantity: cur.quantity,
        price: cur.price,
        discount: cur.discount,
        itemTypeName: cur.itemTypeName,
        discountedPrice: InvoiceService.getInvoiceItemTotal(cur, cur.price),
        inventoryItemName: cur.inventoryItemName,
        inventoryItemDescription: cur.inventoryItemDescription,
        inventoryItemDescriptionUrdu: cur.inventoryItemDescriptionUrdu ?? null,
        accountName: isSingleAccount ? undefined : cur.accountName,
        accountNameUrdu: isSingleAccount
          ? undefined
          : cur.accountNameUrdu ?? undefined,
        accountId:
          cur.itemRowAccountId != null && cur.itemRowAccountId > 0
            ? cur.itemRowAccountId
            : undefined,
      });
      return prev;
    }, {} as InvoiceView);

    if (!isSingleAccount) {
      res.accountName = uniq(result.map((r) => r.accountName)).join(', ');
      res.accountNameUrdu = uniq(
        result
          .map((r) => r.accountNameUrdu)
          .filter((n): n is string => Boolean(n?.trim())),
      ).join(', ');
    }
    if (!isSingleCode) {
      res.accountCode = invoiceAccountCodes.join(', ');
    }

    return res;
  }

  async insertInvoice(
    invoiceType: InvoiceType,
    invoice: Invoice,
  ): Promise<{
    invoiceId: number;
    nextInvoiceNumber: number;
    vendorStockMessages?: string[];
  }> {
    return this.db.transaction(async () => {
      return this.insertInvoiceWithoutTransaction(invoiceType, invoice);
    });
  }

  private async insertInvoiceWithoutTransaction(
    invoiceType: InvoiceType,
    invoice: Invoice,
  ): Promise<{
    invoiceId: number;
    nextInvoiceNumber: number;
    vendorStockMessages?: string[];
  }> {
    const invalid = { invoiceId: -1, nextInvoiceNumber: -1 };
    if (!invoice.invoiceNumber) {
      console.error('No invoice number found while inserting invoice', invoice);
      return invalid;
    }

    const totalAmount = invoice.totalAmount ?? 0;
    const extraDiscAcct =
      invoice.extraDiscountAccountId != null
        ? cast(toNumber(invoice.extraDiscountAccountId))
        : null;

    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    if (hasMultiple) {
      const primaryAccountId =
        toNumber(invoice.accountMapping.singleAccountId) || multipleIds[0];
      const invoiceResult = await this.db.run(SQL.insertInvoice, {
        date: invoice.date,
        accountId: primaryAccountId,
        invoiceType,
        totalAmount,
        invoiceNumber: invoice.invoiceNumber,
        extraDiscount: invoice.extraDiscount,
        biltyNumber: invoice.biltyNumber,
        cartons: invoice.cartons,
        extraDiscountAccountId: extraDiscAcct,
        isQuotation: 0,
      });
      const invoiceId = Number(invoiceResult.lastInsertRowid);

      const itemsByAccount = groupBy(invoice.invoiceItems, (item) => {
        return multipleIds[invoice.invoiceItems.indexOf(item)];
      });

      for (const [accountIdStr, groupItems] of Object.entries(itemsByAccount)) {
        const accountId = toNumber(accountIdStr);
        const groupTotalRaw = groupItems.reduce((sum, item) => {
          return (
            sum + InvoiceService.getInvoiceItemTotal(item, item.price || 0)
          );
        }, 0);
        // match UI: per-account group gross is rounded before invoice total / ledger
        const groupTotalAmount = Math.round(groupTotalRaw);
        const groupDiscountPercentage =
          // eslint-disable-next-line no-await-in-loop
          await this.pricingService.getPolicyDiscountPercentForInventoryIds(
            accountId,
            groupItems.map((item) => item.inventoryId),
          );

        for (const item of groupItems) {
          // eslint-disable-next-line no-await-in-loop
          await this.db.run(SQL.insertInvoiceItems, {
            invoiceId,
            inventoryId: item.inventoryId,
            quantity: item.quantity,
            discount: item.discount,
            accountId,
          });

          // eslint-disable-next-line no-await-in-loop
          await this.db.run(
            SQL.updateInventoryItem,
            invoiceType === InvoiceType.Sale
              ? [-item.quantity, item.inventoryId]
              : [item.quantity, item.inventoryId],
          );
        }

        // eslint-disable-next-line no-await-in-loop
        await this.createJournalEntry(
          invoiceType,
          invoice,
          accountId,
          groupTotalAmount,
          invoiceId,
          groupDiscountPercentage,
        );
      }

      const extraDiscount = toNumber(invoice.extraDiscount) || 0;
      if (extraDiscount > 0) {
        const discountAccount = await this.accountService.getAccountByName(
          DISCOUNT_ACCOUNT_NAME,
        );
        if (!discountAccount?.id) {
          raise(
            `"${DISCOUNT_ACCOUNT_NAME}" account not found. Create an expense account named "${DISCOUNT_ACCOUNT_NAME}" for extra discount.`,
          );
        }
        const creditAccountId =
          toNumber(invoice.extraDiscountAccountId) || multipleIds[0];
        if (!creditAccountId || !multipleIds.includes(creditAccountId)) {
          raise('Extra discount requires a valid account selection.');
        }
        await this.createExtraDiscountJournalEntry(
          invoiceType,
          invoice,
          discountAccount!.id,
          creditAccountId,
          extraDiscount,
          invoiceId,
        );
      }
      if (invoiceType === InvoiceType.Purchase) {
        const vendorStockMessages =
          await this.applyVendorStockForPostedPurchase(
            invoiceId,
            invoice,
            'purchase',
          );
        return {
          invoiceId,
          nextInvoiceNumber: invoice.invoiceNumber + 1,
          vendorStockMessages:
            vendorStockMessages.length > 0 ? vendorStockMessages : undefined,
        };
      }
      return {
        invoiceId,
        nextInvoiceNumber: invoice.invoiceNumber + 1,
      };
    }

    if (invoice.accountMapping.singleAccountId) {
      const accountId = invoice.accountMapping.singleAccountId;

      const invoiceResult = await this.db.run(SQL.insertInvoice, {
        date: invoice.date,
        accountId,
        invoiceType,
        totalAmount,
        invoiceNumber: invoice.invoiceNumber,
        extraDiscount: invoice.extraDiscount,
        biltyNumber: invoice.biltyNumber,
        cartons: invoice.cartons,
        extraDiscountAccountId: extraDiscAcct,
        isQuotation: 0,
      });
      const invoiceId = Number(invoiceResult.lastInsertRowid);

      await this.persistInvoiceItemsAndInventory(
        invoiceType,
        invoiceId,
        invoice,
      );

      if (invoiceType === InvoiceType.Sale) {
        await this.assertInventoryNonNegative(
          uniq(invoice.invoiceItems.map((i) => i.inventoryId)),
        );
      }

      let vendorStockMessages: string[] | undefined;
      if (invoiceType === InvoiceType.Purchase) {
        const messages = await this.applyVendorStockForPostedPurchase(
          invoiceId,
          invoice,
          'purchase',
        );
        if (messages.length > 0) vendorStockMessages = messages;
      }

      await this.postJournalsForPersistedInvoice(
        invoiceType,
        invoiceId,
        invoice,
      );

      return {
        invoiceId,
        nextInvoiceNumber: invoice.invoiceNumber + 1,
        vendorStockMessages,
      };
    }

    return invalid;
  }

  private async getNextQuotationPlaceholderNumber(
    invoiceType: InvoiceType,
  ): Promise<number> {
    const row = await this.db.get<{ n: number | null }>(
      SQL.getNextQuotationInvoiceNumber,
      [invoiceType],
    );
    return toNumber(row?.n ?? -1);
  }

  private async persistInvoiceLineItemsWithoutInventory(
    invoiceId: number,
    invoice: Invoice,
  ): Promise<void> {
    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    if (hasMultiple) {
      const itemsByAccount = groupBy(invoice.invoiceItems, (item) => {
        return multipleIds[invoice.invoiceItems.indexOf(item)];
      });
      for (const [accountIdStr, groupItems] of Object.entries(itemsByAccount)) {
        const accountId = toNumber(accountIdStr);
        for (const item of groupItems) {
          // eslint-disable-next-line no-await-in-loop
          await this.db.run(SQL.insertInvoiceItems, {
            invoiceId,
            inventoryId: item.inventoryId,
            quantity: item.quantity,
            discount: item.discount,
            accountId,
          });
        }
      }
      return;
    }

    if (invoice.accountMapping.singleAccountId) {
      const accountId = invoice.accountMapping.singleAccountId;
      for (const item of invoice.invoiceItems) {
        // eslint-disable-next-line no-await-in-loop
        await this.db.run(SQL.insertInvoiceItems, {
          invoiceId,
          inventoryId: item.inventoryId,
          quantity: item.quantity,
          discount: item.discount,
          accountId,
        });
      }
      return;
    }

    raise('Select a customer or vendor account');
  }

  private async insertQuotationInvoiceWithoutTransaction(
    invoice: Invoice,
    invoiceType: InvoiceType,
  ): Promise<{ invoiceId: number }> {
    const placeholder = await this.getNextQuotationPlaceholderNumber(
      invoiceType,
    );
    const totalAmount = invoice.totalAmount ?? 0;
    const extraDiscAcct =
      invoice.extraDiscountAccountId != null
        ? cast(toNumber(invoice.extraDiscountAccountId))
        : null;

    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    if (hasMultiple) {
      const primaryAccountId =
        toNumber(invoice.accountMapping.singleAccountId) || multipleIds[0];
      const invoiceResult = await this.db.run(SQL.insertInvoice, {
        date: invoice.date,
        accountId: primaryAccountId,
        invoiceType,
        totalAmount,
        invoiceNumber: placeholder,
        extraDiscount: invoice.extraDiscount,
        biltyNumber: invoice.biltyNumber,
        cartons: invoice.cartons,
        extraDiscountAccountId: extraDiscAcct,
        isQuotation: 1,
      });
      const invoiceId = Number(invoiceResult.lastInsertRowid);
      await this.persistInvoiceLineItemsWithoutInventory(invoiceId, invoice);
      return { invoiceId };
    }

    if (invoice.accountMapping.singleAccountId) {
      const accountId = invoice.accountMapping.singleAccountId;
      const invoiceResult = await this.db.run(SQL.insertInvoice, {
        date: invoice.date,
        accountId,
        invoiceType,
        totalAmount,
        invoiceNumber: placeholder,
        extraDiscount: invoice.extraDiscount,
        biltyNumber: invoice.biltyNumber,
        cartons: invoice.cartons,
        extraDiscountAccountId: extraDiscAcct,
        isQuotation: 1,
      });
      const invoiceId = Number(invoiceResult.lastInsertRowid);
      await this.persistInvoiceLineItemsWithoutInventory(invoiceId, invoice);
      return { invoiceId };
    }

    return raise('Select a customer or vendor account');
  }

  private async updateQuotationInvoiceWithoutTransaction(
    invoiceId: number,
    invoice: Invoice,
  ): Promise<void> {
    const header = await this.db.get<{
      invoiceNumber: number;
      invoiceType: string;
      isQuotation: number;
    }>(SQL.getInvoiceHeader, { invoiceId: cast(invoiceId) });
    const h =
      header &&
      (header.invoiceType === InvoiceType.Sale ||
        header.invoiceType === InvoiceType.Purchase)
        ? header
        : raise('Invoice not found');
    if (!uncastBoolean(h.isQuotation)) {
      raise('Only quotations can be updated with this action.');
    }

    const totalAmount = invoice.totalAmount ?? 0;
    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    const primaryAccountId = hasMultiple
      ? toNumber(invoice.accountMapping.singleAccountId) || multipleIds[0]
      : invoice.accountMapping.singleAccountId ??
        raise('Select a customer or vendor account');

    const extraDiscAcct =
      invoice.extraDiscountAccountId != null
        ? cast(toNumber(invoice.extraDiscountAccountId))
        : null;

    await this.db.run(SQL.deleteInvoiceItems, { invoiceId: cast(invoiceId) });

    await this.db.run(SQL.updateInvoiceHeader, {
      invoiceId: cast(invoiceId),
      date: invoice.date,
      accountId: primaryAccountId,
      totalAmount,
      extraDiscount: invoice.extraDiscount,
      biltyNumber: invoice.biltyNumber,
      cartons: invoice.cartons,
      extraDiscountAccountId: extraDiscAcct,
    });

    await this.persistInvoiceLineItemsWithoutInventory(invoiceId, invoice);
  }

  private async assertSaleQuotationStockAvailable(
    invoiceId: number,
  ): Promise<void> {
    const rows = await this.db.all<{
      inventoryId: number;
      needQty: number;
      itemName: string;
      haveQty: number;
    }>(SQL.aggregateInvoiceStockByLine, { invoiceId: cast(invoiceId) });

    const shortages: string[] = [];
    rows.forEach((r) => {
      const need = toNumber(r.needQty);
      const have = toNumber(r.haveQty);
      if (have < need) {
        shortages.push(`${r.itemName} (need ${need}, have ${have})`);
      }
    });

    if (shortages.length > 0) {
      raise(`Not enough stock for: ${shortages.join(', ')}`);
    }
  }

  private async applyPersistedSaleInventoryDecrements(
    invoiceId: number,
  ): Promise<void> {
    const items = await this.db.all<{
      inventoryId: number;
      quantity: number;
    }>(SQL.getInvoiceItemsForUpdate, { invoiceId: cast(invoiceId) });
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      await this.db.run(SQL.updateInventoryItem, [
        -item.quantity,
        item.inventoryId,
      ]);
    }
  }

  /** after converting a purchase quotation: line items already exist; add stock like a posted purchase */
  private async applyPersistedPurchaseInventoryIncrements(
    invoiceId: number,
  ): Promise<void> {
    const items = await this.db.all<{
      inventoryId: number;
      quantity: number;
    }>(SQL.getInvoiceItemsForUpdate, { invoiceId: cast(invoiceId) });
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      await this.db.run(SQL.updateInventoryItem, [
        item.quantity,
        item.inventoryId,
      ]);
    }
  }

  private static invoiceViewToInvoiceForPosting(
    view: InvoiceView,
    invoiceNumber: number,
  ): Invoice {
    const headerId =
      view.invoiceHeaderAccountId ?? raise('Invoice header account missing.');
    if (headerId <= 0) {
      raise('Invoice header account missing.');
    }

    const rowAccountIds: number[] = view.invoiceItems.map((it) => {
      const aid = it.accountId;
      if (aid != null && aid > 0) {
        return aid;
      }
      return headerId;
    });
    const uniqueRowAccounts = uniq(rowAccountIds);
    const hasSplit = uniqueRowAccounts.length > 1;
    const accountMapping = hasSplit
      ? {
          singleAccountId: headerId,
          multipleAccountIds: rowAccountIds,
        }
      : { singleAccountId: headerId, multipleAccountIds: [] as number[] };

    const invoiceItems: InvoiceItem[] = view.invoiceItems.map((it, idx) => {
      const invId = it.inventoryId;
      if (invId == null) {
        return raise('Line item missing inventoryId');
      }
      return {
        id: idx + 1,
        inventoryId: invId,
        quantity: it.quantity,
        discount: it.discount,
        price: it.price,
        discountedPrice: it.discountedPrice,
      };
    });

    return {
      id: view.id,
      date: view.date,
      invoiceNumber,
      invoiceType: view.invoiceType,
      totalAmount: view.totalAmount,
      extraDiscount: view.extraDiscount,
      extraDiscountAccountId: view.extraDiscountAccountId ?? undefined,
      biltyNumber: view.biltyNumber,
      cartons: view.cartons,
      accountMapping,
      invoiceItems,
    };
  }

  private async convertQuotationInvoiceWithoutTransaction(
    invoiceId: number,
  ): Promise<{
    invoiceNumber: number;
    vendorStockMessages?: string[];
  }> {
    const header = await this.db.get<{
      invoiceNumber: number;
      invoiceType: string;
      isQuotation: number;
    }>(SQL.getInvoiceHeader, { invoiceId: cast(invoiceId) });
    const h =
      header &&
      (header.invoiceType === InvoiceType.Sale ||
        header.invoiceType === InvoiceType.Purchase)
        ? header
        : raise('Invoice not found');
    if (!uncastBoolean(h.isQuotation)) {
      raise('Only quotations can be converted.');
    }

    const invType =
      h.invoiceType === InvoiceType.Purchase
        ? InvoiceType.Purchase
        : InvoiceType.Sale;

    if (invType === InvoiceType.Sale) {
      await this.assertSaleQuotationStockAvailable(invoiceId);
    }

    const nextRaw = await this.db.get<{ invoiceNumber: number }>(
      SQL.getNextInvoiceNumber,
      [invType],
    );
    const nextNum = toNumber(nextRaw?.invoiceNumber);
    if (!nextNum || nextNum < 1) {
      raise(
        invType === InvoiceType.Sale
          ? 'Could not allocate next sale invoice number.'
          : 'Could not allocate next purchase invoice number.',
      );
    }

    await this.db.run(SQL.finalizeQuotationConversion, {
      invoiceId: cast(invoiceId),
      invoiceNumber: cast(nextNum),
    });

    if (invType === InvoiceType.Sale) {
      await this.applyPersistedSaleInventoryDecrements(invoiceId);
      const touchedRows = await this.db.all<{ inventoryId: number }>(
        SQL.getInvoiceItemsForUpdate,
        { invoiceId: cast(invoiceId) },
      );
      const touchedIds = uniq(touchedRows.map((i) => i.inventoryId));
      await this.assertInventoryNonNegative(touchedIds);
    } else {
      await this.applyPersistedPurchaseInventoryIncrements(invoiceId);
    }

    const view = await this.getInvoice(invoiceId);
    const invoicePayload = InvoiceService.invoiceViewToInvoiceForPosting(
      view,
      nextNum,
    );
    if (invType === InvoiceType.Purchase) {
      const vendorStockMessages = await this.applyVendorStockForPostedPurchase(
        invoiceId,
        invoicePayload,
        'purchase',
      );
      await this.postJournalsForPersistedInvoice(
        invType,
        invoiceId,
        invoicePayload,
      );
      return {
        invoiceNumber: nextNum,
        vendorStockMessages:
          vendorStockMessages.length > 0 ? vendorStockMessages : undefined,
      };
    }
    await this.postJournalsForPersistedInvoice(
      invType,
      invoiceId,
      invoicePayload,
    );

    return { invoiceNumber: nextNum };
  }

  async getInvoicesInDateRange(
    startDate?: string,
    endDate?: string,
  ): Promise<InvoicesExport[]> {
    const result = await this.db.all<InvoicesExport>(
      SQL.getInvoicesInDateRange,
      {
        startDate: startDate ?? null,
        endDate: endDate ?? null,
      },
    );

    return result;
  }

  async exportSaleInvoices(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    startDate?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    endDate?: string,
  ): Promise<Buffer> {
    const invoices = await this.getInvoicesInDateRange();
    const worksheet = utils.json_to_sheet(
      invoices.map((invoice) => ({
        'Invoice Number': invoice.invoiceNumber,
        // Date: invoice.date,
        Date: convertOrdinalDate(invoice.date),
        'Total Quantity': invoice.totalQuantity,
        [`Price After ${INVOICE_DISCOUNT_PERCENTAGE}% Discount`]: toNumber(
          (
            invoice.totalAmount! *
            ((100 - INVOICE_DISCOUNT_PERCENTAGE) / 100)
          ).toFixed(0),
        ),
      })),
    );

    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Sale Invoices');

    const excelBuffer = write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    });
    return excelBuffer;
  }

  async doesInvoiceExists(
    invoiceId: number,
    invoiceType: InvoiceType,
  ): Promise<number> {
    const result = await this.db.get<{
      invoiceNumber: number;
      isQuotation?: number;
    }>(SQL.doesInvoiceExist, {
      invoiceId: cast(invoiceId),
      invoiceType,
    });
    if (!result) {
      return 0;
    }
    if (uncastBoolean(result.isQuotation)) {
      return 0;
    }
    return toNumber(result.invoiceNumber);
  }

  /** safe PDF filename stem for batch/print-to-PDF; null when row missing or type mismatch */
  async getInvoicePdfOutputBaseName(
    invoiceId: number,
    invoiceType: InvoiceType,
  ): Promise<string | null> {
    const result = await this.db.get<{
      invoiceNumber: number;
      isQuotation?: number;
    }>(SQL.doesInvoiceExist, {
      invoiceId: cast(invoiceId),
      invoiceType,
    });
    if (!result) {
      return null;
    }
    if (uncastBoolean(result.isQuotation)) {
      const display = getQuotationDisplayNumber(toNumber(result.invoiceNumber));
      return `quotation-${display}`;
    }
    return toString(toNumber(result.invoiceNumber));
  }

  /**
   * returns the primary key of the next/previous row of the same type by row id order
   * (not id±1, since another type or a gap can sit between ids).
   * `posted` skips quotations; `quotation` only walks quotation rows.
   */
  async getAdjacentInvoiceId(
    invoiceId: number,
    invoiceType: InvoiceType,
    direction: 'next' | 'previous',
    scope: 'posted' | 'quotation' = 'posted',
  ): Promise<number> {
    let sql: string;
    if (scope === 'quotation') {
      sql =
        direction === 'next'
          ? SQL.adjacentQuotationIdNext
          : SQL.adjacentQuotationIdPrev;
    } else {
      sql =
        direction === 'next'
          ? SQL.adjacentInvoiceIdNext
          : SQL.adjacentInvoiceIdPrev;
    }
    const row = await this.db.get<{ id: number }>(sql, {
      invoiceId: cast(invoiceId),
      invoiceType,
    });
    return row?.id ?? 0;
  }

  async getLastInvoiceNumber(invoiceType: InvoiceType): Promise<number> {
    const result = await this.db.get<{ lastInvoiceNumber: number }>(
      SQL.getLastInvoiceNumber,
      [invoiceType],
    );
    return result?.lastInvoiceNumber ?? 0;
  }

  /** ordered primary keys for batch print: same invoiceType from this row onward */
  async getInvoiceIdsFromMinId(
    invoiceType: InvoiceType,
    fromInvoiceId: number,
    scope: 'posted' | 'quotation' = 'posted',
  ): Promise<number[]> {
    const sql =
      scope === 'quotation'
        ? SQL.getQuotationIdsFromMinId
        : SQL.getInvoiceIdsFromMinId;
    const rows = await this.db.all<{ id: number }>(sql, {
      invoiceType,
      fromInvoiceId: cast(fromInvoiceId),
    });
    return rows.map((r) => toNumber(r.id));
  }

  async updateInvoiceBiltyAndCartons(
    invoiceId: number,
    biltyNumber: string | undefined,
    cartons: number | undefined,
  ): Promise<boolean> {
    const bilty =
      biltyNumber != null && String(biltyNumber).trim() !== ''
        ? cast(parseInt(String(biltyNumber).trim(), 10))
        : null;
    const result = await this.db.run(SQL.updateInvoiceBiltyAndCartons, {
      invoiceId: cast(invoiceId),
      biltyNumber: bilty,
      cartons: cartons != null ? cast(cartons) : null,
    });
    return Boolean(result.changes);
  }

  async updateInvoice(
    invoiceType: InvoiceType,
    invoiceId: number,
    invoice: Invoice,
  ): Promise<{ success: boolean; vendorStockMessages?: string[] }> {
    return this.db.transaction(async () => {
      const vendorStockMessages = await this.updateInvoiceWithoutTransaction(
        invoiceType,
        invoiceId,
        invoice,
      );
      return {
        success: true,
        vendorStockMessages:
          vendorStockMessages.length > 0 ? vendorStockMessages : undefined,
      };
    });
  }

  private async updateInvoiceWithoutTransaction(
    invoiceType: InvoiceType,
    invoiceId: number,
    invoice: Invoice,
  ): Promise<string[]> {
    const header = await this.db.get<{
      invoiceNumber: number;
      invoiceType: string;
      isQuotation?: number;
    }>(SQL.getInvoiceHeader, { invoiceId: cast(invoiceId) });
    const invoiceHeader =
      header && header.invoiceType === invoiceType
        ? header
        : raise('Invoice not found or type mismatch');
    if (uncastBoolean(invoiceHeader.isQuotation)) {
      raise(
        'Quotations cannot be edited as posted invoices. Use update quotation instead.',
      );
    }
    if (invoice.invoiceNumber !== invoiceHeader.invoiceNumber) {
      raise('Invoice number cannot be changed');
    }

    const oldRows = await this.db.all<{
      inventoryId: number;
      quantity: number;
      accountId: number;
    }>(SQL.getInvoiceItemsForUpdate, { invoiceId: cast(invoiceId) });

    const journalIds = await this.journalService.getJournalIdsByInvoiceId(
      invoiceId,
    );
    if (journalIds.length === 0) {
      raise(
        'This invoice has no linked journals (cannot edit safely). Re-enter the invoice or restore journal links.',
      );
    }

    await this.journalService.removeLedgerEffectOfJournals(journalIds);
    await this.journalService.deleteJournalsByIds(journalIds);

    await this.db.run(SQL.deleteInvoiceItems, { invoiceId: cast(invoiceId) });

    await this.updateInventoryForInvoiceLineItems(
      invoiceType,
      oldRows,
      'reverse',
    );

    if (invoiceType === InvoiceType.Purchase) {
      await this.applyVendorStockFromStoredLines(
        invoiceId,
        invoice.date,
        oldRows,
        'purchase_return',
      );
    }
    const totalAmount = invoice.totalAmount ?? 0;
    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    const primaryAccountId = hasMultiple
      ? toNumber(invoice.accountMapping.singleAccountId) || multipleIds[0]
      : invoice.accountMapping.singleAccountId ??
        raise('Select a customer or vendor account');

    if (invoiceType === InvoiceType.Sale) {
      await this.assertInvoiceDateWithinNeighborRangeForAccount(
        invoiceId,
        primaryAccountId,
        invoiceHeader.invoiceNumber,
        invoice.date,
      );
    }

    const extraDiscAcct =
      invoice.extraDiscountAccountId != null
        ? cast(toNumber(invoice.extraDiscountAccountId))
        : null;

    await this.db.run(SQL.updateInvoiceHeader, {
      invoiceId: cast(invoiceId),
      date: invoice.date,
      accountId: primaryAccountId,
      totalAmount,
      extraDiscount: invoice.extraDiscount,
      biltyNumber: invoice.biltyNumber,
      cartons: invoice.cartons,
      extraDiscountAccountId: extraDiscAcct,
    });

    await this.persistInvoiceItemsAndInventory(invoiceType, invoiceId, invoice);

    let vendorStockMessages: string[] = [];
    if (invoiceType === InvoiceType.Purchase) {
      vendorStockMessages = await this.applyVendorStockForPostedPurchase(
        invoiceId,
        invoice,
        'purchase',
      );
    }

    if (
      invoiceType === InvoiceType.Sale ||
      invoiceType === InvoiceType.Purchase
    ) {
      const touchedIds = uniq([
        ...oldRows.map((r) => r.inventoryId),
        ...invoice.invoiceItems.map((i) => i.inventoryId),
      ]);
      await this.assertInventoryNonNegative(touchedIds);
    }

    await this.postJournalsForPersistedInvoice(invoiceType, invoiceId, invoice);
    return vendorStockMessages;
  }

  private async updateInventoryForInvoiceLineItems(
    invoiceType: InvoiceType,
    items: { inventoryId: number; quantity: number }[],
    direction: 'post' | 'reverse',
  ): Promise<void> {
    for (const item of items) {
      let delta: number;
      if (invoiceType === InvoiceType.Sale) {
        delta = direction === 'post' ? -item.quantity : item.quantity;
      } else {
        delta = direction === 'post' ? item.quantity : -item.quantity;
      }
      // eslint-disable-next-line no-await-in-loop
      await this.db.run(SQL.updateInventoryItem, [delta, item.inventoryId]);
    }
  }

  private async assertInventoryNonNegative(
    inventoryIds: number[],
  ): Promise<void> {
    const problemLines: string[] = [];
    for (const id of uniq(inventoryIds)) {
      // eslint-disable-next-line no-await-in-loop
      const row = await this.db.get<{ name: string | null; quantity: number }>(
        SQL.getInventoryNameQuantity,
        [id],
      );
      if (!row || toNumber(row.quantity) >= 0) {
        continue;
      }
      const label = String(row.name ?? '').trim() || `item #${id}`;
      problemLines.push(
        `"${label}" (on-hand would be ${toNumber(row.quantity)})`,
      );
    }
    if (problemLines.length === 0) {
      return;
    }
    const listed = problemLines.join('; ');
    raise(
      `Stock would go below zero for: ${listed}. Adjust line quantities or correct stock on the Inventory page, then try again.`,
    );
  }

  /**
   * Sale edit rule: invoice date must stay within the same customer's adjacent invoice dates
   * (previous/next invoice by invoiceNumber).
   */
  private async assertInvoiceDateWithinNeighborRangeForAccount(
    invoiceId: number,
    accountId: number,
    invoiceNumber: number,
    newDateIso: string,
  ): Promise<void> {
    const normalize = (iso: string): number => {
      const d = new Date(iso);
      // normalize to local day to avoid timezone edge cases
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };

    const nextPrevParams = {
      accountId: cast(accountId),
      invoiceType: InvoiceType.Sale,
      invoiceNumber: cast(invoiceNumber),
      invoiceId: cast(invoiceId),
    };

    const prev = await this.db.get<{ date: string }>(
      SQL.getPrevInvoiceDateForAccount,
      nextPrevParams,
    );
    const next = await this.db.get<{ date: string }>(
      SQL.getNextInvoiceDateForAccount,
      nextPrevParams,
    );

    const newTime = normalize(newDateIso);
    const prevTime = prev?.date ? normalize(prev.date) : undefined;
    const nextTime = next?.date ? normalize(next.date) : undefined;
    const prevDateStr = prev?.date ?? '';
    const nextDateStr = next?.date ?? '';

    if (prevTime != null && newTime < prevTime) {
      raise(
        `Invoice date cannot be before the previous invoice date (${prevDateStr}).`,
      );
    }
    if (nextTime != null && newTime > nextTime) {
      raise(
        `Invoice date cannot be after the next invoice date (${nextDateStr}).`,
      );
    }
  }

  /**
   * Renderer helper for sale edit date bounds. Returns the previous and next invoice dates
   * (by invoiceNumber) for the given account, excluding this invoice itself.
   */
  async getSaleInvoiceEditDateBounds(
    invoiceId: number,
    accountId: number,
    invoiceNumber: number,
  ): Promise<{ prevDate: string | null; nextDate: string | null }> {
    const params = {
      accountId: cast(accountId),
      invoiceType: InvoiceType.Sale,
      invoiceNumber: cast(invoiceNumber),
      invoiceId: cast(invoiceId),
    };
    const prev = await this.db.get<{ date: string }>(
      SQL.getPrevInvoiceDateForAccount,
      params,
    );
    const next = await this.db.get<{ date: string }>(
      SQL.getNextInvoiceDateForAccount,
      params,
    );
    return {
      prevDate: prev?.date ?? null,
      nextDate: next?.date ?? null,
    };
  }

  /**
   * voids a sale invoice: removes linked journals and their ledger lines, restocks inventory,
   * and marks the invoice as returned (whole invoice only).
   */
  async returnSaleInvoice(
    invoiceId: number,
    options?: ReturnSaleInvoicePayload,
  ): Promise<void> {
    await this.db.transaction(async () => {
      await this.voidInvoiceReturnWithoutTransaction(
        invoiceId,
        InvoiceType.Sale,
        options,
      );
    });
  }

  /**
   * voids a purchase invoice: removes linked journals and ledger lines, reverses inventory
   * (stock added on purchase is removed), and marks the invoice as returned.
   */
  async returnPurchaseInvoice(
    invoiceId: number,
    options?: ReturnSaleInvoicePayload,
  ): Promise<void> {
    await this.db.transaction(async () => {
      await this.voidInvoiceReturnWithoutTransaction(
        invoiceId,
        InvoiceType.Purchase,
        options,
      );
    });
  }

  private async voidInvoiceReturnWithoutTransaction(
    invoiceId: number,
    expectedType: InvoiceType,
    options?: ReturnSaleInvoicePayload,
  ): Promise<void> {
    const row = await this.db.get(SQL.getInvoiceForReturn, {
      invoiceId: cast(invoiceId),
    });
    if (!row) {
      raise('Invoice not found.');
    }
    const header = row as {
      invoiceType: InvoiceType;
      isReturned: SqliteBoolColumn;
      isQuotation?: SqliteBoolColumn;
    };
    if (header.invoiceType !== expectedType) {
      raise(
        expectedType === InvoiceType.Sale
          ? 'Only sale invoices can be returned.'
          : 'Only purchase invoices can be returned.',
      );
    }
    if (uncastBoolean(header.isQuotation)) {
      raise('Cannot return a quotation. Convert it to an invoice first.');
    }
    if (uncastBoolean(header.isReturned)) {
      raise('This invoice has already been returned.');
    }

    const journalIds = await this.journalService.getJournalIdsByInvoiceId(
      invoiceId,
    );
    if (journalIds.length === 0) {
      raise('Cannot return this invoice: no linked journals were found.');
    }

    await this.journalService.removeLedgerEffectOfJournals(journalIds);
    await this.journalService.deleteJournalsByIds(journalIds);

    const items = await this.db.all<{
      inventoryId: number;
      quantity: number;
      accountId: number;
    }>(SQL.getInvoiceItemsForUpdate, { invoiceId: cast(invoiceId) });

    const inventoryDelta = expectedType === InvoiceType.Sale ? 1 : -1;

    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      await this.db.run(SQL.updateInventoryItem, [
        inventoryDelta * item.quantity,
        item.inventoryId,
      ]);
    }

    if (expectedType === InvoiceType.Purchase) {
      await this.assertInventoryNonNegative(
        uniq(items.map((item) => item.inventoryId)),
      );
    }

    const trimmed = options?.returnReason?.trim();
    const returnReason = trimmed != null && trimmed.length > 0 ? trimmed : null;

    await this.db.run(SQL.markInvoiceReturned, {
      invoiceId: cast(invoiceId),
      returnReason,
    });

    if (expectedType === InvoiceType.Purchase) {
      const returnedAtRow = await this.db.get<{ returnedAt: string }>(
        SQL.getCurrentLocalDateTime,
      );
      await this.applyVendorStockFromStoredLines(
        invoiceId,
        returnedAtRow?.returnedAt ?? new Date().toISOString(),
        items,
        'purchase_return',
      );
    }
  }

  private async persistInvoiceItemsAndInventory(
    invoiceType: InvoiceType,
    invoiceId: number,
    invoice: Invoice,
  ): Promise<void> {
    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    if (hasMultiple) {
      const itemsByAccount = groupBy(invoice.invoiceItems, (item) => {
        return multipleIds[invoice.invoiceItems.indexOf(item)];
      });

      for (const [accountIdStr, groupItems] of Object.entries(itemsByAccount)) {
        const accountId = toNumber(accountIdStr);
        for (const item of groupItems) {
          // eslint-disable-next-line no-await-in-loop
          await this.db.run(SQL.insertInvoiceItems, {
            invoiceId,
            inventoryId: item.inventoryId,
            quantity: item.quantity,
            discount: item.discount,
            accountId,
          });

          // eslint-disable-next-line no-await-in-loop
          await this.db.run(
            SQL.updateInventoryItem,
            invoiceType === InvoiceType.Sale
              ? [-item.quantity, item.inventoryId]
              : [item.quantity, item.inventoryId],
          );
        }
      }
      return;
    }

    if (invoice.accountMapping.singleAccountId) {
      const accountId = invoice.accountMapping.singleAccountId;
      for (const item of invoice.invoiceItems) {
        // eslint-disable-next-line no-await-in-loop
        await this.db.run(SQL.insertInvoiceItems, {
          invoiceId,
          inventoryId: item.inventoryId,
          quantity: item.quantity,
          discount: item.discount,
          accountId,
        });

        // eslint-disable-next-line no-await-in-loop
        await this.db.run(
          SQL.updateInventoryItem,
          invoiceType === InvoiceType.Sale
            ? [-item.quantity, item.inventoryId]
            : [item.quantity, item.inventoryId],
        );
      }
      return;
    }

    raise('Select a customer or vendor account');
  }

  private async postJournalsForPersistedInvoice(
    invoiceType: InvoiceType,
    invoiceId: number,
    invoice: Invoice,
  ): Promise<void> {
    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    if (hasMultiple) {
      const itemsByAccount = groupBy(invoice.invoiceItems, (item) => {
        return multipleIds[invoice.invoiceItems.indexOf(item)];
      });

      for (const [accountIdStr, groupItems] of Object.entries(itemsByAccount)) {
        const accountId = toNumber(accountIdStr);
        const groupTotalRaw = groupItems.reduce((sum, item) => {
          return (
            sum + InvoiceService.getInvoiceItemTotal(item, item.price || 0)
          );
        }, 0);
        const groupTotalAmount = Math.round(groupTotalRaw);
        const groupDiscountPercentage =
          // eslint-disable-next-line no-await-in-loop
          await this.pricingService.getPolicyDiscountPercentForInventoryIds(
            accountId,
            groupItems.map((item) => item.inventoryId),
          );

        // eslint-disable-next-line no-await-in-loop
        await this.createJournalEntry(
          invoiceType,
          invoice,
          accountId,
          groupTotalAmount,
          invoiceId,
          groupDiscountPercentage,
        );
      }

      const extraDiscount = toNumber(invoice.extraDiscount) || 0;
      if (extraDiscount > 0) {
        const discountAccount = await this.accountService.getAccountByName(
          DISCOUNT_ACCOUNT_NAME,
        );
        if (!discountAccount?.id) {
          raise(
            `"${DISCOUNT_ACCOUNT_NAME}" account not found. Create an expense account named "${DISCOUNT_ACCOUNT_NAME}" for extra discount.`,
          );
        }
        const creditAccountId =
          toNumber(invoice.extraDiscountAccountId) || multipleIds[0];
        if (!creditAccountId || !multipleIds.includes(creditAccountId)) {
          raise('Extra discount requires a valid account selection.');
        }
        await this.createExtraDiscountJournalEntry(
          invoiceType,
          invoice,
          discountAccount!.id,
          creditAccountId,
          extraDiscount,
          invoiceId,
        );
      }
      return;
    }

    if (invoice.accountMapping.singleAccountId) {
      const accountId = invoice.accountMapping.singleAccountId;
      const totalAmount = invoice.totalAmount ?? 0;
      const extraDiscount = toNumber(invoice.extraDiscount) || 0;
      if (extraDiscount > 0) {
        const discountAccount = await this.accountService.getAccountByName(
          DISCOUNT_ACCOUNT_NAME,
        );
        if (!discountAccount?.id) {
          raise(
            `"${DISCOUNT_ACCOUNT_NAME}" account not found. Create an expense account named "${DISCOUNT_ACCOUNT_NAME}" for extra discount.`,
          );
        }
        const discountAccountId = discountAccount!.id;
        const creditAccountId =
          toNumber(invoice.extraDiscountAccountId) ?? accountId;
        const discountPercentage =
          await this.pricingService.getPolicyDiscountPercentForInventoryIds(
            accountId,
            invoice.invoiceItems.map((item) => item.inventoryId),
          );
        await this.createJournalEntry(
          invoiceType,
          invoice,
          accountId,
          totalAmount + extraDiscount,
          invoiceId,
          discountPercentage,
        );
        await this.createExtraDiscountJournalEntry(
          invoiceType,
          invoice,
          discountAccountId,
          creditAccountId,
          extraDiscount,
          invoiceId,
        );
      } else {
        const discountPercentage =
          await this.pricingService.getPolicyDiscountPercentForInventoryIds(
            accountId,
            invoice.invoiceItems.map((item) => item.inventoryId),
          );
        await this.createJournalEntry(
          invoiceType,
          invoice,
          accountId,
          totalAmount,
          invoiceId,
          discountPercentage,
        );
      }
      return;
    }

    raise('Select a customer or vendor account');
  }

  private async createJournalEntry(
    invoiceType: InvoiceType,
    invoice: Invoice,
    accountId: number,
    amount: number,
    invoiceId: number,
    discountPercentage?: number,
  ): Promise<boolean> {
    const { debitAccountId, creditAccountId } =
      await this.getTransactionAccounts(invoiceType, accountId);

    return this.journalService.insertJournal({
      id: -1,
      date: invoice.date,
      isPosted: true,
      narration: `${invoiceType} Invoice #${invoice.invoiceNumber}`,
      billNumber: invoice.invoiceNumber,
      discountPercentage,
      invoiceId,
      journalEntries: [
        {
          id: -1,
          accountId: debitAccountId,
          creditAmount: 0,
          debitAmount: amount,
          journalId: 0,
        },
        {
          id: -1,
          accountId: creditAccountId,
          debitAmount: 0,
          creditAmount: amount,
          journalId: 0,
        },
      ],
    });
  }

  /**
   * Creates a journal entry for extra discount: Debit Discount (expense) account, Credit selected party account.
   * Requires a "Discount" named account to exist. creditAccountId is the account from which discount is applied (user-selected).
   */
  private async createExtraDiscountJournalEntry(
    invoiceType: InvoiceType,
    invoice: Invoice,
    discountAccountId: number,
    creditAccountId: number,
    extraDiscountAmount: number,
    invoiceId: number,
  ): Promise<boolean> {
    if (extraDiscountAmount <= 0) return true;
    return this.journalService.insertJournal({
      id: -1,
      date: invoice.date,
      isPosted: true,
      narration: `${invoiceType} Invoice #${invoice.invoiceNumber} (extra discount)`,
      billNumber: invoice.invoiceNumber,
      invoiceId,
      journalEntries: [
        {
          id: -1,
          accountId: discountAccountId,
          creditAmount: 0,
          debitAmount: extraDiscountAmount,
          journalId: 0,
        },
        {
          id: -1,
          accountId: creditAccountId,
          debitAmount: 0,
          creditAmount: extraDiscountAmount,
          journalId: 0,
        },
      ],
    });
  }

  private async getTransactionAccounts(
    invoiceType: InvoiceType,
    accountId: number,
  ): Promise<{
    debitAccountId: number;
    creditAccountId: number;
  }> {
    const accounts = await this.db.all<{ id: number; name: string }>(
      SQL.getSalePurchaseAccounts,
      [InvoiceType.Purchase.toLowerCase(), InvoiceType.Sale.toLowerCase()],
    );
    console.log('getTransactionAccounts', accounts);
    const purchaseAccount = accounts.find(
      (acc) => acc.name.toLowerCase() === InvoiceType.Purchase.toLowerCase(),
    );
    const salesAccount = accounts.find(
      (acc) => acc.name.toLowerCase() === InvoiceType.Sale.toLowerCase(),
    );

    const validPurchaseAccount =
      purchaseAccount ?? raise("Please create 'Purchase' account first");
    const validSalesAccount =
      salesAccount ?? raise("Please create 'Sale' account first");

    if (invoiceType === InvoiceType.Purchase) {
      return {
        debitAccountId: validPurchaseAccount.id, // Debit Purchase
        creditAccountId: accountId, // Credit Vendor
      };
    }
    return {
      debitAccountId: accountId, // Debit Cash/Customer
      creditAccountId: validSalesAccount.id, // Credit Sales
    };
  }

  private static getInvoiceItemTotal = (
    item: { quantity: number; discount: number },
    price: number,
  ): number => {
    const { quantity, discount } = item;
    return quantity * price * (1 - discount / 100);
  };

  /** Sales Performance report: posted sales behavior, trends, returns, and quotation backlog. */
  async getSalesPerformance(filters: {
    startDate: string;
    endDate: string;
    groupBy?: 'day' | 'week' | 'month';
    groupByPolicy?: boolean;
    compareStartDate?: string;
    compareEndDate?: string;
  }): Promise<Record<string, unknown>> {
    const {
      startDate,
      endDate,
      groupBy: timeGroup = 'day',
      groupByPolicy = false,
      compareStartDate,
      compareEndDate,
    } = filters;

    const sqlStartDate =
      startDate.length === 10 ? `${startDate}T00:00:00.000Z` : startDate;
    const sqlEndDate =
      endDate.length === 10 ? `${endDate}T23:59:59.999Z` : endDate;
    const sqlCompareStart =
      compareStartDate && compareStartDate.length === 10
        ? `${compareStartDate}T00:00:00.000Z`
        : compareStartDate;
    const sqlCompareEnd =
      compareEndDate && compareEndDate.length === 10
        ? `${compareEndDate}T23:59:59.999Z`
        : compareEndDate;

    let groupExpr: string;
    if (timeGroup === 'month') {
      groupExpr = "strftime('%Y-%m', i.date)";
    } else if (timeGroup === 'week') {
      groupExpr = "strftime('%Y-%W', i.date)";
    } else {
      groupExpr = 'date(i.date)';
    }

    // posted sale invoices (isQuotation=0, isReturned=0)
    const postedMetrics = {
      ...((await this.db.get<Record<string, number>>(
        SQL.salesPerfPostedTotals,
        [sqlStartDate, sqlEndDate],
      )) as Record<string, number>),
      ...((await this.db.get<Record<string, number>>(SQL.salesPerfPostedQty, [
        sqlStartDate,
        sqlEndDate,
      ])) as Record<string, number>),
    };

    // returned sale invoices (isReturned=1)
    const returnMetrics = (await this.db.get<Record<string, number>>(
      SQL.salesPerfReturns,
      [sqlStartDate, sqlEndDate],
    )) as Record<string, number>;

    // quotation backlog (isQuotation=1)
    const quotationMetrics = (await this.db.get<Record<string, number>>(
      SQL.salesPerfQuotationBacklogMetrics,
    )) as Record<string, number>;

    // time series
    const seriesRaw = await this.db.all<{
      period: string;
      amount: number;
      qty: number;
      invoiceCount: number;
    }>(
      `
      SELECT
        ${groupExpr} AS period,
        COALESCE(SUM(i.totalAmount), 0) AS amount,
        COALESCE(SUM(qty_table.qty), 0) AS qty,
        COUNT(i.id) AS invoiceCount
      FROM invoices i
      LEFT JOIN (
        SELECT invoiceId, SUM(quantity) AS qty
        FROM invoice_items
        GROUP BY invoiceId
      ) qty_table ON qty_table.invoiceId = i.id
      WHERE i.invoiceType = 'Sale'
        AND i.isQuotation = 0
        AND i.isReturned = 0
        AND i.date >= ? AND i.date <= ?
      GROUP BY ${groupExpr}
      ORDER BY period
    `,
      [sqlStartDate, sqlEndDate],
    );

    const series = [
      {
        dataPoints: seriesRaw.map((r) => ({ date: r.period, value: r.amount })),
        granularity: timeGroup,
      },
      {
        dataPoints: seriesRaw.map((r) => ({ date: r.period, value: r.qty })),
        granularity: timeGroup,
      },
      {
        dataPoints: seriesRaw.map((r) => ({
          date: r.period,
          value: r.invoiceCount,
        })),
        granularity: timeGroup,
      },
    ];

    // top customers or policies (unified shape)
    let topGroups: Array<{
      groupId: number;
      groupName: string;
      totalAmount: number;
      invoiceCount: number;
      customerCount?: number; // only present when groupByPolicy = true
    }>;

    if (groupByPolicy) {
      // Group by discount profile (policy). Handle NULL profiles as "No Policy"
      const rows = await this.db.all<{
        groupName: string;
        groupId: number;
        totalAmount: number;
        invoiceCount: number;
        customerCount: number;
      }>(SQL.salesPerfTopGroupsByPolicy, [sqlStartDate, sqlEndDate]);
      topGroups = rows.map((r) => ({
        groupId: r.groupId,
        groupName: r.groupName,
        totalAmount: r.totalAmount,
        invoiceCount: r.invoiceCount,
        customerCount: r.customerCount,
      }));
    } else {
      // Group by individual customer account (original behavior)
      const rows = await this.db.all<{
        groupName: string;
        groupId: number;
        groupCode: number | null;
        totalAmount: number;
        invoiceCount: number;
      }>(SQL.salesPerfTopGroupsByAccount, [sqlStartDate, sqlEndDate]);
      topGroups = rows.map((r) => ({
        groupId: r.groupId,
        groupName: r.groupName,
        groupCode: r.groupCode,
        totalAmount: r.totalAmount,
        invoiceCount: r.invoiceCount,
      }));
    }

    // top items
    const topItems = await this.db.all<{
      itemName: string;
      itemId: number;
      totalQty: number;
      totalAmount: number;
    }>(SQL.salesPerfTopItems, [sqlStartDate, sqlEndDate]);

    // returns detail
    const returnsDetail = await this.db.all<{
      id: number;
      invoiceNumber: number;
      date: string;
      totalAmount: number;
      customerName: string;
    }>(SQL.salesPerfReturnsDetail, [sqlStartDate, sqlEndDate]);

    // quotation backlog detail
    const quotationDetail = await this.db.all<{
      id: number;
      invoiceNumber: number;
      date: string;
      totalAmount: number;
      customerName: string;
    }>(SQL.salesPerfQuotationDetail);

    // rows for the report (top groups: either customers or policies)
    const rows = topGroups;

    const kpis = {
      postedSalesAmount: postedMetrics.totalAmount,
      qtySold: postedMetrics.totalQty,
      invoiceCount: postedMetrics.invoiceCount,
      avgInvoiceAmount: postedMetrics.avgAmount,
      avgDiscountPercent: postedMetrics.avgDiscount,
      returnedInvoiceCount: returnMetrics.returnCount,
      returnedAmount: returnMetrics.returnAmount,
      activeQuotationCount: quotationMetrics.quotationCount,
      activeQuotationAmount: quotationMetrics.quotationAmount,
    };

    // Comparison data
    const hasComparison =
      typeof compareStartDate === 'string' &&
      typeof compareEndDate === 'string' &&
      compareStartDate.length > 0 &&
      compareEndDate.length > 0;

    let comparisonKpis: Record<string, number> | undefined;
    let comparisonSeries: typeof series | undefined;
    let comparisonTopGroups: typeof topGroups | undefined;

    if (hasComparison) {
      const postedCompare = (await this.db.get<Record<string, number>>(
        SQL.salesPerfPostedCompare,
        [sqlCompareStart, sqlCompareEnd],
      )) as Record<string, number>;

      const returnCompare = (await this.db.get<Record<string, number>>(
        SQL.salesPerfReturnCompare,
        [sqlCompareStart, sqlCompareEnd],
      )) as Record<string, number>;

      comparisonKpis = {
        postedSalesAmount: postedCompare.totalAmount,
        qtySold: postedCompare.totalQty,
        invoiceCount: postedCompare.invoiceCount,
        avgInvoiceAmount: postedCompare.avgAmount,
        avgDiscountPercent: postedCompare.avgDiscount,
        returnedInvoiceCount: returnCompare.returnCount,
        returnedAmount: returnCompare.returnAmount,
      };

      // comparison series
      const seriesRawCompare = await this.db.all<{
        period: string;
        amount: number;
        qty: number;
        invoiceCount: number;
      }>(
        `
        SELECT
          ${groupExpr} AS period,
          COALESCE(SUM(i.totalAmount), 0) AS amount,
          COALESCE(SUM(ii.quantity), 0) AS qty,
          COUNT(DISTINCT i.id) AS invoiceCount
        FROM invoices i
        JOIN invoice_items ii ON ii.invoiceId = i.id
        WHERE i.invoiceType = 'Sale'
          AND i.isQuotation = 0
          AND i.isReturned = 0
          AND i.date >= ? AND i.date <= ?
        GROUP BY ${groupExpr}
        ORDER BY period
      `,
        [sqlCompareStart, sqlCompareEnd],
      );

      comparisonSeries = [
        {
          dataPoints: seriesRawCompare.map((r) => ({
            date: r.period,
            value: r.amount,
          })),
          granularity: timeGroup,
        },
        {
          dataPoints: seriesRawCompare.map((r) => ({
            date: r.period,
            value: r.qty,
          })),
          granularity: timeGroup,
        },
        {
          dataPoints: seriesRawCompare.map((r) => ({
            date: r.period,
            value: r.invoiceCount,
          })),
          granularity: timeGroup,
        },
      ];

      // comparison top groups
      if (groupByPolicy) {
        const compareRows = await this.db.all<{
          groupName: string;
          groupId: number;
          totalAmount: number;
          invoiceCount: number;
          customerCount: number;
        }>(SQL.salesPerfCompareTopGroupsByPolicy, [
          sqlCompareStart,
          sqlCompareEnd,
        ]);
        comparisonTopGroups = compareRows.map((r) => ({
          groupId: r.groupId,
          groupName: r.groupName,
          totalAmount: r.totalAmount,
          invoiceCount: r.invoiceCount,
          customerCount: r.customerCount,
        }));
      } else {
        const compareRows = await this.db.all<{
          groupName: string;
          groupId: number;
          groupCode: number | null;
          totalAmount: number;
          invoiceCount: number;
        }>(SQL.salesPerfCompareTopGroupsByAccount, [
          sqlCompareStart,
          sqlCompareEnd,
        ]);
        comparisonTopGroups = compareRows.map((r) => ({
          groupId: r.groupId,
          groupName: r.groupName,
          groupCode: r.groupCode,
          totalAmount: r.totalAmount,
          invoiceCount: r.invoiceCount,
        }));
      }
    }

    const currentTopItems = topItems.map((t) => ({
      itemId: t.itemId,
      itemName: t.itemName,
      totalQty: t.totalQty,
      totalAmount: t.totalAmount,
    }));

    // comparison top items with same keys
    let comparisonTopItems: typeof currentTopItems | undefined;
    if (hasComparison) {
      const compareItems = await this.db.all<{
        itemName: string;
        itemId: number;
        totalQty: number;
        totalAmount: number;
      }>(SQL.salesPerfCompareTopItems, [sqlCompareStart!, sqlCompareEnd!]);
      comparisonTopItems = compareItems.map((t) => ({
        itemId: t.itemId,
        itemName: t.itemName,
        totalQty: t.totalQty,
        totalAmount: t.totalAmount,
      }));
    }

    return {
      kpis,
      series,
      rows,
      topItems: currentTopItems,
      returns: returnsDetail.map((r) => ({
        invoiceId: r.id,
        invoiceNumber: r.invoiceNumber,
        date: r.date,
        customerName: r.customerName,
        amount: r.totalAmount,
      })),
      quotationBacklog: quotationDetail.map((q) => ({
        invoiceId: q.id,
        invoiceNumber: q.invoiceNumber,
        date: q.date,
        customerName: q.customerName,
        amount: q.totalAmount,
      })),
      anomalies: [],
      exportRows: rows,
      ...(hasComparison && comparisonKpis
        ? {
            comparisonKpis,
            comparisonSeries: comparisonSeries ?? [],
            comparisonRows: comparisonTopGroups ?? [],
            comparisonTopItems: comparisonTopItems ?? [],
          }
        : {}),
    };
  }

  /** items bought from a vendor in a date range (posted purchases only, qty only). */
  async getPurchasesByVendor(
    filters: PurchasesByVendorFilters,
  ): Promise<PurchasesByVendorResponse> {
    const { vendorAccountId, startDate, endDate } = filters;
    const sqlStartDate =
      startDate.length === 10 ? `${startDate}T00:00:00.000Z` : startDate;
    const sqlEndDate =
      endDate.length === 10 ? `${endDate}T23:59:59.999Z` : endDate;

    const vendor = (
      await this.accountService.getAccountsByIds([vendorAccountId])
    )[0];
    const vendorName = vendor?.name ?? '';

    const lines = await this.db.all<PartyItemLine>(
      SQL.getPurchasesByVendorLines,
      {
        vendorAccountId,
        startDate: sqlStartDate,
        endDate: sqlEndDate,
      },
    );

    const items: PurchasesByVendorItem[] = rollupPartyItemLines(lines);

    return {
      vendor: { id: vendorAccountId, name: vendorName },
      kpis: {
        itemCount: items.length,
        totalQty: sumBy(items, 'quantity'),
      },
      items,
    };
  }

  /** items sold to selected customer(s) in a date range (posted sales only, qty only). */
  async getSalesByCustomer(
    filters: SalesByCustomerFilters,
  ): Promise<SalesByCustomerResponse> {
    const { customerAccountIds, startDate, endDate } = filters;
    const uniqueIds = [
      ...new Set(
        customerAccountIds.filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];

    if (uniqueIds.length === 0) {
      return {
        customers: [],
        kpis: { itemCount: 0, totalQty: 0 },
        items: [],
      };
    }

    const sqlStartDate =
      startDate.length === 10 ? `${startDate}T00:00:00.000Z` : startDate;
    const sqlEndDate =
      endDate.length === 10 ? `${endDate}T23:59:59.999Z` : endDate;

    const accounts = await this.accountService.getAccountsByIds(uniqueIds);
    const customers = orderBy(
      uniqueIds.map((id) => {
        const account = accounts.find((row) => row.id === id);
        return { id, name: account?.name ?? '' };
      }),
      [(row) => row.name.toLowerCase()],
      ['asc'],
    );

    const placeholders = uniqueIds.map(() => '?').join(',');
    const lines = await this.db.all<PartyItemLine>(
      `
      SELECT
        inv.id AS inventoryId,
        inv.name AS itemName,
        ii.quantity AS quantity,
        i.id AS invoiceId,
        i.invoiceNumber AS invoiceNumber,
        i.date AS date,
        COALESCE(ii.accountId, i.accountId) AS customerAccountId,
        a.name AS customerName,
        a.code AS customerCode
      FROM invoices i
      JOIN invoice_items ii ON ii.invoiceId = i.id
      JOIN inventory inv ON inv.id = ii.inventoryId
      JOIN account a ON a.id = COALESCE(ii.accountId, i.accountId)
      WHERE i.invoiceType = 'Sale'
        AND COALESCE(i.isQuotation, 0) = 0
        AND COALESCE(i.isReturned, 0) = 0
        AND i.date >= ?
        AND i.date <= ?
        AND COALESCE(ii.accountId, i.accountId) IN (${placeholders})
    `,
      [sqlStartDate, sqlEndDate, ...uniqueIds],
    );

    const items: SalesByCustomerItem[] = rollupPartyItemLines(lines).map(
      (item) => ({
        ...item,
        invoices: item.invoices.map((line) => ({
          invoiceId: line.invoiceId,
          invoiceNumber: line.invoiceNumber,
          date: line.date,
          quantity: line.quantity,
          customerAccountId: line.customerAccountId ?? 0,
          customerName: line.customerName ?? '',
          customerCode: line.customerCode ?? null,
        })),
      }),
    );

    return {
      customers,
      kpis: {
        itemCount: items.length,
        totalQty: sumBy(items, 'quantity'),
      },
      items,
    };
  }

  private static buildVendorStockLinesFromInvoice(
    invoice: Invoice,
  ): VendorStockPurchaseLine[] {
    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    if (hasMultiple) {
      return invoice.invoiceItems.map((item, idx) => ({
        accountId: multipleIds[idx],
        inventoryId: item.inventoryId,
        quantity: item.quantity,
      }));
    }

    const accountId = invoice.accountMapping.singleAccountId;
    if (!accountId) return [];
    return invoice.invoiceItems.map((item) => ({
      accountId,
      inventoryId: item.inventoryId,
      quantity: item.quantity,
    }));
  }

  private async applyVendorStockForPostedPurchase(
    invoiceId: number,
    invoice: Invoice,
    direction: 'purchase' | 'purchase_return',
  ): Promise<string[]> {
    return this.vendorStockService.applyPurchaseEffect({
      invoiceId,
      date: invoice.date,
      lines: InvoiceService.buildVendorStockLinesFromInvoice(invoice),
      direction,
    });
  }

  private async applyVendorStockFromStoredLines(
    invoiceId: number,
    date: string,
    rows: { accountId: number; inventoryId: number; quantity: number }[],
    direction: 'purchase' | 'purchase_return',
  ): Promise<string[]> {
    return this.vendorStockService.applyPurchaseEffect({
      invoiceId,
      date,
      lines: rows.map((r) => ({
        accountId: r.accountId,
        inventoryId: r.inventoryId,
        quantity: r.quantity,
      })),
      direction,
    });
  }
}
