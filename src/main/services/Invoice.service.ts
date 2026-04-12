import type { Database, Statement } from 'better-sqlite3';
import log from 'electron-log';
import { forEach, groupBy, toNumber, toString, uniq } from 'lodash';
import { write, utils } from 'xlsx';
import { getQuotationDisplayNumber } from '../../lib/quotationDisplay';
import {
  InvoiceType,
  type Invoice,
  type InvoiceItem,
  type InvoiceItemView,
  type InvoiceView,
  type InvoicesExport,
  type InvoicesView,
  type ReturnSaleInvoicePayload,
} from '../../types';
import { logErrors } from '../errorLogger';
import { DatabaseService } from './Database.service';
import { raise, convertOrdinalDate } from '../utils/general';
import { JournalService } from './Journal.service';
import { AccountService } from './Account.service';
import { PricingService } from './Pricing.service';
import type { SqliteBoolean } from '../utils/sqlite';
import {
  cast,
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

/** one joined row per line from stmGetInvoice before aggregating to InvoiceView */
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
  invoiceAccountCode?: number | string | null;
  invoiceAccountAddress?: string | null;
  invoiceAccountGoodsName?: string | null;
  itemRowAccountId?: number | null;
  accountCode?: number | string | null;
  isReturned?: SqliteBoolColumn;
  returnedAt?: string | null;
  returnReason?: string | null;
  isQuotation?: SqliteBoolColumn;
};

@logErrors
export class InvoiceService {
  private db: Database;

  private journalService!: JournalService;

  private accountService!: AccountService;

  private pricingService!: PricingService;

  private stmGetNextInvoiceNumber!: Statement;

  private stmInsertInvoice!: Statement;

  private stmInsertInvoiceItems!: Statement;

  private stmUpdateInventoryItem!: Statement;

  private stmGetInvoices!: Statement;

  private stmGetInvoice!: Statement;

  private stmDoesInvoiceExist!: Statement;

  private stmAdjacentInvoiceIdNext!: Statement;

  private stmAdjacentInvoiceIdPrev!: Statement;

  private stmAdjacentQuotationIdNext!: Statement;

  private stmAdjacentQuotationIdPrev!: Statement;

  private stmGetLastInvoiceNumber!: Statement;

  private stmGetInvoiceIdsFromMinId!: Statement;

  private stmGetQuotationIdsFromMinId!: Statement;

  private stmGetSalePurchaseAccounts!: Statement;

  private stmUpdateInvoiceBiltyAndCartons!: Statement;

  private stmDeleteInvoiceItems!: Statement;

  private stmGetInvoiceItemsForUpdate!: Statement;

  private stmUpdateInvoiceHeader!: Statement;

  private stmGetInvoiceHeader!: Statement;

  private stmGetInventoryQuantity!: Statement;

  private stmGetInventoryNameQuantity!: Statement;

  private stmGetPrevInvoiceDateForAccount!: Statement;

  private stmGetNextInvoiceDateForAccount!: Statement;

  private stmGetInvoiceForReturn!: Statement;

  private stmMarkInvoiceReturned!: Statement;

  private stmGetNextQuotationInvoiceNumber!: Statement;

  private stmGetQuotationInvoices!: Statement;

  private stmFinalizeQuotationConversion!: Statement;

  private stmAggregateInvoiceStockByLine!: Statement;

  private stmGetInvoicesInDateRange!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.journalService = new JournalService();
    this.accountService = new AccountService();
    this.pricingService = new PricingService();
    this.initPreparedStatements();
  }

  getNextInvoiceNumber(invoiceType: InvoiceType): number | undefined {
    const invoice = <{ invoiceNumber: number } | undefined>(
      this.stmGetNextInvoiceNumber.get(invoiceType)
    );
    return invoice?.invoiceNumber;
  }

  /**
   * persists a quotation: header + line items, negative placeholder invoiceNumber, no inventory or journals.
   */
  insertQuotationInvoice(
    invoiceType: InvoiceType,
    invoice: Invoice,
  ): { invoiceId: number } {
    return this.db.transaction(() => {
      return this.insertQuotationInvoiceWithoutTransaction(
        invoice,
        invoiceType,
      );
    })();
  }

  getQuotationInvoices(invoiceType: InvoiceType): InvoicesView[] {
    const raw = this.stmGetQuotationInvoices.all(
      invoiceType,
    ) as InvoiceListSqliteRow[];
    return normalizeSqliteBooleanRows(
      raw,
      INVOICE_LIST_SQLITE_BOOLEAN_KEYS,
    ) as InvoicesView[];
  }

  updateQuotationInvoice(invoiceId: number, invoice: Invoice): void {
    this.db.transaction(() => {
      this.updateQuotationInvoiceWithoutTransaction(invoiceId, invoice);
    })();
  }

  convertQuotationInvoice(invoiceId: number): { invoiceNumber: number } {
    return this.db.transaction(() => {
      return this.convertQuotationInvoiceWithoutTransaction(invoiceId);
    })();
  }

  getInvoices(invoiceType: InvoiceType): InvoicesView[] {
    const raw = this.stmGetInvoices.all(invoiceType) as InvoiceListSqliteRow[];
    return normalizeSqliteBooleanRows(
      raw,
      INVOICE_LIST_SQLITE_BOOLEAN_KEYS,
    ) as InvoicesView[];
  }

  getInvoice(invoiceId: number): InvoiceView {
    const result = this.stmGetInvoice.all({
      invoiceId: cast(invoiceId),
    }) as InvoiceDetailJoinedRowSqlite[];

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
        if (isSingleCode) {
          prev.accountCode =
            cur.invoiceAccountCode != null
              ? String(cur.invoiceAccountCode)
              : null;
        }
        prev.accountAddress = cur.invoiceAccountAddress ?? null;
        prev.accountGoodsName = cur.invoiceAccountGoodsName ?? null;
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
        accountName: isSingleAccount ? undefined : cur.accountName,
        accountId:
          cur.itemRowAccountId != null && cur.itemRowAccountId > 0
            ? cur.itemRowAccountId
            : undefined,
      });
      return prev;
    }, {} as InvoiceView);

    if (!isSingleAccount) {
      res.accountName = uniq(result.map((r) => r.accountName)).join(', ');
    }
    if (!isSingleCode) {
      res.accountCode = invoiceAccountCodes.join(', ');
    }

    return res;
  }

  insertInvoice(
    invoiceType: InvoiceType,
    invoice: Invoice,
  ): { invoiceId: number; nextInvoiceNumber: number } {
    return this.db.transaction(() => {
      return this.insertInvoiceWithoutTransaction(invoiceType, invoice);
    })();
  }

  private insertInvoiceWithoutTransaction(
    invoiceType: InvoiceType,
    invoice: Invoice,
  ): { invoiceId: number; nextInvoiceNumber: number } {
    const invalid = { invoiceId: -1, nextInvoiceNumber: -1 };
    if (!invoice.invoiceNumber) {
      log.error('No invoice number found while inserting invoice', invoice);
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
      const invoiceResult = this.stmInsertInvoice.run({
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
      const invoiceId = <number>invoiceResult.lastInsertRowid;

      const itemsByAccount = groupBy(invoice.invoiceItems, (item) => {
        return multipleIds[invoice.invoiceItems.indexOf(item)];
      });

      forEach(itemsByAccount, (groupItems, accountId) => {
        const groupTotalRaw = groupItems.reduce((sum, item) => {
          return (
            sum + InvoiceService.getInvoiceItemTotal(item, item.price || 0)
          );
        }, 0);
        // match UI: per-account group gross is rounded before invoice total / ledger
        const groupTotalAmount = Math.round(groupTotalRaw);
        const groupDiscountPercentage =
          this.pricingService.getPolicyDiscountPercentForInventoryIds(
            toNumber(accountId),
            groupItems.map((item) => item.inventoryId),
          );

        for (const item of groupItems) {
          this.stmInsertInvoiceItems.run({
            invoiceId,
            inventoryId: item.inventoryId,
            quantity: item.quantity,
            discount: item.discount,
            accountId: toNumber(accountId),
          });

          this.stmUpdateInventoryItem.run(
            invoiceType === InvoiceType.Sale ? -item.quantity : item.quantity,
            item.inventoryId,
          );
        }

        this.createJournalEntry(
          invoiceType,
          invoice,
          toNumber(accountId),
          groupTotalAmount,
          invoiceId,
          groupDiscountPercentage,
        );
      });

      const extraDiscount = toNumber(invoice.extraDiscount) || 0;
      if (extraDiscount > 0) {
        const discountAccount = this.accountService.getAccountByName(
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
        this.createExtraDiscountJournalEntry(
          invoiceType,
          invoice,
          discountAccount!.id,
          creditAccountId,
          extraDiscount,
          invoiceId,
        );
      }
      return {
        invoiceId,
        nextInvoiceNumber: invoice.invoiceNumber + 1,
      };
    }

    if (invoice.accountMapping.singleAccountId) {
      const accountId = invoice.accountMapping.singleAccountId;

      const invoiceResult = this.stmInsertInvoice.run({
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
      const invoiceId = <number>invoiceResult.lastInsertRowid;

      this.persistInvoiceItemsAndInventory(invoiceType, invoiceId, invoice);

      if (invoiceType === InvoiceType.Sale) {
        this.assertInventoryNonNegative(
          uniq(invoice.invoiceItems.map((i) => i.inventoryId)),
        );
      }

      this.postJournalsForPersistedInvoice(invoiceType, invoiceId, invoice);

      return {
        invoiceId,
        nextInvoiceNumber: invoice.invoiceNumber + 1,
      };
    }

    return invalid;
  }

  private getNextQuotationPlaceholderNumber(invoiceType: InvoiceType): number {
    const row = this.stmGetNextQuotationInvoiceNumber.get(invoiceType) as
      | { n: number | null }
      | undefined;
    return toNumber(row?.n ?? -1);
  }

  private persistInvoiceLineItemsWithoutInventory(
    invoiceId: number,
    invoice: Invoice,
  ): void {
    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    if (hasMultiple) {
      const itemsByAccount = groupBy(invoice.invoiceItems, (item) => {
        return multipleIds[invoice.invoiceItems.indexOf(item)];
      });
      forEach(itemsByAccount, (groupItems, accountIdStr) => {
        const accountId = toNumber(accountIdStr);
        for (const item of groupItems) {
          this.stmInsertInvoiceItems.run({
            invoiceId,
            inventoryId: item.inventoryId,
            quantity: item.quantity,
            discount: item.discount,
            accountId,
          });
        }
      });
      return;
    }

    if (invoice.accountMapping.singleAccountId) {
      const accountId = invoice.accountMapping.singleAccountId;
      for (const item of invoice.invoiceItems) {
        this.stmInsertInvoiceItems.run({
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

  private insertQuotationInvoiceWithoutTransaction(
    invoice: Invoice,
    invoiceType: InvoiceType,
  ): { invoiceId: number } {
    const placeholder = this.getNextQuotationPlaceholderNumber(invoiceType);
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
      const invoiceResult = this.stmInsertInvoice.run({
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
      const invoiceId = <number>invoiceResult.lastInsertRowid;
      this.persistInvoiceLineItemsWithoutInventory(invoiceId, invoice);
      return { invoiceId };
    }

    if (invoice.accountMapping.singleAccountId) {
      const accountId = invoice.accountMapping.singleAccountId;
      const invoiceResult = this.stmInsertInvoice.run({
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
      const invoiceId = <number>invoiceResult.lastInsertRowid;
      this.persistInvoiceLineItemsWithoutInventory(invoiceId, invoice);
      return { invoiceId };
    }

    return raise('Select a customer or vendor account');
  }

  private updateQuotationInvoiceWithoutTransaction(
    invoiceId: number,
    invoice: Invoice,
  ): void {
    const header = this.stmGetInvoiceHeader.get({
      invoiceId: cast(invoiceId),
    }) as
      | {
          invoiceNumber: number;
          invoiceType: string;
          isQuotation: number;
        }
      | undefined;
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

    this.stmDeleteInvoiceItems.run({ invoiceId: cast(invoiceId) });

    this.stmUpdateInvoiceHeader.run({
      invoiceId: cast(invoiceId),
      date: invoice.date,
      accountId: primaryAccountId,
      totalAmount,
      extraDiscount: invoice.extraDiscount,
      biltyNumber: invoice.biltyNumber,
      cartons: invoice.cartons,
      extraDiscountAccountId: extraDiscAcct,
    });

    this.persistInvoiceLineItemsWithoutInventory(invoiceId, invoice);
  }

  private assertSaleQuotationStockAvailable(invoiceId: number): void {
    const rows = this.stmAggregateInvoiceStockByLine.all({
      invoiceId: cast(invoiceId),
    }) as Array<{
      inventoryId: number;
      needQty: number;
      itemName: string;
      haveQty: number;
    }>;

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

  private applyPersistedSaleInventoryDecrements(invoiceId: number): void {
    const items = this.stmGetInvoiceItemsForUpdate.all({
      invoiceId: cast(invoiceId),
    }) as { inventoryId: number; quantity: number }[];
    items.forEach((item) => {
      this.stmUpdateInventoryItem.run(-item.quantity, item.inventoryId);
    });
  }

  /** after converting a purchase quotation: line items already exist; add stock like a posted purchase */
  private applyPersistedPurchaseInventoryIncrements(invoiceId: number): void {
    const items = this.stmGetInvoiceItemsForUpdate.all({
      invoiceId: cast(invoiceId),
    }) as { inventoryId: number; quantity: number }[];
    items.forEach((item) => {
      this.stmUpdateInventoryItem.run(item.quantity, item.inventoryId);
    });
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

  private convertQuotationInvoiceWithoutTransaction(invoiceId: number): {
    invoiceNumber: number;
  } {
    const header = this.stmGetInvoiceHeader.get({
      invoiceId: cast(invoiceId),
    }) as
      | { invoiceNumber: number; invoiceType: string; isQuotation: number }
      | undefined;
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
      this.assertSaleQuotationStockAvailable(invoiceId);
    }

    const nextRaw = this.stmGetNextInvoiceNumber.get(invType) as
      | { invoiceNumber: number }
      | undefined;
    const nextNum = toNumber(nextRaw?.invoiceNumber);
    if (!nextNum || nextNum < 1) {
      raise(
        invType === InvoiceType.Sale
          ? 'Could not allocate next sale invoice number.'
          : 'Could not allocate next purchase invoice number.',
      );
    }

    this.stmFinalizeQuotationConversion.run({
      invoiceId: cast(invoiceId),
      invoiceNumber: cast(nextNum),
    });

    if (invType === InvoiceType.Sale) {
      this.applyPersistedSaleInventoryDecrements(invoiceId);
      const touchedIds = uniq(
        (
          this.stmGetInvoiceItemsForUpdate.all({
            invoiceId: cast(invoiceId),
          }) as { inventoryId: number }[]
        ).map((i) => i.inventoryId),
      );
      this.assertInventoryNonNegative(touchedIds);
    } else {
      this.applyPersistedPurchaseInventoryIncrements(invoiceId);
    }

    const view = this.getInvoice(invoiceId);
    const invoicePayload = InvoiceService.invoiceViewToInvoiceForPosting(
      view,
      nextNum,
    );
    this.postJournalsForPersistedInvoice(invType, invoiceId, invoicePayload);

    return { invoiceNumber: nextNum };
  }

  getInvoicesInDateRange(
    startDate?: string,
    endDate?: string,
  ): InvoicesExport[] {
    const result = this.stmGetInvoicesInDateRange.all({
      startDate: startDate ?? null,
      endDate: endDate ?? null,
    }) as InvoicesExport[];

    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  exportSaleInvoices(startDate?: string, endDate?: string): Buffer {
    const invoices = this.getInvoicesInDateRange();
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

  doesInvoiceExists(invoiceId: number, invoiceType: InvoiceType): number {
    const result = this.stmDoesInvoiceExist.get({
      invoiceId: cast(invoiceId),
      invoiceType,
    }) as { invoiceNumber: number; isQuotation?: number } | undefined;
    if (!result) {
      return 0;
    }
    if (uncastBoolean(result.isQuotation)) {
      return 0;
    }
    return toNumber(result.invoiceNumber);
  }

  /** safe PDF filename stem for batch/print-to-PDF; null when row missing or type mismatch */
  getInvoicePdfOutputBaseName(
    invoiceId: number,
    invoiceType: InvoiceType,
  ): string | null {
    const result = this.stmDoesInvoiceExist.get({
      invoiceId: cast(invoiceId),
      invoiceType,
    }) as { invoiceNumber: number; isQuotation?: number } | undefined;
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
  getAdjacentInvoiceId(
    invoiceId: number,
    invoiceType: InvoiceType,
    direction: 'next' | 'previous',
    scope: 'posted' | 'quotation' = 'posted',
  ): number {
    let stmt: Statement;
    if (scope === 'quotation') {
      stmt =
        direction === 'next'
          ? this.stmAdjacentQuotationIdNext
          : this.stmAdjacentQuotationIdPrev;
    } else {
      stmt =
        direction === 'next'
          ? this.stmAdjacentInvoiceIdNext
          : this.stmAdjacentInvoiceIdPrev;
    }
    const row = stmt.get({
      invoiceId: cast(invoiceId),
      invoiceType,
    }) as { id: number } | undefined;
    return row?.id ?? 0;
  }

  getLastInvoiceNumber(invoiceType: InvoiceType): number {
    const result = <{ lastInvoiceNumber: number } | undefined>(
      this.stmGetLastInvoiceNumber.get(invoiceType)
    );
    return result?.lastInvoiceNumber ?? 0;
  }

  /** ordered primary keys for batch print: same invoiceType from this row onward */
  getInvoiceIdsFromMinId(
    invoiceType: InvoiceType,
    fromInvoiceId: number,
    scope: 'posted' | 'quotation' = 'posted',
  ): number[] {
    const stmt =
      scope === 'quotation'
        ? this.stmGetQuotationIdsFromMinId
        : this.stmGetInvoiceIdsFromMinId;
    const rows = stmt.all({
      invoiceType,
      fromInvoiceId: cast(fromInvoiceId),
    }) as { id: number }[];
    return rows.map((r) => toNumber(r.id));
  }

  updateInvoiceBiltyAndCartons(
    invoiceId: number,
    biltyNumber: string | undefined,
    cartons: number | undefined,
  ): boolean {
    const bilty =
      biltyNumber != null && String(biltyNumber).trim() !== ''
        ? cast(parseInt(String(biltyNumber).trim(), 10))
        : null;
    const result = this.stmUpdateInvoiceBiltyAndCartons.run({
      invoiceId: cast(invoiceId),
      biltyNumber: bilty,
      cartons: cartons != null ? cast(cartons) : null,
    });
    return Boolean(result.changes);
  }

  updateInvoice(
    invoiceType: InvoiceType,
    invoiceId: number,
    invoice: Invoice,
  ): { success: boolean } {
    return this.db.transaction(() => {
      this.updateInvoiceWithoutTransaction(invoiceType, invoiceId, invoice);
      return { success: true };
    })();
  }

  private updateInvoiceWithoutTransaction(
    invoiceType: InvoiceType,
    invoiceId: number,
    invoice: Invoice,
  ): void {
    const header = this.stmGetInvoiceHeader.get({
      invoiceId: cast(invoiceId),
    }) as
      | { invoiceNumber: number; invoiceType: string; isQuotation?: number }
      | undefined;
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

    const oldRows = this.stmGetInvoiceItemsForUpdate.all({
      invoiceId: cast(invoiceId),
    }) as { inventoryId: number; quantity: number }[];

    const journalIds = this.journalService.getJournalIdsByInvoiceId(invoiceId);
    if (journalIds.length === 0) {
      raise(
        'This invoice has no linked journals (cannot edit safely). Re-enter the invoice or restore journal links.',
      );
    }

    this.journalService.removeLedgerEffectOfJournals(journalIds);
    this.journalService.deleteJournalsByIds(journalIds);

    this.stmDeleteInvoiceItems.run({ invoiceId: cast(invoiceId) });

    this.updateInventoryForInvoiceLineItems(invoiceType, oldRows, 'reverse');

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
      this.assertInvoiceDateWithinNeighborRangeForAccount(
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

    this.stmUpdateInvoiceHeader.run({
      invoiceId: cast(invoiceId),
      date: invoice.date,
      accountId: primaryAccountId,
      totalAmount,
      extraDiscount: invoice.extraDiscount,
      biltyNumber: invoice.biltyNumber,
      cartons: invoice.cartons,
      extraDiscountAccountId: extraDiscAcct,
    });

    this.persistInvoiceItemsAndInventory(invoiceType, invoiceId, invoice);

    if (
      invoiceType === InvoiceType.Sale ||
      invoiceType === InvoiceType.Purchase
    ) {
      const touchedIds = uniq([
        ...oldRows.map((r) => r.inventoryId),
        ...invoice.invoiceItems.map((i) => i.inventoryId),
      ]);
      this.assertInventoryNonNegative(touchedIds);
    }

    this.postJournalsForPersistedInvoice(invoiceType, invoiceId, invoice);
  }

  private updateInventoryForInvoiceLineItems(
    invoiceType: InvoiceType,
    items: { inventoryId: number; quantity: number }[],
    direction: 'post' | 'reverse',
  ): void {
    items.forEach((item) => {
      let delta: number;
      if (invoiceType === InvoiceType.Sale) {
        delta = direction === 'post' ? -item.quantity : item.quantity;
      } else {
        delta = direction === 'post' ? item.quantity : -item.quantity;
      }
      this.stmUpdateInventoryItem.run(delta, item.inventoryId);
    });
  }

  private assertInventoryNonNegative(inventoryIds: number[]): void {
    const problemLines: string[] = [];
    uniq(inventoryIds).forEach((id) => {
      const row = this.stmGetInventoryNameQuantity.get(id) as
        | { name: string | null; quantity: number }
        | undefined;
      if (!row || toNumber(row.quantity) >= 0) {
        return;
      }
      const label = String(row.name ?? '').trim() || `item #${id}`;
      problemLines.push(
        `"${label}" (on-hand would be ${toNumber(row.quantity)})`,
      );
    });
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
  private assertInvoiceDateWithinNeighborRangeForAccount(
    invoiceId: number,
    accountId: number,
    invoiceNumber: number,
    newDateIso: string,
  ): void {
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

    const prev = this.stmGetPrevInvoiceDateForAccount.get(nextPrevParams) as
      | { date: string }
      | undefined;
    const next = this.stmGetNextInvoiceDateForAccount.get(nextPrevParams) as
      | { date: string }
      | undefined;

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
  getSaleInvoiceEditDateBounds(
    invoiceId: number,
    accountId: number,
    invoiceNumber: number,
  ): { prevDate: string | null; nextDate: string | null } {
    const params = {
      accountId: cast(accountId),
      invoiceType: InvoiceType.Sale,
      invoiceNumber: cast(invoiceNumber),
      invoiceId: cast(invoiceId),
    };
    const prev = this.stmGetPrevInvoiceDateForAccount.get(params) as
      | { date: string }
      | undefined;
    const next = this.stmGetNextInvoiceDateForAccount.get(params) as
      | { date: string }
      | undefined;
    return {
      prevDate: prev?.date ?? null,
      nextDate: next?.date ?? null,
    };
  }

  /**
   * voids a sale invoice: removes linked journals and their ledger lines, restocks inventory,
   * and marks the invoice as returned (whole invoice only).
   */
  returnSaleInvoice(
    invoiceId: number,
    options?: ReturnSaleInvoicePayload,
  ): void {
    this.db.transaction(() => {
      this.voidInvoiceReturnWithoutTransaction(
        invoiceId,
        InvoiceType.Sale,
        options,
      );
    })();
  }

  /**
   * voids a purchase invoice: removes linked journals and ledger lines, reverses inventory
   * (stock added on purchase is removed), and marks the invoice as returned.
   */
  returnPurchaseInvoice(
    invoiceId: number,
    options?: ReturnSaleInvoicePayload,
  ): void {
    this.db.transaction(() => {
      this.voidInvoiceReturnWithoutTransaction(
        invoiceId,
        InvoiceType.Purchase,
        options,
      );
    })();
  }

  private voidInvoiceReturnWithoutTransaction(
    invoiceId: number,
    expectedType: InvoiceType,
    options?: ReturnSaleInvoicePayload,
  ): void {
    const row = this.stmGetInvoiceForReturn.get({
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

    const journalIds = this.journalService.getJournalIdsByInvoiceId(invoiceId);
    if (journalIds.length === 0) {
      raise('Cannot return this invoice: no linked journals were found.');
    }

    this.journalService.removeLedgerEffectOfJournals(journalIds);
    this.journalService.deleteJournalsByIds(journalIds);

    const items = this.stmGetInvoiceItemsForUpdate.all({
      invoiceId: cast(invoiceId),
    }) as { inventoryId: number; quantity: number }[];

    const inventoryDelta = expectedType === InvoiceType.Sale ? 1 : -1;

    items.forEach((item) => {
      this.stmUpdateInventoryItem.run(
        inventoryDelta * item.quantity,
        item.inventoryId,
      );
    });

    if (expectedType === InvoiceType.Purchase) {
      this.assertInventoryNonNegative(
        uniq(items.map((item) => item.inventoryId)),
      );
    }

    const trimmed = options?.returnReason?.trim();
    const returnReason = trimmed != null && trimmed.length > 0 ? trimmed : null;

    this.stmMarkInvoiceReturned.run({
      invoiceId: cast(invoiceId),
      returnReason,
    });
  }

  private persistInvoiceItemsAndInventory(
    invoiceType: InvoiceType,
    invoiceId: number,
    invoice: Invoice,
  ): void {
    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    if (hasMultiple) {
      const itemsByAccount = groupBy(invoice.invoiceItems, (item) => {
        return multipleIds[invoice.invoiceItems.indexOf(item)];
      });

      forEach(itemsByAccount, (groupItems, accountIdStr) => {
        const accountId = toNumber(accountIdStr);
        for (const item of groupItems) {
          this.stmInsertInvoiceItems.run({
            invoiceId,
            inventoryId: item.inventoryId,
            quantity: item.quantity,
            discount: item.discount,
            accountId,
          });

          this.stmUpdateInventoryItem.run(
            invoiceType === InvoiceType.Sale ? -item.quantity : item.quantity,
            item.inventoryId,
          );
        }
      });
      return;
    }

    if (invoice.accountMapping.singleAccountId) {
      const accountId = invoice.accountMapping.singleAccountId;
      for (const item of invoice.invoiceItems) {
        this.stmInsertInvoiceItems.run({
          invoiceId,
          inventoryId: item.inventoryId,
          quantity: item.quantity,
          discount: item.discount,
          accountId,
        });

        this.stmUpdateInventoryItem.run(
          invoiceType === InvoiceType.Sale ? -item.quantity : item.quantity,
          item.inventoryId,
        );
      }
      return;
    }

    raise('Select a customer or vendor account');
  }

  private postJournalsForPersistedInvoice(
    invoiceType: InvoiceType,
    invoiceId: number,
    invoice: Invoice,
  ): void {
    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    if (hasMultiple) {
      const itemsByAccount = groupBy(invoice.invoiceItems, (item) => {
        return multipleIds[invoice.invoiceItems.indexOf(item)];
      });

      forEach(itemsByAccount, (groupItems, accountIdStr) => {
        const accountId = toNumber(accountIdStr);
        const groupTotalRaw = groupItems.reduce((sum, item) => {
          return (
            sum + InvoiceService.getInvoiceItemTotal(item, item.price || 0)
          );
        }, 0);
        const groupTotalAmount = Math.round(groupTotalRaw);
        const groupDiscountPercentage =
          this.pricingService.getPolicyDiscountPercentForInventoryIds(
            accountId,
            groupItems.map((item) => item.inventoryId),
          );

        this.createJournalEntry(
          invoiceType,
          invoice,
          accountId,
          groupTotalAmount,
          invoiceId,
          groupDiscountPercentage,
        );
      });

      const extraDiscount = toNumber(invoice.extraDiscount) || 0;
      if (extraDiscount > 0) {
        const discountAccount = this.accountService.getAccountByName(
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
        this.createExtraDiscountJournalEntry(
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
        const discountAccount = this.accountService.getAccountByName(
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
        this.createJournalEntry(
          invoiceType,
          invoice,
          accountId,
          totalAmount + extraDiscount,
          invoiceId,
          this.pricingService.getPolicyDiscountPercentForInventoryIds(
            accountId,
            invoice.invoiceItems.map((item) => item.inventoryId),
          ),
        );
        this.createExtraDiscountJournalEntry(
          invoiceType,
          invoice,
          discountAccountId,
          creditAccountId,
          extraDiscount,
          invoiceId,
        );
      } else {
        this.createJournalEntry(
          invoiceType,
          invoice,
          accountId,
          totalAmount,
          invoiceId,
          this.pricingService.getPolicyDiscountPercentForInventoryIds(
            accountId,
            invoice.invoiceItems.map((item) => item.inventoryId),
          ),
        );
      }
      return;
    }

    raise('Select a customer or vendor account');
  }

  private createJournalEntry(
    invoiceType: InvoiceType,
    invoice: Invoice,
    accountId: number,
    amount: number,
    invoiceId: number,
    discountPercentage?: number,
  ): boolean {
    const { debitAccountId, creditAccountId } = this.getTransactionAccounts(
      invoiceType,
      accountId,
    );

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
  private createExtraDiscountJournalEntry(
    invoiceType: InvoiceType,
    invoice: Invoice,
    discountAccountId: number,
    creditAccountId: number,
    extraDiscountAmount: number,
    invoiceId: number,
  ): boolean {
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

  private getTransactionAccounts(
    invoiceType: InvoiceType,
    accountId: number,
  ): {
    debitAccountId: number;
    creditAccountId: number;
  } {
    const accounts = this.stmGetSalePurchaseAccounts.all() as Array<{
      id: number;
      name: string;
    }>;
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
  getSalesPerformance(filters: {
    startDate: string;
    endDate: string;
    groupBy?: 'day' | 'week' | 'month';
    groupByPolicy?: boolean;
    compareStartDate?: string;
    compareEndDate?: string;
  }): Record<string, unknown> {
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
      ...(this.db
        .prepare(
          `
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
        )
        .get(sqlStartDate, sqlEndDate) as Record<string, number>),
      ...(this.db
        .prepare(
          `
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
        )
        .get(sqlStartDate, sqlEndDate) as Record<string, number>),
    };

    // returned sale invoices (isReturned=1)
    const returnMetrics = this.db
      .prepare(
        `
      SELECT
        COUNT(*) AS returnCount,
        COALESCE(SUM(i.totalAmount), 0) AS returnAmount
      FROM invoices i
      WHERE i.invoiceType = 'Sale'
        AND i.isReturned = 1
        AND i.returnedAt >= ? AND i.returnedAt <= ?
    `,
      )
      .get(sqlStartDate, sqlEndDate) as Record<string, number>;

    // quotation backlog (isQuotation=1)
    const quotationMetrics = this.db
      .prepare(
        `
      SELECT
        COUNT(*) AS quotationCount,
        COALESCE(SUM(i.totalAmount), 0) AS quotationAmount
      FROM invoices i
      WHERE i.invoiceType = 'Sale'
        AND i.isQuotation = 1
        AND i.isReturned = 0
    `,
      )
      .get() as Record<string, number>;

    // time series
    const seriesRaw = this.db
      .prepare(
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
      )
      .all(sqlStartDate, sqlEndDate) as Array<{
      period: string;
      amount: number;
      qty: number;
      invoiceCount: number;
    }>;

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
      const rows = this.db
        .prepare(
          `
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
        )
        .all(sqlStartDate, sqlEndDate) as Array<{
        groupName: string;
        groupId: number;
        totalAmount: number;
        invoiceCount: number;
        customerCount: number;
      }>;
      topGroups = rows.map((r) => ({
        groupId: r.groupId,
        groupName: r.groupName,
        totalAmount: r.totalAmount,
        invoiceCount: r.invoiceCount,
        customerCount: r.customerCount,
      }));
    } else {
      // Group by individual customer account (original behavior)
      const rows = this.db
        .prepare(
          `
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
        )
        .all(sqlStartDate, sqlEndDate) as Array<{
        groupName: string;
        groupId: number;
        groupCode: number | null;
        totalAmount: number;
        invoiceCount: number;
      }>;
      topGroups = rows.map((r) => ({
        groupId: r.groupId,
        groupName: r.groupName,
        groupCode: r.groupCode,
        totalAmount: r.totalAmount,
        invoiceCount: r.invoiceCount,
      }));
    }

    // top items
    const topItems = this.db
      .prepare(
        `
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
      )
      .all(sqlStartDate, sqlEndDate) as Array<{
      itemName: string;
      itemId: number;
      totalQty: number;
      totalAmount: number;
    }>;

    // returns detail
    const returnsDetail = this.db
      .prepare(
        `
      SELECT
        i.id, i.invoiceNumber, i.date, i.totalAmount, a.name AS customerName
      FROM invoices i
      JOIN account a ON a.id = i.accountId
      WHERE i.invoiceType = 'Sale'
        AND i.isReturned = 1
        AND i.returnedAt >= ? AND i.returnedAt <= ?
      ORDER BY i.returnedAt DESC
    `,
      )
      .all(sqlStartDate, sqlEndDate) as Array<{
      id: number;
      invoiceNumber: number;
      date: string;
      totalAmount: number;
      customerName: string;
    }>;

    // quotation backlog detail
    const quotationDetail = this.db
      .prepare(
        `
      SELECT
        i.id, i.invoiceNumber, i.date, i.totalAmount, a.name AS customerName
      FROM invoices i
      JOIN account a ON a.id = i.accountId
      WHERE i.invoiceType = 'Sale'
        AND i.isQuotation = 1
        AND i.isReturned = 0
      ORDER BY i.date DESC
    `,
      )
      .all() as Array<{
      id: number;
      invoiceNumber: number;
      date: string;
      totalAmount: number;
      customerName: string;
    }>;

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
      const postedCompare = this.db
        .prepare(
          `
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
        )
        .get(sqlCompareStart, sqlCompareEnd) as Record<string, number>;

      const returnCompare = this.db
        .prepare(
          `
        SELECT
          COUNT(*) AS returnCount,
          COALESCE(SUM(i.totalAmount), 0) AS returnAmount
        FROM invoices i
        WHERE i.invoiceType = 'Sale'
          AND i.isReturned = 1
          AND i.returnedAt >= ? AND i.returnedAt <= ?
      `,
        )
        .get(sqlCompareStart, sqlCompareEnd) as Record<string, number>;

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
      const seriesRawCompare = this.db
        .prepare(
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
        )
        .all(sqlCompareStart, sqlCompareEnd) as Array<{
        period: string;
        amount: number;
        qty: number;
        invoiceCount: number;
      }>;

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
        const compareRows = this.db
          .prepare(
            `
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
          )
          .all(sqlCompareStart, sqlCompareEnd) as Array<{
          groupName: string;
          groupId: number;
          totalAmount: number;
          invoiceCount: number;
          customerCount: number;
        }>;
        comparisonTopGroups = compareRows.map((r) => ({
          groupId: r.groupId,
          groupName: r.groupName,
          totalAmount: r.totalAmount,
          invoiceCount: r.invoiceCount,
          customerCount: r.customerCount,
        }));
      } else {
        const compareRows = this.db
          .prepare(
            `
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
          )
          .all(sqlCompareStart, sqlCompareEnd) as Array<{
          groupName: string;
          groupId: number;
          groupCode: number | null;
          totalAmount: number;
          invoiceCount: number;
        }>;
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
      const compareItems = this.db
        .prepare(
          `
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
        )
        .all(sqlCompareStart!, sqlCompareEnd!) as Array<{
        itemName: string;
        itemId: number;
        totalQty: number;
        totalAmount: number;
      }>;
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

  private initPreparedStatements() {
    this.stmGetNextInvoiceNumber = this.db.prepare(`
      SELECT (COALESCE(MAX(invoiceNumber), 0) + 1) AS 'invoiceNumber'
      FROM invoices
      WHERE invoiceType = ? AND COALESCE(isQuotation, 0) = 0
    `);

    this.stmGetNextQuotationInvoiceNumber = this.db.prepare(`
      SELECT (COALESCE(MIN(invoiceNumber), 0) - 1) AS n
      FROM invoices
      WHERE invoiceType = ? AND COALESCE(isQuotation, 0) = 1
    `);

    this.stmInsertInvoice = this.db.prepare(`
      INSERT INTO invoices (date, accountId, invoiceType, totalAmount, invoiceNumber, extraDiscount, biltyNumber, cartons, extraDiscountAccountId, isQuotation)
      VALUES (@date, @accountId, @invoiceType, @totalAmount, @invoiceNumber, @extraDiscount, @biltyNumber, @cartons, @extraDiscountAccountId, @isQuotation)
    `);

    this.stmFinalizeQuotationConversion = this.db.prepare(`
      UPDATE invoices
      SET invoiceNumber = @invoiceNumber, isQuotation = 0
      WHERE id = @invoiceId
    `);

    this.stmAggregateInvoiceStockByLine = this.db.prepare(`
      SELECT
        ii.inventoryId AS inventoryId,
        SUM(ii.quantity) AS needQty,
        MAX(iv.name) AS itemName,
        MAX(iv.quantity) AS haveQty
      FROM invoice_items ii
      JOIN inventory iv ON iv.id = ii.inventoryId
      WHERE ii.invoiceId = @invoiceId
      GROUP BY ii.inventoryId
    `);

    this.stmInsertInvoiceItems = this.db.prepare(`
      INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId)
      VALUES (@invoiceId, @inventoryId, @quantity, (SELECT price FROM inventory WHERE id = @inventoryId), @discount, @accountId)
    `);

    this.stmUpdateInventoryItem = this.db.prepare(`
      UPDATE inventory
      SET quantity = quantity + ?
      WHERE id = ?
    `);

    // query detailed explanation:
    // 1. inner join invoices with account table to get the primary account name for each invoice
    // 2. left join invoice_items with account table to to include all invoices, even if they don't have invoice_items with an accountId
    // 3. left join account table with invoice_items to link the accountId to the account name
    // 4. combines all unique account names for an invoice into a single comma-separated string if multiple accounts are present for an invoice otherwise use the account name of the invoice.
    // 5. groups results by all non-aggregated columns, necessary because we're using GROUP_CONCAT, ensures we get one row per invoice with potentially multiple account names combined.
    this.stmGetInvoices = this.db.prepare(`
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
    `);

    this.stmGetQuotationInvoices = this.db.prepare(`
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
    `);

    this.stmGetInvoice = this.db.prepare(`
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
        a.code AS 'invoiceAccountCode',
        a.address AS 'invoiceAccountAddress',
        a.goodsName AS 'invoiceAccountGoodsName',
        ii.inventoryId,
        ii.quantity,
        ii.price,
        ii.discount,
        ii.accountId AS 'itemRowAccountId',
        iii.name as 'inventoryItemName',
        iii.description AS 'inventoryItemDescription',
        it.name as 'itemTypeName',
        COALESCE(
          CASE WHEN ii.accountId IS NOT NULL THEN a2.name ELSE NULL END,
          a.name
        ) AS 'accountName',
        COALESCE(
          CASE WHEN ii.accountId IS NOT NULL THEN a2.code ELSE NULL END,
          a.code
        ) AS 'accountCode'
      FROM invoices i
      JOIN account a ON i.accountId = a.id
      JOIN invoice_items ii ON i.id = ii.invoiceId
      JOIN inventory iii ON iii.id = ii.inventoryId
      LEFT JOIN item_types it ON it.id = iii.itemTypeId
      LEFT JOIN account a2 ON ii.accountId = a2.id AND ii.accountId IS NOT NULL
      WHERE i.id = @invoiceId
    `);

    this.stmDoesInvoiceExist = this.db.prepare(`
      SELECT invoiceNumber, COALESCE(isQuotation, 0) AS isQuotation
      FROM invoices
      WHERE invoiceType = @invoiceType AND id = @invoiceId
      LIMIT 1
    `);

    this.stmAdjacentInvoiceIdNext = this.db.prepare(`
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id > @invoiceId AND COALESCE(isQuotation, 0) = 0
      ORDER BY id ASC
      LIMIT 1
    `);

    this.stmAdjacentInvoiceIdPrev = this.db.prepare(`
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id < @invoiceId AND COALESCE(isQuotation, 0) = 0
      ORDER BY id DESC
      LIMIT 1
    `);

    this.stmAdjacentQuotationIdNext = this.db.prepare(`
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id > @invoiceId AND COALESCE(isQuotation, 0) = 1
      ORDER BY id ASC
      LIMIT 1
    `);

    this.stmAdjacentQuotationIdPrev = this.db.prepare(`
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id < @invoiceId AND COALESCE(isQuotation, 0) = 1
      ORDER BY id DESC
      LIMIT 1
    `);

    this.stmGetLastInvoiceNumber = this.db.prepare(`
      SELECT MAX(invoiceNumber) as lastInvoiceNumber
      FROM invoices
      WHERE invoiceType = ? AND COALESCE(isQuotation, 0) = 0
    `);

    this.stmGetInvoiceIdsFromMinId = this.db.prepare(`
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id >= @fromInvoiceId AND COALESCE(isQuotation, 0) = 0
      ORDER BY id ASC
    `);

    this.stmGetQuotationIdsFromMinId = this.db.prepare(`
      SELECT id
      FROM invoices
      WHERE invoiceType = @invoiceType AND id >= @fromInvoiceId AND COALESCE(isQuotation, 0) = 1
      ORDER BY id ASC
    `);

    this.stmGetSalePurchaseAccounts = this.db
      .prepare(
        `
          SELECT id, name
          FROM account
          WHERE LOWER(name) IN (?, ?)
        `,
      )
      .bind(InvoiceType.Purchase.toLowerCase(), InvoiceType.Sale.toLowerCase());

    this.stmUpdateInvoiceBiltyAndCartons = this.db.prepare(`
      UPDATE invoices
      SET biltyNumber = @biltyNumber, cartons = @cartons
      WHERE id = @invoiceId
    `);

    this.stmDeleteInvoiceItems = this.db.prepare(`
      DELETE FROM invoice_items WHERE invoiceId = @invoiceId
    `);

    this.stmGetInvoiceItemsForUpdate = this.db.prepare(`
      SELECT inventoryId, quantity FROM invoice_items WHERE invoiceId = @invoiceId
    `);

    this.stmGetInvoiceHeader = this.db.prepare(`
      SELECT invoiceNumber, invoiceType, COALESCE(isQuotation, 0) AS isQuotation
      FROM invoices WHERE id = @invoiceId
    `);

    this.stmGetPrevInvoiceDateForAccount = this.db.prepare(`
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
    `);

    this.stmGetNextInvoiceDateForAccount = this.db.prepare(`
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
    `);

    this.stmUpdateInvoiceHeader = this.db.prepare(`
      UPDATE invoices SET
        date = @date,
        accountId = @accountId,
        totalAmount = @totalAmount,
        extraDiscount = @extraDiscount,
        biltyNumber = @biltyNumber,
        cartons = @cartons,
        extraDiscountAccountId = @extraDiscountAccountId
      WHERE id = @invoiceId
    `);

    this.stmGetInventoryQuantity = this.db.prepare(`
      SELECT quantity FROM inventory WHERE id = ?
    `);

    this.stmGetInventoryNameQuantity = this.db.prepare(`
      SELECT name, quantity FROM inventory WHERE id = ?
    `);

    this.stmGetInvoiceForReturn = this.db.prepare(`
      SELECT invoiceType, COALESCE(isReturned, 0) AS isReturned, COALESCE(isQuotation, 0) AS isQuotation
      FROM invoices WHERE id = @invoiceId
    `);

    this.stmMarkInvoiceReturned = this.db.prepare(`
      UPDATE invoices SET
        isReturned = 1,
        returnedAt = datetime('now', 'localtime'),
        returnReason = @returnReason
      WHERE id = @invoiceId
    `);

    this.stmGetInvoicesInDateRange = this.db.prepare(`
      SELECT i.id, i.invoiceNumber, i.invoiceType, i.date, i.totalAmount, a.name AS 'accountName', i.biltyNumber, i.cartons,
             SUM(ii.quantity) AS 'totalQuantity'
      FROM invoices i
      JOIN account a ON i.accountId = a.id
      JOIN invoice_items ii ON i.id = ii.invoiceId
      WHERE i.invoiceType = 'Sale' AND COALESCE(i.isQuotation, 0) = 0
        AND ( @startDate IS NULL OR @endDate IS NULL OR i.date BETWEEN @startDate AND @endDate )
      GROUP BY i.id
      ORDER BY i.invoiceNumber
    `);
  }
}
