import { write, utils } from 'xlsx';
import { groupBy, orderBy, sumBy, toNumber, toString, uniq } from 'lodash';
import { journalDiscountLabel } from '../../lib/journalDiscountLabel';
import { invoiceLineAmount } from '../../lib/invoiceLineAmount';
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
  type CancelSaleReturnPayload,
  type SaleReturnSource,
  type SaleReturnSourceLine,
  type SalesByCustomerFilters,
  type SalesByCustomerItem,
  type SalesByCustomerResponse,
  type VendorStockPurchaseLine,
} from '../../types';
import type { DatabaseDriver } from '../db/driver';
import type { SessionContext } from '../ports';
import { logErrors } from '../errorLogger';
import { getQuotationDisplayNumber } from '../../lib/quotationDisplay';
import {
  SALE_RETURN_NUMBER_BASE,
  toDisplaySaleReturnNumber,
  toStoredSaleReturnNumber,
} from '../../lib/saleReturnNumber';
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
import { INVOICE_DISCOUNT_PERCENTAGE } from '../utils/constants';

/** values read from integer (0/1) or legacy boolean sqlite columns */
type SqliteBoolColumn = SqliteBoolean | boolean | number | null | undefined;

type InvoiceListSqliteRow = Omit<InvoicesView, 'isReturned' | 'isQuotation'> & {
  isReturned?: SqliteBoolColumn;
  isQuotation?: SqliteBoolColumn;
};

const INVOICE_LIST_SQLITE_BOOLEAN_KEYS = [
  'isReturned',
  'isQuotation',
  'isSaleReturn',
] as const;

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
  shippingCharges?: number;
  shippingAccountId?: number | null;
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
  invoiceAccountCity?: string | null;
  invoiceAccountCityUrdu?: string | null;
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
  isSaleReturn?: SqliteBoolColumn;
  sourceInvoiceId?: number | null;
  sourceInvoiceNumber?: number | null;
  invoiceItemId?: number;
  sourceInvoiceItemId?: number | null;
};

const SQL = {
  getNextInvoiceNumber: `
      SELECT (COALESCE(MAX(invoiceNumber), 0) + 1) AS 'invoiceNumber'
      FROM invoices
      WHERE invoiceType = ? AND COALESCE(isQuotation, 0) = 0
        AND COALESCE(isSaleReturn, 0) = 0
    `,
  getNextSaleReturnNumber: `
      SELECT (
        COALESCE(MAX(-invoiceNumber - ${SALE_RETURN_NUMBER_BASE}), 0) + 1
      ) AS invoiceNumber
      FROM invoices
      WHERE COALESCE(isSaleReturn, 0) = 1
    `,
  getNextQuotationInvoiceNumber: `
      SELECT (COALESCE(MIN(invoiceNumber), 0) - 1) AS n
      FROM invoices
      WHERE invoiceType = ? AND COALESCE(isQuotation, 0) = 1
    `,
  insertInvoice: `
      INSERT INTO invoices (date, accountId, invoiceType, totalAmount, invoiceNumber, extraDiscount, biltyNumber, cartons, extraDiscountAccountId, shippingCharges, shippingAccountId, isQuotation, isSaleReturn, sourceInvoiceId, returnReason)
      VALUES (@date, @accountId, @invoiceType, @totalAmount, @invoiceNumber, @extraDiscount, @biltyNumber, @cartons, @extraDiscountAccountId, @shippingCharges, @shippingAccountId, @isQuotation, @isSaleReturn, @sourceInvoiceId, @returnReason)
    `,
  finalizeQuotationConversion: `
      UPDATE invoices
      SET invoiceNumber = @invoiceNumber, isQuotation = 0
      WHERE id = @invoiceId
    `,
  // docs/derived-state-design.md §6 service cutover: "have" is a pure
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
      INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId, netPrice, sourceInvoiceItemId)
      VALUES (
        @invoiceId,
        @inventoryId,
        @quantity,
        COALESCE(@price, (SELECT price FROM inventory WHERE id = @inventoryId)),
        @discount,
        @accountId,
        @netPrice,
        @sourceInvoiceItemId
      )
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
        COALESCE(i.isSaleReturn, 0) AS isSaleReturn,
        i.sourceInvoiceId AS sourceInvoiceId,
        src.invoiceNumber AS sourceInvoiceNumber,
        (SELECT COUNT(*) FROM journal j WHERE j.invoiceId = i.id) AS linkedJournalCount
      FROM invoices i
      JOIN account a ON i.accountId = a.id
      LEFT JOIN invoices src ON src.id = i.sourceInvoiceId
      LEFT JOIN invoice_items ii ON i.id = ii.invoiceId AND ii.accountId IS NOT NULL
      LEFT JOIN account a2 ON ii.accountId = a2.id
      WHERE i.invoiceType = ? AND COALESCE(i.isQuotation, 0) = 0
        AND COALESCE(i.isSaleReturn, 0) = ?
      GROUP BY i.id, i.invoiceNumber, i.invoiceType, i.date, i.totalAmount, i.createdAt, i.updatedAt, a.code, a.name, i.biltyNumber, i.cartons, i.isReturned, i.returnedAt, i.returnReason, i.isQuotation, i.isSaleReturn, i.sourceInvoiceId, src.invoiceNumber
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
        i.shippingCharges,
        i.shippingAccountId,
        i.accountId AS invoiceHeaderAccountId,
        i.biltyNumber,
        i.cartons,
        i.createdAt,
        i.updatedAt,
        COALESCE(i.isReturned, 0) AS isReturned,
        i.returnedAt,
        i.returnReason,
        COALESCE(i.isQuotation, 0) AS isQuotation,
        COALESCE(i.isSaleReturn, 0) AS isSaleReturn,
        i.sourceInvoiceId AS sourceInvoiceId,
        src.invoiceNumber AS sourceInvoiceNumber,
        a.name AS 'invoiceAccountName',
        a.nameUrdu AS 'invoiceAccountNameUrdu',
        a.code AS 'invoiceAccountCode',
        a.address AS 'invoiceAccountAddress',
        a.addressUrdu AS 'invoiceAccountAddressUrdu',
        a.city AS 'invoiceAccountCity',
        a.cityUrdu AS 'invoiceAccountCityUrdu',
        a.goodsName AS 'invoiceAccountGoodsName',
        a.goodsNameUrdu AS 'invoiceAccountGoodsNameUrdu',
        headerChart.name AS 'invoiceAccountHeadName',
        headerChart.nameUrdu AS 'invoiceAccountHeadNameUrdu',
        headerChart.parentId AS 'invoiceAccountHeadParentId',
        ii.id AS invoiceItemId,
        ii.sourceInvoiceItemId AS sourceInvoiceItemId,
        ii.inventoryId,
        ii.quantity,
        ii.price,
        ii.discount,
        ii.netPrice,
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
      LEFT JOIN invoices src ON src.id = i.sourceInvoiceId
      JOIN invoice_items ii ON i.id = ii.invoiceId
      JOIN inventory iii ON iii.id = ii.inventoryId
      LEFT JOIN item_types it ON it.id = iii.itemTypeId
      LEFT JOIN account a2 ON ii.accountId = a2.id AND ii.accountId IS NOT NULL
      WHERE i.id = @invoiceId
    `,
  doesInvoiceExist: `
      SELECT invoiceNumber, COALESCE(isQuotation, 0) AS isQuotation,
        COALESCE(isSaleReturn, 0) AS isSaleReturn
      FROM invoices
      WHERE invoiceType = @invoiceType AND id = @invoiceId
      LIMIT 1
    `,
  adjacentInvoiceIdNext: `
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id > @invoiceId AND COALESCE(isQuotation, 0) = 0
        AND COALESCE(isSaleReturn, 0) = 0
      ORDER BY id ASC
      LIMIT 1
    `,
  adjacentInvoiceIdPrev: `
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id < @invoiceId AND COALESCE(isQuotation, 0) = 0
        AND COALESCE(isSaleReturn, 0) = 0
      ORDER BY id DESC
      LIMIT 1
    `,
  adjacentSaleReturnIdNext: `
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id > @invoiceId AND COALESCE(isSaleReturn, 0) = 1
      ORDER BY id ASC
      LIMIT 1
    `,
  adjacentSaleReturnIdPrev: `
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id < @invoiceId AND COALESCE(isSaleReturn, 0) = 1
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
        AND COALESCE(isSaleReturn, 0) = 0
    `,
  getInvoiceIdsFromMinId: `
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id >= @fromInvoiceId AND COALESCE(isQuotation, 0) = 0
        AND COALESCE(isSaleReturn, 0) = 0
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
        ii.id,
        ii.inventoryId,
        ii.quantity,
        COALESCE(ii.accountId, i.accountId) AS accountId,
        COALESCE((
          SELECT SUM(ri.quantity)
          FROM invoice_items ri
          JOIN invoices r ON r.id = ri.invoiceId
          WHERE ri.sourceInvoiceItemId = ii.id
            AND COALESCE(r.isSaleReturn, 0) = 1
            AND COALESCE(r.isReturned, 0) = 0
        ), 0) AS returnedQty
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE ii.invoiceId = @invoiceId
      ORDER BY ii.id
    `,
  getInvoiceHeader: `
      SELECT invoiceNumber, invoiceType, COALESCE(isQuotation, 0) AS isQuotation,
        COALESCE(isSaleReturn, 0) AS isSaleReturn, sourceInvoiceId
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
        AND COALESCE(isSaleReturn, 0) = 0
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
        AND COALESCE(isSaleReturn, 0) = 0
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
        extraDiscountAccountId = @extraDiscountAccountId,
        shippingCharges = @shippingCharges,
        shippingAccountId = @shippingAccountId
      WHERE id = @invoiceId
    `,
  // Write-path-only, unchanged by the read-side cutover: both queries below feed
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
      SELECT invoiceType, COALESCE(isReturned, 0) AS isReturned, COALESCE(isQuotation, 0) AS isQuotation,
        COALESCE(isSaleReturn, 0) AS isSaleReturn
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
        AND COALESCE(i.isSaleReturn, 0) = 0
        AND ( @startDate IS NULL OR @endDate IS NULL OR i.date BETWEEN @startDate AND @endDate )
      GROUP BY i.id
      ORDER BY i.invoiceNumber
    `,
  // sales performance report (getSalesPerformance) — static queries
  salesPerfPostedTotals: `
        SELECT
          COUNT(id) AS invoiceCount,
          COALESCE(SUM(totalAmount), 0) AS totalAmount,
          COALESCE(AVG(totalAmount), 0) AS avgAmount
        FROM invoices
        WHERE invoiceType = 'Sale'
          AND isQuotation = 0
          AND isReturned = 0
          AND COALESCE(isSaleReturn, 0) = 0
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
          AND COALESCE(i.isSaleReturn, 0) = 0
          AND i.date >= ? AND i.date <= ?
      `,
  salesPerfReturns: `
      SELECT
        COUNT(*) AS returnCount,
        COALESCE(SUM(amount), 0) AS returnAmount
      FROM (
        SELECT i.totalAmount AS amount
        FROM invoices i
        WHERE i.invoiceType = 'Sale'
          AND i.isReturned = 1
          AND COALESCE(i.isSaleReturn, 0) = 0
          AND i.returnedAt >= ? AND i.returnedAt <= ?
        UNION ALL
        SELECT i.totalAmount AS amount
        FROM invoices i
        WHERE COALESCE(i.isSaleReturn, 0) = 1
          AND COALESCE(i.isReturned, 0) = 0
          AND i.date >= ? AND i.date <= ?
      )
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
        COALESCE(SUM(CASE WHEN COALESCE(i.isSaleReturn, 0) = 1 THEN -ii.quantity ELSE ii.quantity END), 0) AS totalQty,
        COALESCE(SUM(CASE WHEN COALESCE(i.isSaleReturn, 0) = 1 THEN -1 ELSE 1 END * ii.quantity * ii.price * (1 - ii.discount / 100)), 0) AS totalAmount
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
      SELECT id, invoiceNumber, date, totalAmount, customerName
      FROM (
        SELECT
          i.id AS id,
          i.invoiceNumber AS invoiceNumber,
          i.date AS date,
          i.totalAmount AS totalAmount,
          a.name AS customerName,
          i.returnedAt AS sortAt
        FROM invoices i
        JOIN account a ON a.id = i.accountId
        WHERE i.invoiceType = 'Sale'
          AND i.isReturned = 1
          AND COALESCE(i.isSaleReturn, 0) = 0
          AND i.returnedAt >= ? AND i.returnedAt <= ?
        UNION ALL
        SELECT
          i.id AS id,
          (-i.invoiceNumber - ${SALE_RETURN_NUMBER_BASE}) AS invoiceNumber,
          i.date AS date,
          i.totalAmount AS totalAmount,
          a.name AS customerName,
          i.date AS sortAt
        FROM invoices i
        JOIN account a ON a.id = i.accountId
        WHERE COALESCE(i.isSaleReturn, 0) = 1
          AND COALESCE(i.isReturned, 0) = 0
          AND i.date >= ? AND i.date <= ?
      )
      ORDER BY sortAt DESC
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
          COALESCE(SUM(amount), 0) AS returnAmount
        FROM (
          SELECT i.totalAmount AS amount
          FROM invoices i
          WHERE i.invoiceType = 'Sale'
            AND i.isReturned = 1
            AND COALESCE(i.isSaleReturn, 0) = 0
            AND i.returnedAt >= ? AND i.returnedAt <= ?
          UNION ALL
          SELECT i.totalAmount AS amount
          FROM invoices i
          WHERE COALESCE(i.isSaleReturn, 0) = 1
            AND COALESCE(i.isReturned, 0) = 0
            AND i.date >= ? AND i.date <= ?
        )
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
  getSaleBillsForAccountIdsInRange: `
      SELECT
        COALESCE(ii.accountId, i.accountId) AS accountId,
        i.invoiceNumber AS invoiceNumber,
        i.date AS date,
        -- posted debit is what the ledger holds. recomputing from the
        -- discount percent drifts by a rupee on a net-price line, and the
        -- sheet would call that gap an opening balance
        COALESCE(
          posted.amount,
          ROUND(
            SUM(
              CASE
                WHEN ii.netPrice IS NOT NULL THEN ii.quantity * ii.netPrice
                ELSE ii.quantity * ii.price * (1 - ii.discount / 100.0)
              END
            ),
            0
          )
        ) AS amount,
        posted.discountPercentage AS discountPercentage
      FROM invoices i
      JOIN invoice_items ii ON ii.invoiceId = i.id
      LEFT JOIN (
        SELECT
          j.invoiceId AS invoiceId,
          je.accountId AS accountId,
          SUM(je.debitAmount) AS amount,
          MAX(j.discountPercentage) AS discountPercentage
        FROM journal j
        JOIN journal_entry je ON je.journalId = j.id AND je.debitAmount > 0
        GROUP BY j.invoiceId, je.accountId
      ) posted
        ON posted.invoiceId = i.id
       AND posted.accountId = COALESCE(ii.accountId, i.accountId)
      WHERE i.invoiceType = 'Sale'
        AND COALESCE(i.isQuotation, 0) = 0
        AND COALESCE(i.isReturned, 0) = 0
        AND COALESCE(i.isSaleReturn, 0) = 0
        AND COALESCE(ii.accountId, i.accountId) IN (
          SELECT CAST(j.value AS INTEGER)
          FROM json_each(@accountIdsJson) AS j
        )
        AND (
          @startDate IS NULL
          OR (
            CASE
              WHEN length(i.date) = 10 THEN i.date
              ELSE date(datetime(i.date, 'localtime'))
            END
          ) >= @startDate
        )
        AND (
          CASE
            WHEN length(i.date) = 10 THEN i.date
            ELSE date(datetime(i.date, 'localtime'))
          END
        ) <= @endDate
      GROUP BY
        COALESCE(ii.accountId, i.accountId),
        i.invoiceNumber,
        i.date,
        posted.amount,
        posted.discountPercentage
      ORDER BY (CASE WHEN length(i.date) = 10 THEN i.date ELSE date(datetime(i.date, 'localtime')) END) DESC, i.invoiceNumber DESC
    `,
};

/**
 * Invoice lifecycle (sale/purchase, return, quotation). Async against
 * DatabaseDriver, session and sibling core services injected.
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

  /**
   * sale bills in an inclusive local-date range, keyed by the account that owns the lines.
   * amount is that account's line total on the bill. the sheet adds tier portions of the same bill.
   * quotations and returned invoices are left out.
   */
  async getSaleBillsForAccountIdsInRange(
    accountIds: number[],
    startDate: string | null,
    endDate: string,
  ): Promise<
    Record<
      number,
      Array<{
        invoiceNumber: number;
        date: string;
        amount: number;
        /** journal discount label, same value bills aging shows as Bill % */
        discountPercentage?: number | string;
      }>
    >
  > {
    const unique = [
      ...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0)),
    ].sort((a, b) => a - b);
    if (unique.length === 0) return {};
    const rows = await this.db.all<{
      accountId: number;
      invoiceNumber: number;
      date: string;
      amount: number;
      discountPercentage: number | string | null;
    }>(SQL.getSaleBillsForAccountIdsInRange, {
      accountIdsJson: JSON.stringify(unique),
      startDate: startDate ?? null,
      endDate,
    });
    const out: Record<
      number,
      Array<{
        invoiceNumber: number;
        date: string;
        amount: number;
        discountPercentage?: number | string;
      }>
    > = {};
    for (const row of rows) {
      const bucket = out[row.accountId] ?? [];
      bucket.push({
        invoiceNumber: row.invoiceNumber,
        date: row.date,
        amount: row.amount ?? 0,
        ...(row.discountPercentage == null || row.discountPercentage === ''
          ? {}
          : { discountPercentage: row.discountPercentage }),
      });
      out[row.accountId] = bucket;
    }
    return out;
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

  async getNextSaleReturnNumber(): Promise<number> {
    const invoice = await this.db.get<{ invoiceNumber: number }>(
      SQL.getNextSaleReturnNumber,
    );
    return invoice?.invoiceNumber ?? 1;
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
    return this.listInvoices(invoiceType, false);
  }

  async getSaleReturns(): Promise<InvoicesView[]> {
    return this.listInvoices(InvoiceType.Sale, true);
  }

  private async listInvoices(
    invoiceType: InvoiceType,
    saleReturns: boolean,
  ): Promise<InvoicesView[]> {
    const raw = await this.db.all<InvoiceListSqliteRow>(SQL.getInvoices, [
      invoiceType,
      saleReturns ? 1 : 0,
    ]);
    const rows = normalizeSqliteBooleanRows(
      raw,
      INVOICE_LIST_SQLITE_BOOLEAN_KEYS,
    ) as InvoicesView[];
    return rows.map((row) =>
      row.isSaleReturn
        ? {
            ...row,
            invoiceNumber: toDisplaySaleReturnNumber(
              toNumber(row.invoiceNumber),
            ),
          }
        : row,
    );
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
        prev.shippingCharges = cur.shippingCharges;
        prev.shippingAccountId = cur.shippingAccountId ?? undefined;
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
        prev.isSaleReturn = Boolean(uncastBoolean(cur.isSaleReturn));
        prev.sourceInvoiceId = cur.sourceInvoiceId ?? null;
        prev.sourceInvoiceNumber = cur.sourceInvoiceNumber ?? null;
        if (prev.isSaleReturn) {
          prev.invoiceNumber = toDisplaySaleReturnNumber(cur.invoiceNumber);
        }
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
        prev.accountCity = cur.invoiceAccountCity ?? null;
        prev.accountCityUrdu = cur.invoiceAccountCityUrdu ?? null;
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
        netPrice: cur.netPrice ?? null,
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
        sourceInvoiceItemId: cur.sourceInvoiceItemId ?? undefined,
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

    const linkedReturns = await this.db.all<{
      id: number;
      invoiceNumber: number;
      date: string;
      totalAmount: number;
      returnReason: string | null;
      isReturned: SqliteBoolColumn;
    }>(
      `
      SELECT id, invoiceNumber, date, totalAmount, returnReason,
        COALESCE(isReturned, 0) AS isReturned
      FROM invoices
      WHERE sourceInvoiceId = ?
        AND COALESCE(isSaleReturn, 0) = 1
      ORDER BY date, id
    `,
      [invoiceId],
    );
    res.saleReturns = linkedReturns.map((row) => ({
      id: row.id,
      date: row.date,
      totalAmount: row.totalAmount,
      invoiceNumber: toDisplaySaleReturnNumber(row.invoiceNumber),
      returnReason: row.returnReason ?? null,
      isReturned: Boolean(uncastBoolean(row.isReturned)),
    }));
    res.hasSaleReturns = res.saleReturns.some((row) => !row.isReturned);

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

    let saleInvoice = invoice;
    if (saleInvoice.isSaleReturn) {
      if (invoiceType !== InvoiceType.Sale) {
        raise('A sale return is a sale document.');
      }
      // prices, quantity caps, and the header total are taken from the
      // source sale when there is one. the number stays the display number;
      // the row stores the encoded one.
      saleInvoice = await this.prepareSaleReturn(saleInvoice, null);
    }

    const totalAmount = saleInvoice.totalAmount ?? 0;
    const storedInvoiceNumber = saleInvoice.isSaleReturn
      ? toStoredSaleReturnNumber(toNumber(saleInvoice.invoiceNumber))
      : saleInvoice.invoiceNumber;
    const trimmedReturnReason = saleInvoice.returnReason?.trim();
    const saleReturnColumns = {
      isSaleReturn: saleInvoice.isSaleReturn ? 1 : 0,
      sourceInvoiceId:
        saleInvoice.isSaleReturn && toNumber(saleInvoice.sourceInvoiceId) > 0
          ? cast(toNumber(saleInvoice.sourceInvoiceId))
          : null,
      returnReason:
        saleInvoice.isSaleReturn &&
        trimmedReturnReason != null &&
        trimmedReturnReason.length > 0
          ? trimmedReturnReason
          : null,
    };
    const charges = InvoiceService.bindInvoiceCharges(saleInvoice);

    const multipleIds = saleInvoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === saleInvoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    if (hasMultiple) {
      const primaryAccountId =
        toNumber(saleInvoice.accountMapping.singleAccountId) || multipleIds[0];
      const invoiceResult = await this.db.run(SQL.insertInvoice, {
        date: saleInvoice.date,
        accountId: primaryAccountId,
        invoiceType,
        totalAmount,
        invoiceNumber: storedInvoiceNumber,
        ...charges,
        isQuotation: 0,
        ...saleReturnColumns,
      });
      const invoiceId = Number(invoiceResult.lastInsertRowid);

      const itemsByAccount = groupBy(saleInvoice.invoiceItems, (item) => {
        return multipleIds[saleInvoice.invoiceItems.indexOf(item)];
      });

      for (const [accountIdStr, groupItems] of Object.entries(itemsByAccount)) {
        const accountId = toNumber(accountIdStr);
        for (const item of groupItems) {
          // eslint-disable-next-line no-await-in-loop
          await this.db.run(
            SQL.insertInvoiceItems,
            InvoiceService.bindInvoiceItem(invoiceId, item, accountId),
          );

          // eslint-disable-next-line no-await-in-loop
          await this.db.run(SQL.updateInventoryItem, [
            InvoiceService.inventoryQuantityDelta(
              invoiceType,
              item.quantity,
              Boolean(saleInvoice.isSaleReturn),
            ),
            item.inventoryId,
          ]);
        }
      }

      if (invoiceType === InvoiceType.Sale && !saleInvoice.isSaleReturn) {
        await this.assertInventoryNonNegative(
          uniq(saleInvoice.invoiceItems.map((i) => i.inventoryId)),
        );
      }

      let splitVendorStockMessages: string[] | undefined;
      if (invoiceType === InvoiceType.Purchase) {
        const messages = await this.applyVendorStockForPostedPurchase(
          invoiceId,
          saleInvoice,
          'purchase',
        );
        if (messages.length > 0) splitVendorStockMessages = messages;
      }

      await this.postJournalsForPersistedInvoice(
        invoiceType,
        invoiceId,
        saleInvoice,
      );

      return {
        invoiceId,
        nextInvoiceNumber: toNumber(saleInvoice.invoiceNumber) + 1,
        vendorStockMessages: splitVendorStockMessages,
      };
    }

    if (saleInvoice.accountMapping.singleAccountId) {
      const accountId = saleInvoice.accountMapping.singleAccountId;

      const invoiceResult = await this.db.run(SQL.insertInvoice, {
        date: saleInvoice.date,
        accountId,
        invoiceType,
        totalAmount,
        invoiceNumber: storedInvoiceNumber,
        ...charges,
        isQuotation: 0,
        ...saleReturnColumns,
      });
      const invoiceId = Number(invoiceResult.lastInsertRowid);

      await this.persistInvoiceItemsAndInventory(
        invoiceType,
        invoiceId,
        saleInvoice,
      );

      if (invoiceType === InvoiceType.Sale && !saleInvoice.isSaleReturn) {
        await this.assertInventoryNonNegative(
          uniq(saleInvoice.invoiceItems.map((i) => i.inventoryId)),
        );
      }

      let vendorStockMessages: string[] | undefined;
      if (invoiceType === InvoiceType.Purchase) {
        const messages = await this.applyVendorStockForPostedPurchase(
          invoiceId,
          saleInvoice,
          'purchase',
        );
        if (messages.length > 0) vendorStockMessages = messages;
      }

      await this.postJournalsForPersistedInvoice(
        invoiceType,
        invoiceId,
        saleInvoice,
      );

      return {
        invoiceId,
        nextInvoiceNumber: toNumber(saleInvoice.invoiceNumber) + 1,
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
          await this.db.run(
            SQL.insertInvoiceItems,
            InvoiceService.bindInvoiceItem(invoiceId, item, accountId),
          );
        }
      }
      return;
    }

    if (invoice.accountMapping.singleAccountId) {
      const accountId = invoice.accountMapping.singleAccountId;
      for (const item of invoice.invoiceItems) {
        // eslint-disable-next-line no-await-in-loop
        await this.db.run(
          SQL.insertInvoiceItems,
          InvoiceService.bindInvoiceItem(invoiceId, item, accountId),
        );
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
    const charges = InvoiceService.bindInvoiceCharges(invoice);

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
        ...charges,
        isQuotation: 1,
        isSaleReturn: 0,
        sourceInvoiceId: null,
        returnReason: null,
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
        ...charges,
        isQuotation: 1,
        isSaleReturn: 0,
        sourceInvoiceId: null,
        returnReason: null,
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

    const charges = InvoiceService.bindInvoiceCharges(invoice);

    await this.db.run(SQL.deleteInvoiceItems, { invoiceId: cast(invoiceId) });

    await this.db.run(SQL.updateInvoiceHeader, {
      invoiceId: cast(invoiceId),
      date: invoice.date,
      accountId: primaryAccountId,
      totalAmount,
      ...charges,
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
        netPrice: it.netPrice ?? undefined,
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
      shippingCharges: view.shippingCharges,
      shippingAccountId: view.shippingAccountId ?? undefined,
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
      isSaleReturn?: number;
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
    if (uncastBoolean(result.isSaleReturn)) {
      return `sale-return-${toDisplaySaleReturnNumber(
        toNumber(result.invoiceNumber),
      )}`;
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
      const current = await this.db.get<{ isSaleReturn?: number }>(
        `SELECT COALESCE(isSaleReturn, 0) AS isSaleReturn FROM invoices WHERE id = ?`,
        [invoiceId],
      );
      const saleReturnRow = uncastBoolean(current?.isSaleReturn);
      if (saleReturnRow) {
        sql =
          direction === 'next'
            ? SQL.adjacentSaleReturnIdNext
            : SQL.adjacentSaleReturnIdPrev;
      } else {
        sql =
          direction === 'next'
            ? SQL.adjacentInvoiceIdNext
            : SQL.adjacentInvoiceIdPrev;
      }
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
      isSaleReturn?: number;
      sourceInvoiceId?: number | null;
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
    const editingSaleReturn = uncastBoolean(invoiceHeader.isSaleReturn);
    const displayNumber = editingSaleReturn
      ? toDisplaySaleReturnNumber(invoiceHeader.invoiceNumber)
      : invoiceHeader.invoiceNumber;
    if (invoice.invoiceNumber !== displayNumber) {
      raise('Invoice number cannot be changed');
    }

    const oldRows = await this.db.all<{
      id: number;
      inventoryId: number;
      quantity: number;
      accountId: number;
      returnedQty: number;
    }>(SQL.getInvoiceItemsForUpdate, { invoiceId: cast(invoiceId) });

    if (editingSaleReturn) {
      // prepared copy replaces the argument for the rest of this save
      // eslint-disable-next-line no-param-reassign
      invoice = await this.prepareSaleReturn(
        {
          ...invoice,
          isSaleReturn: true,
          sourceInvoiceId: invoiceHeader.sourceInvoiceId ?? null,
          invoiceNumber: displayNumber,
        },
        invoiceId,
      );
    } else {
      InvoiceService.assertReturnedLinesNotCut(oldRows, invoice);
    }

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
      Boolean(editingSaleReturn),
    );

    if (invoiceType === InvoiceType.Purchase) {
      // revert prior vendor stock balance and rewrite movements cleanly without fake returns
      await this.vendorStockService.revertPurchaseStockForUpdate(
        invoiceId,
        oldRows.map((r) => ({
          accountId: r.accountId,
          inventoryId: r.inventoryId,
          quantity: r.quantity,
        })),
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

    if (!editingSaleReturn) {
      await this.assertInvoiceDateWithinNeighborRangeForAccount(
        invoiceId,
        primaryAccountId,
        invoiceHeader.invoiceNumber,
        invoice.date,
        invoiceType,
      );
    }

    const charges = InvoiceService.bindInvoiceCharges(invoice);

    await this.db.run(SQL.updateInvoiceHeader, {
      invoiceId: cast(invoiceId),
      date: invoice.date,
      accountId: primaryAccountId,
      totalAmount,
      ...charges,
    });

    await this.persistInvoiceItemsAndInventory(invoiceType, invoiceId, invoice);

    if (!editingSaleReturn) {
      await this.remapReturnedSourceLines(invoiceId, oldRows);
    }

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

  private static inventoryQuantityDelta(
    invoiceType: InvoiceType,
    quantity: number,
    isSaleReturn: boolean,
  ): number {
    if (isSaleReturn || invoiceType === InvoiceType.Purchase) return quantity;
    return -quantity;
  }

  private static localDay(iso: string): number {
    const day = new Date(iso);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  }

  private static lineAccountIds(invoice: Invoice): number[] {
    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);
    if (hasMultiple) return multipleIds.map((id) => toNumber(id));
    const single = toNumber(invoice.accountMapping.singleAccountId);
    return invoice.invoiceItems.map(() => single);
  }

  /**
   * locks a linked return to the sale's price and remaining quantity.
   * an unlinked return (agent carton) keeps the prices the form calculated.
   */
  private async prepareSaleReturn(
    invoice: Invoice,
    excludeInvoiceId: number | null,
  ): Promise<Invoice> {
    if (!(toNumber(invoice.invoiceNumber) > 0)) {
      raise('Sale return number must be greater than 0');
    }
    if (invoice.invoiceItems.length === 0) {
      raise('Add at least one item');
    }

    const sourceId = toNumber(invoice.sourceInvoiceId);
    if (!(sourceId > 0)) {
      if (
        invoice.invoiceItems.some(
          (item) => toNumber(item.sourceInvoiceItemId) > 0,
        )
      ) {
        raise('An unlinked sale return cannot point at a sale line.');
      }
      const posted = InvoiceService.postedAccountAmounts(
        InvoiceType.Sale,
        invoice,
      );
      return {
        ...invoice,
        isSaleReturn: true,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        totalAmount: posted.reduce((sum, group) => sum + group.amount, 0),
      };
    }

    const source = await this.db.get<{
      invoiceType: string;
      isReturned: SqliteBoolColumn;
      isQuotation: SqliteBoolColumn;
      isSaleReturn: SqliteBoolColumn;
      accountId: number;
      invoiceNumber: number;
      date: string;
    }>(
      `
      SELECT invoiceType, accountId, invoiceNumber, date,
        COALESCE(isReturned, 0) AS isReturned,
        COALESCE(isQuotation, 0) AS isQuotation,
        COALESCE(isSaleReturn, 0) AS isSaleReturn
      FROM invoices WHERE id = ?
    `,
      [sourceId],
    );
    const saleSource =
      source ?? raise('Sale returns can only be opened from a sale invoice.');
    if (saleSource.invoiceType !== InvoiceType.Sale) {
      raise('Sale returns can only be opened from a sale invoice.');
    }
    if (uncastBoolean(saleSource.isSaleReturn)) {
      raise('A sale return cannot be opened from another sale return.');
    }
    if (uncastBoolean(saleSource.isQuotation)) {
      raise('Cannot return a quotation. Convert it to an invoice first.');
    }
    if (uncastBoolean(saleSource.isReturned)) {
      raise('This invoice has already been returned.');
    }
    if (
      InvoiceService.localDay(invoice.date) <
      InvoiceService.localDay(saleSource.date)
    ) {
      raise('A sale return cannot be dated before the sale.');
    }

    const sourceLines = await this.db.all<{
      id: number;
      inventoryId: number;
      quantity: number;
      price: number;
      discount: number;
      netPrice: number | null;
      accountId: number;
    }>(
      `
      SELECT ii.id, ii.inventoryId, ii.quantity, ii.price, ii.discount, ii.netPrice,
        COALESCE(ii.accountId, i.accountId) AS accountId
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE ii.invoiceId = ?
    `,
      [sourceId],
    );
    const already = await this.db.all<{ id: number; qty: number }>(
      `
      SELECT ri.sourceInvoiceItemId AS id, SUM(ri.quantity) AS qty
      FROM invoice_items ri
      JOIN invoices r ON r.id = ri.invoiceId
      WHERE r.sourceInvoiceId = ?
        AND COALESCE(r.isSaleReturn, 0) = 1
        AND COALESCE(r.isReturned, 0) = 0
        AND r.id != ?
      GROUP BY ri.sourceInvoiceItemId
    `,
      [sourceId, excludeInvoiceId ?? -1],
    );
    const sourceById = new Map(sourceLines.map((line) => [line.id, line]));
    const returnedById = new Map(
      already.map((row) => [row.id, toNumber(row.qty)]),
    );
    const claimed = new Map<number, number>();
    const locked = invoice.invoiceItems.map((item) => {
      const sourceLineId = toNumber(item.sourceInvoiceItemId);
      const sourceLine =
        sourceById.get(sourceLineId) ??
        raise('Return line does not belong to this sale.');
      const qty = toNumber(item.quantity);
      if (!(qty > 0)) raise('Return quantity must be greater than 0');
      const used =
        (returnedById.get(sourceLineId) ?? 0) +
        (claimed.get(sourceLineId) ?? 0);
      const remaining = sourceLine.quantity - used;
      if (qty > remaining) {
        raise(`Only ${remaining} can still be returned on this sale line.`);
      }
      claimed.set(sourceLineId, (claimed.get(sourceLineId) ?? 0) + qty);
      return {
        ...item,
        inventoryId: sourceLine.inventoryId,
        quantity: qty,
        price: sourceLine.price,
        discount: sourceLine.discount,
        netPrice: sourceLine.netPrice ?? undefined,
        sourceInvoiceItemId: sourceLineId,
      };
    });

    const accountIds = locked.map((item) => {
      const line = sourceById.get(toNumber(item.sourceInvoiceItemId));
      return line?.accountId ?? saleSource.accountId;
    });
    const distinct = uniq(accountIds);
    const prepared: Invoice = {
      ...invoice,
      isSaleReturn: true,
      sourceInvoiceId: sourceId,
      sourceInvoiceNumber: saleSource.invoiceNumber,
      extraDiscount: 0,
      extraDiscountAccountId: undefined,
      shippingCharges: 0,
      shippingAccountId: undefined,
      invoiceItems: locked,
      accountMapping:
        distinct.length <= 1
          ? {
              singleAccountId: distinct[0] ?? saleSource.accountId,
              multipleAccountIds: [],
            }
          : {
              singleAccountId: saleSource.accountId,
              multipleAccountIds: accountIds,
            },
    };
    const posted = InvoiceService.postedAccountAmounts(
      InvoiceType.Sale,
      prepared,
    );
    return {
      ...prepared,
      totalAmount: posted.reduce((sum, group) => sum + group.amount, 0),
    };
  }

  private static assertReturnedLinesNotCut(
    oldRows: Array<{
      id: number;
      inventoryId: number;
      quantity: number;
      accountId: number;
      returnedQty: number;
    }>,
    invoice: Invoice,
  ): void {
    const accounts = InvoiceService.lineAccountIds(invoice);
    const used = new Set<number>();
    for (const old of oldRows) {
      if (toNumber(old.returnedQty) <= 0) continue;
      const match = invoice.invoiceItems.findIndex((item, index) => {
        if (used.has(index)) return false;
        return (
          item.inventoryId === old.inventoryId &&
          accounts[index] === old.accountId &&
          toNumber(item.quantity) >= old.quantity
        );
      });
      if (match < 0) {
        raise(
          'A line that already has a sale return cannot be removed or reduced.',
        );
      }
      used.add(match);
    }
  }

  /** editing a sale deletes its lines. point existing return lines at the new ids. */
  private async remapReturnedSourceLines(
    invoiceId: number,
    oldRows: Array<{
      id: number;
      inventoryId: number;
      accountId: number;
      returnedQty: number;
    }>,
  ): Promise<void> {
    const guarded = oldRows.filter((row) => toNumber(row.returnedQty) > 0);
    if (guarded.length === 0) return;
    const fresh = await this.db.all<{
      id: number;
      inventoryId: number;
      accountId: number;
    }>(
      `
      SELECT ii.id, ii.inventoryId, COALESCE(ii.accountId, i.accountId) AS accountId
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      WHERE ii.invoiceId = ?
      ORDER BY ii.id
    `,
      [invoiceId],
    );
    const used = new Set<number>();
    for (const old of guarded) {
      const match = fresh.findIndex((row, index) => {
        if (used.has(index)) return false;
        return (
          row.inventoryId === old.inventoryId && row.accountId === old.accountId
        );
      });
      if (match < 0) {
        raise('Could not keep the sale return attached to its sale line.');
      }
      used.add(match);
      // eslint-disable-next-line no-await-in-loop
      await this.db.run(
        `UPDATE invoice_items SET sourceInvoiceItemId = ? WHERE sourceInvoiceItemId = ?`,
        [fresh[match].id, old.id],
      );
    }
  }

  async getSaleReturnSource(invoiceId: number): Promise<SaleReturnSource> {
    const header = await this.db.get<{
      id: number;
      invoiceNumber: number;
      invoiceType: string;
      accountId: number;
      accountName: string;
      isReturned: SqliteBoolColumn;
      isQuotation: SqliteBoolColumn;
      isSaleReturn: SqliteBoolColumn;
    }>(
      `
      SELECT i.id, i.invoiceNumber, i.invoiceType, i.accountId, a.name AS accountName,
        COALESCE(i.isReturned, 0) AS isReturned,
        COALESCE(i.isQuotation, 0) AS isQuotation,
        COALESCE(i.isSaleReturn, 0) AS isSaleReturn
      FROM invoices i
      JOIN account a ON a.id = i.accountId
      WHERE i.id = ?
    `,
      [invoiceId],
    );
    const saleHeader = header ?? raise('Sale invoice not found.');
    if (saleHeader.invoiceType !== InvoiceType.Sale) {
      raise('Sale invoice not found.');
    }
    if (uncastBoolean(saleHeader.isSaleReturn)) {
      raise('Open Return items from the original sale.');
    }
    if (uncastBoolean(saleHeader.isQuotation)) {
      raise('Cannot return a quotation. Convert it to an invoice first.');
    }
    if (uncastBoolean(saleHeader.isReturned)) {
      raise('This invoice has already been returned.');
    }
    const lines = await this.db.all<SaleReturnSourceLine>(
      `
      SELECT
        ii.id AS id,
        ii.inventoryId AS inventoryId,
        iv.name AS inventoryItemName,
        ii.quantity AS quantity,
        COALESCE((
          SELECT SUM(ri.quantity)
          FROM invoice_items ri
          JOIN invoices r ON r.id = ri.invoiceId
          WHERE ri.sourceInvoiceItemId = ii.id
            AND COALESCE(r.isSaleReturn, 0) = 1
            AND COALESCE(r.isReturned, 0) = 0
        ), 0) AS returnedQty,
        ii.price AS price,
        ii.discount AS discount,
        ii.netPrice AS netPrice,
        COALESCE(ii.accountId, i.accountId) AS accountId
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoiceId
      JOIN inventory iv ON iv.id = ii.inventoryId
      WHERE ii.invoiceId = ?
      ORDER BY ii.id
    `,
      [invoiceId],
    );
    return {
      invoiceId: saleHeader.id,
      invoiceNumber: saleHeader.invoiceNumber,
      accountId: saleHeader.accountId,
      accountName: saleHeader.accountName,
      lines,
    };
  }

  private async updateInventoryForInvoiceLineItems(
    invoiceType: InvoiceType,
    items: { inventoryId: number; quantity: number }[],
    direction: 'post' | 'reverse',
    isSaleReturn = false,
  ): Promise<void> {
    for (const item of items) {
      const posted = InvoiceService.inventoryQuantityDelta(
        invoiceType,
        item.quantity,
        isSaleReturn,
      );
      const delta = direction === 'post' ? posted : -posted;
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
   * edit rule: invoice date must stay within the same party's adjacent invoice dates
   * (previous/next invoice by invoiceNumber, same invoice type).
   */
  private async assertInvoiceDateWithinNeighborRangeForAccount(
    invoiceId: number,
    accountId: number,
    invoiceNumber: number,
    newDateIso: string,
    invoiceType: InvoiceType,
  ): Promise<void> {
    const normalize = (iso: string): number => {
      const d = new Date(iso);
      // normalize to local day to avoid timezone edge cases
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };

    const nextPrevParams = {
      accountId: cast(accountId),
      invoiceType,
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
   * renderer helper for edit date bounds. returns previous and next invoice dates
   * (by invoiceNumber) for the given account and type, excluding this invoice itself.
   */
  async getInvoiceEditDateBounds(
    invoiceId: number,
    accountId: number,
    invoiceNumber: number,
    invoiceType: InvoiceType,
  ): Promise<{ prevDate: string | null; nextDate: string | null }> {
    const params = {
      accountId: cast(accountId),
      invoiceType,
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
   * undoes a sale return without deleting it. posts the opposite journal,
   * takes the stock back out, and marks the return cancelled.
   */
  async cancelSaleReturn(
    invoiceId: number,
    options?: CancelSaleReturnPayload,
  ): Promise<void> {
    await this.db.transaction(async () => {
      const row = await this.db.get<{
        invoiceNumber: number;
        date: string;
        returnReason: string | null;
        isSaleReturn: SqliteBoolColumn;
        isReturned: SqliteBoolColumn;
      }>(
        `
        SELECT invoiceNumber, date, returnReason,
          COALESCE(isSaleReturn, 0) AS isSaleReturn,
          COALESCE(isReturned, 0) AS isReturned
        FROM invoices WHERE id = ?
      `,
        [invoiceId],
      );
      const header = row ?? raise('Sale return not found.');
      if (!uncastBoolean(header.isSaleReturn)) {
        raise('Only a sale return can be cancelled.');
      }
      if (uncastBoolean(header.isReturned)) {
        raise('This sale return is already cancelled.');
      }

      const requested = options?.date?.trim();
      const cancelDate =
        requested && requested.length > 0
          ? requested
          : new Date().toISOString();
      if (Number.isNaN(Date.parse(cancelDate))) {
        raise('Select a valid date');
      }
      if (
        InvoiceService.localDay(cancelDate) <
        InvoiceService.localDay(header.date)
      ) {
        raise('A sale return cannot be cancelled before its own date.');
      }

      const journals = await this.db.all<{
        id: number;
        discountPercentage: number | string | null;
      }>(`SELECT id, discountPercentage FROM journal WHERE invoiceId = ?`, [
        invoiceId,
      ]);
      if (journals.length === 0) {
        raise('Cannot cancel this return: no linked journals were found.');
      }

      const displayNumber = toDisplaySaleReturnNumber(header.invoiceNumber);
      for (const journal of journals) {
        // eslint-disable-next-line no-await-in-loop
        const entries = await this.db.all<{
          accountId: number;
          debitAmount: number;
          creditAmount: number;
        }>(
          `SELECT accountId, debitAmount, creditAmount FROM journal_entry WHERE journalId = ?`,
          [journal.id],
        );
        // eslint-disable-next-line no-await-in-loop
        await this.journalService.insertJournal({
          id: -1,
          date: cancelDate,
          isPosted: true,
          narration: `Cancel Sale Return #${displayNumber}`,
          billNumber: displayNumber,
          discountPercentage: journal.discountPercentage ?? undefined,
          invoiceId,
          journalEntries: entries.map((entry) => ({
            id: -1,
            journalId: 0,
            accountId: entry.accountId,
            debitAmount: entry.creditAmount,
            creditAmount: entry.debitAmount,
          })),
        });
      }

      const lines = await this.db.all<{
        inventoryId: number;
        quantity: number;
      }>(
        `SELECT inventoryId, quantity FROM invoice_items WHERE invoiceId = ?`,
        [invoiceId],
      );
      for (const line of lines) {
        // eslint-disable-next-line no-await-in-loop
        await this.db.run(SQL.updateInventoryItem, [
          -line.quantity,
          line.inventoryId,
        ]);
      }
      await this.assertInventoryNonNegative(
        uniq(lines.map((line) => line.inventoryId)),
      );

      const note = options?.returnReason?.trim();
      const previous = header.returnReason?.trim();
      const returnReason =
        note && previous ? `${previous}\n${note}` : note || previous || null;
      await this.db.run(
        `
        UPDATE invoices
        SET isReturned = 1, returnedAt = @returnedAt, returnReason = @returnReason
        WHERE id = @invoiceId
      `,
        {
          invoiceId: cast(invoiceId),
          returnedAt: cancelDate,
          returnReason,
        },
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
      isSaleReturn?: SqliteBoolColumn;
    };
    if (header.invoiceType !== expectedType) {
      raise(
        expectedType === InvoiceType.Sale
          ? 'Only sale invoices can be returned.'
          : 'Only purchase invoices can be returned.',
      );
    }
    if (uncastBoolean(header.isSaleReturn)) {
      raise(
        'A sale return cannot be voided with Return invoice. Edit it instead.',
      );
    }
    if (uncastBoolean(header.isQuotation)) {
      raise('Cannot return a quotation. Convert it to an invoice first.');
    }
    if (uncastBoolean(header.isReturned)) {
      raise('This invoice has already been returned.');
    }
    if (expectedType === InvoiceType.Sale) {
      const children = await this.db.get<{ c: number }>(
        `
        SELECT COUNT(*) AS c
        FROM invoices
        WHERE sourceInvoiceId = ?
          AND COALESCE(isSaleReturn, 0) = 1
          AND COALESCE(isReturned, 0) = 0
      `,
        [invoiceId],
      );
      if (toNumber(children?.c) > 0) {
        raise(
          'This invoice already has a sale return. The whole invoice cannot be voided.',
        );
      }
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
          await this.db.run(
            SQL.insertInvoiceItems,
            InvoiceService.bindInvoiceItem(invoiceId, item, accountId),
          );

          // eslint-disable-next-line no-await-in-loop
          await this.db.run(SQL.updateInventoryItem, [
            InvoiceService.inventoryQuantityDelta(
              invoiceType,
              item.quantity,
              Boolean(invoice.isSaleReturn),
            ),
            item.inventoryId,
          ]);
        }
      }
      return;
    }

    if (invoice.accountMapping.singleAccountId) {
      const accountId = invoice.accountMapping.singleAccountId;
      for (const item of invoice.invoiceItems) {
        // eslint-disable-next-line no-await-in-loop
        await this.db.run(
          SQL.insertInvoiceItems,
          InvoiceService.bindInvoiceItem(invoiceId, item, accountId),
        );

        // eslint-disable-next-line no-await-in-loop
        await this.db.run(SQL.updateInventoryItem, [
          InvoiceService.inventoryQuantityDelta(
            invoiceType,
            item.quantity,
            Boolean(invoice.isSaleReturn),
          ),
          item.inventoryId,
        ]);
      }
      return;
    }

    raise('Select a customer or vendor account');
  }

  /**
   * one journal per account at the net receivable.
   * extra discount reduces the chosen account (and Sale/Purchase with it).
   * it is not a second journal and it does not hit the Discount expense account.
   */
  private async postJournalsForPersistedInvoice(
    invoiceType: InvoiceType,
    invoiceId: number,
    invoice: Invoice,
  ): Promise<void> {
    const posted = InvoiceService.postedAccountAmounts(invoiceType, invoice);
    /* eslint-disable no-await-in-loop */
    for (const group of posted) {
      if (group.amount === 0) continue;
      const discountPercentage = journalDiscountLabel(group.lines);
      await this.createJournalEntry(
        invoiceType,
        invoice,
        group.accountId,
        group.amount,
        invoiceId,
        discountPercentage,
      );
    }
    /* eslint-enable no-await-in-loop */
  }

  /** lines grouped by the account that will be debited (sale) or credited (purchase). */
  private static lineAccountGroups(invoice: Invoice): Array<{
    accountId: number;
    items: Invoice['invoiceItems'];
  }> {
    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    if (hasMultiple) {
      const itemsByAccount = groupBy(invoice.invoiceItems, (item) => {
        return multipleIds[invoice.invoiceItems.indexOf(item)];
      });
      return Object.entries(itemsByAccount).map(([accountId, items]) => ({
        accountId: toNumber(accountId),
        items,
      }));
    }

    const accountId = toNumber(invoice.accountMapping.singleAccountId);
    if (accountId > 0) {
      return [{ accountId, items: invoice.invoiceItems }];
    }

    return raise('Select a customer or vendor account');
  }

  /** round each account's lines, subtract extra discount, add shipping, each on its chosen account. */
  private static postedAccountAmounts(
    invoiceType: InvoiceType,
    invoice: Invoice,
  ): Array<{
    accountId: number;
    amount: number;
    lines: Array<{ discount: number; netPrice?: number | null }>;
  }> {
    const groups = InvoiceService.lineAccountGroups(invoice);
    const extra = toNumber(invoice.extraDiscount) || 0;
    let extraAccountId = 0;
    if (extra > 0) {
      const selected = toNumber(invoice.extraDiscountAccountId);
      if (selected > 0) {
        extraAccountId = selected;
      } else if (groups.length === 1) {
        extraAccountId = groups[0].accountId;
      }
      if (
        !extraAccountId ||
        !groups.some((group) => group.accountId === extraAccountId)
      ) {
        raise('Extra discount requires a valid account selection.');
      }
    }

    const shipping = toNumber(invoice.shippingCharges) || 0;
    let shippingAccountId = 0;
    if (shipping > 0) {
      const selected = toNumber(invoice.shippingAccountId);
      if (selected > 0) {
        shippingAccountId = selected;
      } else if (groups.length === 1) {
        shippingAccountId = groups[0].accountId;
      }
      if (
        !shippingAccountId ||
        !groups.some((group) => group.accountId === shippingAccountId)
      ) {
        raise('Shipping requires a valid account selection.');
      }
    }

    const posted = groups.map((group) => {
      const gross = InvoiceService.roundedGroupGross(group.items);
      let amount = gross;
      if (extra > 0 && group.accountId === extraAccountId) amount -= extra;
      if (shipping > 0 && group.accountId === shippingAccountId) {
        amount += shipping;
      }
      if (amount < 0) {
        raise('Extra discount cannot exceed the selected account total.');
      }
      return {
        accountId: group.accountId,
        amount,
        lines: group.items.map((item) => ({
          discount: item.discount,
          netPrice: item.netPrice,
        })),
      };
    });

    if (invoiceType === InvoiceType.Sale) {
      const net = posted.reduce((sum, group) => sum + group.amount, 0);
      if (net <= 0) {
        raise('Invoice total must be greater than 0');
      }
    }

    return posted;
  }

  /** match the invoice screen: round an account's line total to the nearest rupee. */
  private static roundedGroupGross(
    items: Array<{ quantity: number; discount: number; price?: number }>,
  ): number {
    const raw = items.reduce(
      (sum, item) =>
        sum + InvoiceService.getInvoiceItemTotal(item, item.price || 0),
      0,
    );
    return Math.round(raw);
  }

  private async createJournalEntry(
    invoiceType: InvoiceType,
    invoice: Invoice,
    accountId: number,
    amount: number,
    invoiceId: number,
    discountPercentage?: number | string,
  ): Promise<boolean> {
    const { debitAccountId, creditAccountId } =
      await this.getTransactionAccounts(
        invoiceType,
        accountId,
        Boolean(invoice.isSaleReturn),
      );

    const against =
      invoice.isSaleReturn && toNumber(invoice.sourceInvoiceNumber) > 0
        ? ` against Invoice #${invoice.sourceInvoiceNumber}`
        : '';
    const narration = invoice.isSaleReturn
      ? `Sale Return #${invoice.invoiceNumber}${against}`
      : `${invoiceType} Invoice #${invoice.invoiceNumber}`;

    return this.journalService.insertJournal({
      id: -1,
      date: invoice.date,
      isPosted: true,
      narration,
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

  private async getTransactionAccounts(
    invoiceType: InvoiceType,
    accountId: number,
    isSaleReturn = false,
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
    if (isSaleReturn) {
      return {
        debitAccountId: validSalesAccount.id, // Debit Sales
        creditAccountId: accountId, // Credit customer
      };
    }
    return {
      debitAccountId: accountId, // Debit Cash/Customer
      creditAccountId: validSalesAccount.id, // Credit Sales
    };
  }

  private static bindInvoiceCharges(invoice: Invoice) {
    return {
      extraDiscount: invoice.extraDiscount ?? 0,
      biltyNumber: invoice.biltyNumber,
      cartons: invoice.cartons,
      extraDiscountAccountId:
        invoice.extraDiscountAccountId != null
          ? cast(toNumber(invoice.extraDiscountAccountId))
          : null,
      shippingCharges: toNumber(invoice.shippingCharges) || 0,
      shippingAccountId:
        invoice.shippingAccountId != null &&
        toNumber(invoice.shippingAccountId) > 0
          ? cast(toNumber(invoice.shippingAccountId))
          : null,
    };
  }

  private static bindInvoiceItem(
    invoiceId: number,
    item: InvoiceItem,
    accountId: number,
  ): {
    invoiceId: number;
    inventoryId: number;
    quantity: number;
    price: number | null;
    discount: number;
    accountId: number;
    netPrice: number | null;
    sourceInvoiceItemId: number | null;
  } {
    return {
      invoiceId,
      inventoryId: item.inventoryId,
      quantity: item.quantity,
      price: item.price ?? null,
      discount: item.discount,
      accountId,
      netPrice: item.netPrice ?? null,
      sourceInvoiceItemId:
        item.sourceInvoiceItemId != null && item.sourceInvoiceItemId > 0
          ? item.sourceInvoiceItemId
          : null,
    };
  }

  private static getInvoiceItemTotal = (
    item: {
      quantity: number;
      discount: number;
      netPrice?: number | null;
    },
    price: number,
  ): number =>
    invoiceLineAmount({
      quantity: item.quantity,
      discount: item.discount,
      price,
      netPrice: item.netPrice,
    });

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
      [sqlStartDate, sqlEndDate, sqlStartDate, sqlEndDate],
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
        AND COALESCE(i.isSaleReturn, 0) = 0
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

    // per invoice+account rounded line gross, minus extra discount on the chosen account.
    // same rounding as the sale journal, so these groups match Sale credits.
    const netByAccountCte = `
      WITH line_groups AS (
        SELECT
          i.id AS invoiceId,
          ii.accountId AS accountId,
          ROUND(SUM(ii.quantity * ii.price * (1.0 - ii.discount / 100.0))) AS roundedGross
        FROM invoices i
        JOIN invoice_items ii ON ii.invoiceId = i.id
        WHERE i.invoiceType = 'Sale'
          AND i.isQuotation = 0
          AND i.isReturned = 0
          AND i.date >= ? AND i.date <= ?
        GROUP BY i.id, ii.accountId
      ),
      groups_net AS (
        SELECT
          lg.invoiceId AS invoiceId,
          lg.accountId AS accountId,
          (CASE WHEN COALESCE(i.isSaleReturn, 0) = 1 THEN -1 ELSE 1 END) * (
            lg.roundedGross - CASE
              WHEN COALESCE(i.extraDiscount, 0) > 0
                AND i.extraDiscountAccountId = lg.accountId
              THEN i.extraDiscount
              ELSE 0
            END
          ) AS netAmount
        FROM line_groups lg
        JOIN invoices i ON i.id = lg.invoiceId
      )
    `;

    if (groupByPolicy) {
      // Group by discount profile (policy). Handle NULL profiles as "No Policy"
      const rows = await this.db.all<{
        groupName: string;
        groupId: number;
        totalAmount: number;
        invoiceCount: number;
        customerCount: number;
      }>(
        `
        ${netByAccountCte}
        SELECT
          COALESCE(dp.name, 'No Policy') AS groupName,
          COALESCE(dp.id, -1) AS groupId,
          COALESCE(SUM(gn.netAmount), 0) AS totalAmount,
          COUNT(DISTINCT gn.invoiceId) AS invoiceCount,
          COUNT(DISTINCT gn.accountId) AS customerCount
        FROM groups_net gn
        JOIN account a ON a.id = gn.accountId
        LEFT JOIN discount_profiles dp ON dp.id = a.discountProfileId
        GROUP BY a.discountProfileId
        ORDER BY totalAmount DESC
      `,
        [sqlStartDate, sqlEndDate],
      );
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
      }>(
        `
        ${netByAccountCte}
        SELECT
          a.name AS groupName, a.id AS groupId, a.code AS groupCode,
          COALESCE(SUM(gn.netAmount), 0) AS totalAmount,
          COUNT(DISTINCT gn.invoiceId) AS invoiceCount
        FROM groups_net gn
        JOIN account a ON a.id = gn.accountId
        GROUP BY gn.accountId
        ORDER BY totalAmount DESC
      `,
        [sqlStartDate, sqlEndDate],
      );
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
    }>(SQL.salesPerfReturnsDetail, [
      sqlStartDate,
      sqlEndDate,
      sqlStartDate,
      sqlEndDate,
    ]);

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
        [sqlCompareStart, sqlCompareEnd, sqlCompareStart, sqlCompareEnd],
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
          AND COALESCE(i.isSaleReturn, 0) = 0
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
        CASE WHEN COALESCE(i.isSaleReturn, 0) = 1 THEN -ii.quantity ELSE ii.quantity END AS quantity,
        i.id AS invoiceId,
        CASE WHEN COALESCE(i.isSaleReturn, 0) = 1 THEN (-i.invoiceNumber - ${SALE_RETURN_NUMBER_BASE}) ELSE i.invoiceNumber END AS invoiceNumber,
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
