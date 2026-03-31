import type { Database, Statement } from 'better-sqlite3';
import log from 'electron-log';
import { forEach, get, groupBy, toNumber, uniq } from 'lodash';
import { write, utils } from 'xlsx';
import {
  type HistoricInvoiceBatchRow,
  type Invoice,
  type InvoiceInsertOptions,
  InvoiceItem,
  InvoiceItemView,
  InvoiceType,
  InvoiceView,
  InvoicesExport,
  InvoicesView,
} from '../../types';
import { logErrors } from '../errorLogger';
import { DatabaseService } from './Database.service';
import {
  raise,
  convertOrdinalDate,
  normalizeToSqliteDate,
} from '../utils/general';
import { JournalService } from './Journal.service';
import { AccountService } from './Account.service';
import { PricingService } from './Pricing.service';
import { cast } from '../utils/sqlite';
import {
  INVOICE_DISCOUNT_PERCENTAGE,
  DISCOUNT_ACCOUNT_NAME,
} from '../utils/constants';

@logErrors
export class InvoiceService {
  private db: Database;

  private journalService!: JournalService;

  private accountService!: AccountService;

  private pricingService!: PricingService;

  private stmGetNextInvoiceNumber!: Statement;

  private stmInsertInvoice!: Statement;

  private stmInsertInvoiceItems!: Statement;

  private stmInsertInvoiceItemsExplicitPrice!: Statement;

  private stmUpdateInventoryItem!: Statement;

  private stmDoesAccountExistById!: Statement;

  private stmDoesInventoryExistById!: Statement;

  private stmGetInvoices!: Statement;

  private stmGetInvoice!: Statement;

  private stmDoesInvoiceExist!: Statement;

  private stmGetLastInvoiceNumber!: Statement;

  private stmGetSalePurchaseAccounts!: Statement;

  private stmUpdateInvoiceBiltyAndCartons!: Statement;

  private stmGetAccountNameById!: Statement;

  private stmGetAccountIdByName!: Statement;

  private stmGetAccountCodeById!: Statement;

  private stmGetAccountIdByCode!: Statement;

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

  getInvoices(invoiceType: InvoiceType): InvoicesView[] {
    const result = <InvoicesView[]>this.stmGetInvoices.all(invoiceType);
    return result;
  }

  getInvoice(invoiceId: number): InvoiceView {
    const result = this.stmGetInvoice.all({ invoiceId }) as Array<
      Omit<InvoiceView, 'invoiceItems'> &
        InvoiceItemView & { invoiceAccountName?: string }
    >;

    const isSingleAccount =
      uniq(result.map((item) => item.accountName)).length === 1;

    const res = result.reduce((prev, cur) => {
      if (!prev.id) {
        prev.id = cur.id;
        prev.date = cur.date;
        prev.invoiceNumber = cur.invoiceNumber;
        prev.invoiceType = cur.invoiceType;
        prev.totalAmount = cur.totalAmount;
        prev.extraDiscount = cur.extraDiscount;
        prev.biltyNumber = cur.biltyNumber;
        prev.cartons = cur.cartons;
        prev.createdAt = cur.createdAt;
        prev.updatedAt = cur.updatedAt;
        // header always shows real customer (invoice's primary account), not suffixed row accounts
        prev.accountName = cur.invoiceAccountName ?? cur.accountName;
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
      });
      return prev;
    }, {} as InvoiceView);

    return res;
  }

  insertInvoice(
    invoiceType: InvoiceType,
    invoice: Invoice,
    options?: InvoiceInsertOptions,
  ): { invoiceId: number; nextInvoiceNumber: number } {
    return this.db.transaction(() => {
      return this.insertInvoiceWithoutTransaction(
        invoiceType,
        invoice,
        options,
      );
    })();
  }

  /**
   * imports many invoices in one DB transaction (all commit or all rollback).
   * defaults: skip inventory qty changes; use inventory.price; apply customer discount policy (sales);
   * recompute totalAmount from resolved lines.
   */
  insertHistoricInvoicesAtomic(
    rows: HistoricInvoiceBatchRow[],
    options?: InvoiceInsertOptions,
  ): { inserted: number } {
    const merged: InvoiceInsertOptions = {
      skipInventoryUpdate: options?.skipInventoryUpdate !== false,
      useExplicitLinePrices: options?.useExplicitLinePrices === true,
      historicResolveInventoryPrices:
        options?.historicResolveInventoryPrices !== false,
      historicApplyPolicyDiscounts:
        options?.historicApplyPolicyDiscounts !== false,
      historicResolveAccountsByItemType:
        options?.historicResolveAccountsByItemType !== false,
      historicRecomputeTotalAmount:
        options?.historicRecomputeTotalAmount !== false,
    };
    return this.db.transaction(() => {
      let index = 0;
      for (const row of rows) {
        let result!: { invoiceId: number; nextInvoiceNumber: number };
        try {
          result = this.insertInvoiceWithoutTransaction(
            row.invoiceType,
            row.invoice,
            merged,
          );
        } catch (error) {
          const n = row.invoice?.invoiceNumber;
          const d = row.invoice?.date;
          raise(
            `historic import failed at index ${index} (invoiceNumber=${String(
              n,
            )}, type=${row.invoiceType}, date=${String(d)}): ${String(error)}`,
          );
        }
        if (result.invoiceId < 0) {
          raise(
            `historic import failed at index ${index} (invoiceNumber=${row.invoice.invoiceNumber}, type=${row.invoiceType})`,
          );
        }
        index += 1;
      }
      return { inserted: rows.length };
    })();
  }

  /**
   * batch-read inventory unit prices for historic purchase line resolution.
   */
  private getInventoryUnitPricesByIds(
    inventoryIds: number[],
  ): Map<number, number> {
    const uniqueIds = uniq(
      inventoryIds.filter((id) => Number.isFinite(id) && id > 0),
    );
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const stmt = this.db.prepare(
      `SELECT id, price FROM inventory WHERE id IN (${uniqueIds
        .map(() => '?')
        .join(', ')})`,
    );
    const rows = stmt.all(...uniqueIds.map((id) => cast(id))) as Array<{
      id: number;
      price: number;
    }>;
    return new Map(rows.map((r) => [r.id, r.price]));
  }

  private getInventoryItemTypeIdsByIds(
    inventoryIds: number[],
  ): Map<number, number | null> {
    const uniqueIds = uniq(
      inventoryIds.filter((id) => Number.isFinite(id) && id > 0),
    );
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const stmt = this.db.prepare(
      `SELECT id, itemTypeId FROM inventory WHERE id IN (${uniqueIds
        .map(() => '?')
        .join(', ')})`,
    );
    const rows = stmt.all(...uniqueIds.map((id) => cast(id))) as Array<{
      id: number;
      itemTypeId: number | null;
    }>;
    return new Map(rows.map((r) => [r.id, r.itemTypeId]));
  }

  private getInventoryItemTypeNamesByIds(
    inventoryIds: number[],
  ): Map<number, string> {
    const uniqueIds = uniq(
      inventoryIds.filter((id) => Number.isFinite(id) && id > 0),
    );
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const stmt = this.db.prepare(
      `SELECT i.id as id, COALESCE(it.name, 'F') as typeName
       FROM inventory i
       LEFT JOIN item_types it ON it.id = i.itemTypeId
       WHERE i.id IN (${uniqueIds.map(() => '?').join(', ')})`,
    );
    const rows = stmt.all(...uniqueIds.map((id) => cast(id))) as Array<{
      id: number;
      typeName: string;
    }>;
    return new Map(rows.map((r) => [r.id, String(r.typeName || 'F')]));
  }

  private getAccountNameById(accountId: number): string | null {
    const row = this.stmGetAccountNameById.get({
      id: cast(accountId),
    }) as { name?: string } | undefined;
    const name = String(row?.name ?? '').trim();
    return name || null;
  }

  private getAccountIdByName(name: string): number | null {
    const row = this.stmGetAccountIdByName.get({
      name,
    }) as { id?: number } | undefined;
    const id = toNumber(row?.id);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  private getAccountCodeById(accountId: number): string | null {
    const row = this.stmGetAccountCodeById.get({
      id: cast(accountId),
    }) as { code?: string | number } | undefined;
    const code = String(row?.code ?? '').trim();
    return code || null;
  }

  private getAccountIdByCode(code: string): number | null {
    const row = this.stmGetAccountIdByCode.get({
      code,
    }) as { id?: number } | undefined;
    const id = toNumber(row?.id);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  private static stripTypedSuffix(name: string): string {
    return String(name)
      .replace(/-(TT|T)\s*$/i, '')
      .trim();
  }

  private static typedAccountName(baseName: string, typeName: string): string {
    const base = InvoiceService.stripTypedSuffix(baseName);
    const t = String(typeName || 'F')
      .trim()
      .toUpperCase();
    if (t === 'T') return `${base}-T`;
    if (t === 'TT') return `${base}-TT`;
    return base;
  }

  private static stripTypedSuffixFromCode(code: string): string {
    return String(code)
      .replace(/-(TT|T)\s*$/i, '')
      .trim();
  }

  private static typedAccountCode(baseCode: string, typeName: string): string {
    const base = InvoiceService.stripTypedSuffixFromCode(baseCode);
    const t = String(typeName || 'F')
      .trim()
      .toUpperCase();
    if (t === 'T') return `${base}-T`;
    if (t === 'TT') return `${base}-TT`;
    return base;
  }

  /**
   * builds an effective invoice for historic imports by resolving inventory price,
   * applying policy discounts (sales), and recomputing totalAmount.
   */
  private buildInvoiceForHistoricImport(
    invoiceType: InvoiceType,
    invoice: Invoice,
    options: InvoiceInsertOptions,
  ): Invoice {
    const priceSource = invoice.importOverrides?.priceSource;
    const discountSource = invoice.importOverrides?.discountSource;
    const rawLineOverrides = invoice.importOverrides?.lineOverrides;
    const lineOverridePriceByInventoryId = new Map<number, number>(
      Array.isArray(rawLineOverrides)
        ? rawLineOverrides
            .filter(
              (o) =>
                o != null &&
                Number.isFinite(toNumber(o.inventoryId)) &&
                toNumber(o.inventoryId) > 0 &&
                Number.isFinite(toNumber(o.price)) &&
                toNumber(o.price) >= 0,
            )
            .map((o) => [toNumber(o.inventoryId), toNumber(o.price)])
        : [],
    );

    const resolvePrices =
      (priceSource == null || priceSource === 'inventory') &&
      options.historicResolveInventoryPrices === true;

    const applyPolicyDiscounts =
      (discountSource == null || discountSource === 'policy') &&
      options.historicApplyPolicyDiscounts === true &&
      invoiceType === InvoiceType.Sale;
    const recomputeTotal = options.historicRecomputeTotalAmount === true;
    const resolveAccountsByItemType =
      options.historicResolveAccountsByItemType === true &&
      invoiceType === InvoiceType.Sale;

    const priceById = resolvePrices
      ? this.getInventoryUnitPricesByIds(
          invoice.invoiceItems.map((item) => item.inventoryId),
        )
      : new Map<number, number>();

    const originalMultipleIds = invoice.accountMapping.multipleAccountIds;
    const originalHasMultiple =
      Array.isArray(originalMultipleIds) &&
      originalMultipleIds.length === invoice.invoiceItems.length &&
      originalMultipleIds.every((id) => typeof id === 'number' && id > 0);

    const headerAccountId =
      toNumber(invoice.accountMapping.singleAccountId) ||
      (originalHasMultiple ? toNumber(originalMultipleIds[0]) : 0);

    const baseAccountCode = headerAccountId
      ? this.getAccountCodeById(headerAccountId)
      : null;

    const itemTypeNameByInventoryId = resolveAccountsByItemType
      ? this.getInventoryItemTypeNamesByIds(
          invoice.invoiceItems.map((it) => it.inventoryId),
        )
      : new Map<number, string>();

    const resolvedMultipleIds = resolveAccountsByItemType
      ? invoice.invoiceItems.map((it, idx) => {
          const typeName = itemTypeNameByInventoryId.get(it.inventoryId) || 'F';
          const fallback =
            originalHasMultiple && Array.isArray(originalMultipleIds)
              ? toNumber(originalMultipleIds[idx])
              : headerAccountId;
          if (!baseAccountCode) return fallback;
          const desiredCode = InvoiceService.typedAccountCode(
            baseAccountCode,
            typeName,
          );
          const resolvedId = this.getAccountIdByCode(desiredCode);
          if (!resolvedId) {
            log.warn(
              'historic import: missing typed account for item type; falling back to provided accountId',
              {
                baseAccountId: headerAccountId,
                baseAccountCode,
                desiredCode,
                typeName,
              },
            );
            return fallback;
          }
          return resolvedId;
        })
      : originalMultipleIds;

    const hasMultiple =
      Array.isArray(resolvedMultipleIds) &&
      resolvedMultipleIds.length === invoice.invoiceItems.length &&
      resolvedMultipleIds.every((id) => typeof id === 'number' && id > 0);

    const invoiceItems = invoice.invoiceItems.map((item, index) => {
      const lineAccountId = hasMultiple
        ? toNumber(resolvedMultipleIds[index])
        : headerAccountId;

      let invPrice = toNumber(item.price);
      const overridden = lineOverridePriceByInventoryId.get(item.inventoryId);
      if (overridden != null) {
        invPrice = overridden;
      } else if (priceSource !== 'json' && resolvePrices) {
        invPrice = toNumber(priceById.get(item.inventoryId) ?? 0);
      }

      if (resolvePrices && invPrice === 0) {
        log.warn(
          'historic import: inventory.price is 0 while resolving line price',
          { inventoryId: item.inventoryId },
        );
      }

      const policyDiscount = applyPolicyDiscounts
        ? this.pricingService.getAutoDiscount(lineAccountId, item.inventoryId)
        : toNumber(item.discount) || 0;

      return {
        ...item,
        price: invPrice,
        discount: policyDiscount,
      };
    });

    const nextAccountMapping = resolveAccountsByItemType
      ? (() => {
          if (!hasMultiple) return invoice.accountMapping;
          const unique = uniq(resolvedMultipleIds as number[]);
          if (unique.length === 1) {
            return { singleAccountId: unique[0] };
          }
          return {
            singleAccountId: headerAccountId || unique[0],
            multipleAccountIds: resolvedMultipleIds as number[],
          };
        })()
      : invoice.accountMapping;

    if (!recomputeTotal) {
      return { ...invoice, invoiceItems, accountMapping: nextAccountMapping };
    }

    const extra = toNumber(invoice.extraDiscount) || 0;

    // section rounding: each item-type section subtotal is rounded to cents first, then summed.
    const itemTypeByInventoryId = this.getInventoryItemTypeIdsByIds(
      invoiceItems.map((i) => i.inventoryId),
    );
    const sectionRawSums = invoiceItems.reduce((acc, item) => {
      const key = itemTypeByInventoryId.get(item.inventoryId) ?? null;
      const raw =
        InvoiceService.getInvoiceItemTotal(item, toNumber(item.price)) || 0;
      acc.set(key, (acc.get(key) ?? 0) + raw);
      return acc;
    }, new Map<number | null, number>());
    const linesGrossRounded = Array.from(sectionRawSums.values()).reduce(
      (sumRupees, rawSection) => sumRupees + Math.round(toNumber(rawSection)),
      0,
    );

    return {
      ...invoice,
      invoiceItems,
      accountMapping: nextAccountMapping,
      totalAmount: linesGrossRounded - extra,
    };
  }

  private insertInvoiceLineItem(
    invoiceType: InvoiceType,
    invoiceId: number,
    item: InvoiceItem,
    accountId: number,
    options?: InvoiceInsertOptions,
  ): void {
    const accountExists = this.stmDoesAccountExistById.get({
      id: cast(accountId),
    }) as { count: number };
    if ((accountExists?.count ?? 0) === 0) {
      raise(`accountId=${accountId} does not exist`);
    }
    const inventoryExists = this.stmDoesInventoryExistById.get({
      id: cast(item.inventoryId),
    }) as { count: number };
    if ((inventoryExists?.count ?? 0) === 0) {
      raise(`inventoryId=${item.inventoryId} does not exist`);
    }

    const useExplicit = options?.useExplicitLinePrices === true;
    if (useExplicit) {
      const price = toNumber(item.price);
      if (!Number.isFinite(price) || price < 0) {
        raise(
          'historic import requires each line item to have a finite price >= 0',
        );
      }
      this.stmInsertInvoiceItemsExplicitPrice.run({
        invoiceId,
        inventoryId: item.inventoryId,
        quantity: item.quantity,
        price,
        discount: toNumber(item.discount) || 0,
        accountId,
      });
    } else {
      this.stmInsertInvoiceItems.run({
        invoiceId,
        inventoryId: item.inventoryId,
        quantity: item.quantity,
        discount: toNumber(item.discount) || 0,
        accountId,
      });
    }
    if (options?.skipInventoryUpdate !== true) {
      this.stmUpdateInventoryItem.run(
        invoiceType === InvoiceType.Sale ? -item.quantity : item.quantity,
        item.inventoryId,
      );
    }
  }

  private insertInvoiceWithoutTransaction(
    invoiceType: InvoiceType,
    invoice: Invoice,
    options?: InvoiceInsertOptions,
  ): { invoiceId: number; nextInvoiceNumber: number } {
    const invalid = { invoiceId: -1, nextInvoiceNumber: -1 };
    if (!invoice.invoiceNumber) {
      log.error('No invoice number found while inserting invoice', invoice);
      return invalid;
    }

    const effectiveInvoice =
      options?.historicResolveInventoryPrices === true ||
      options?.historicApplyPolicyDiscounts === true ||
      options?.historicResolveAccountsByItemType === true ||
      options?.historicRecomputeTotalAmount === true
        ? this.buildInvoiceForHistoricImport(invoiceType, invoice, {
            useExplicitLinePrices: options?.useExplicitLinePrices === true,
            historicResolveInventoryPrices:
              options?.historicResolveInventoryPrices === true,
            historicApplyPolicyDiscounts:
              options?.historicApplyPolicyDiscounts === true,
            historicResolveAccountsByItemType:
              options?.historicResolveAccountsByItemType === true,
            historicRecomputeTotalAmount:
              options?.historicRecomputeTotalAmount === true,
          })
        : invoice;

    const invoiceForInsert: Invoice = {
      ...effectiveInvoice,
      date: normalizeToSqliteDate(effectiveInvoice.date),
    };

    const hasLinePriceOverrides = Array.isArray(
      invoiceForInsert.importOverrides?.lineOverrides,
    );
    // per-invoice override: when priceSource=json OR lineOverrides exist, force explicit line prices into invoice_items.
    const insertOptions: InvoiceInsertOptions =
      invoiceForInsert.importOverrides?.priceSource === 'json' ||
      hasLinePriceOverrides
        ? { ...options, useExplicitLinePrices: true }
        : options ?? {};

    const totalAmount = invoiceForInsert.totalAmount ?? 0;
    const extraDiscount = toNumber(invoiceForInsert.extraDiscount) || 0;

    const multipleIds = invoiceForInsert.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoiceForInsert.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    // multiple accounts (e.g. type-based split or sections) - multiple journals
    if (hasMultiple) {
      // use primary party (real customer) for invoice header so display shows unsuffixed name
      const primaryAccountId =
        toNumber(invoiceForInsert.accountMapping.singleAccountId) ||
        multipleIds[0];
      const primaryExists = this.stmDoesAccountExistById.get({
        id: cast(primaryAccountId),
      }) as { count: number };
      if ((primaryExists?.count ?? 0) === 0) {
        raise(`invoice header accountId=${primaryAccountId} does not exist`);
      }

      for (const id of uniq(multipleIds)) {
        const exists = this.stmDoesAccountExistById.get({ id: cast(id) }) as {
          count: number;
        };
        if ((exists?.count ?? 0) === 0) {
          raise(`invoice line accountId=${id} does not exist`);
        }
      }

      const invoiceResult = this.stmInsertInvoice.run({
        date: invoiceForInsert.date,
        accountId: primaryAccountId,
        invoiceType,
        totalAmount,
        invoiceNumber: invoiceForInsert.invoiceNumber,
        extraDiscount,
        biltyNumber: invoiceForInsert.biltyNumber,
        cartons: invoiceForInsert.cartons,
      });
      const invoiceId = <number>invoiceResult.lastInsertRowid;

      const itemsByAccount = groupBy(invoiceForInsert.invoiceItems, (item) => {
        return multipleIds[invoiceForInsert.invoiceItems.indexOf(item)];
      });

      forEach(itemsByAccount, (groupItems, accountId) => {
        const groupRaw = groupItems.reduce((sum, item) => {
          return (
            sum + InvoiceService.getInvoiceItemTotal(item, item.price || 0)
          );
        }, 0);
        // round each section/group total to nearest rupee before journal posting
        const groupTotalAmount = Math.round(toNumber(groupRaw));
        const groupDiscountPercentage =
          this.pricingService.getPolicyDiscountPercentForInventoryIds(
            toNumber(accountId),
            groupItems.map((item) => item.inventoryId),
          );

        for (const item of groupItems) {
          this.insertInvoiceLineItem(
            invoiceType,
            invoiceId,
            item,
            toNumber(accountId),
            insertOptions,
          );
        }

        this.createJournalEntry(
          invoiceType,
          invoiceForInsert,
          toNumber(accountId),
          groupTotalAmount,
          groupDiscountPercentage,
        );
      });

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
          toNumber(invoiceForInsert.extraDiscountAccountId) || multipleIds[0];
        if (!creditAccountId || !multipleIds.includes(creditAccountId)) {
          raise('Extra discount requires a valid account selection.');
        }
        this.createExtraDiscountJournalEntry(
          invoiceType,
          invoiceForInsert,
          discountAccount!.id,
          creditAccountId,
          extraDiscount,
        );
      }
      return {
        invoiceId,
        nextInvoiceNumber: invoice.invoiceNumber + 1,
      };
    }

    // all items use the same account - single journal
    if (invoiceForInsert.accountMapping.singleAccountId) {
      const accountId = invoiceForInsert.accountMapping.singleAccountId;
      const accountExists = this.stmDoesAccountExistById.get({
        id: cast(accountId),
      }) as { count: number };
      if ((accountExists?.count ?? 0) === 0) {
        raise(`invoice header accountId=${accountId} does not exist`);
      }

      const invoiceResult = this.stmInsertInvoice.run({
        date: invoiceForInsert.date,
        accountId,
        invoiceType,
        totalAmount,
        invoiceNumber: invoiceForInsert.invoiceNumber,
        extraDiscount,
        biltyNumber: invoiceForInsert.biltyNumber,
        cartons: invoiceForInsert.cartons,
      });
      const invoiceId = <number>invoiceResult.lastInsertRowid;

      for (const item of invoiceForInsert.invoiceItems) {
        this.insertInvoiceLineItem(
          invoiceType,
          invoiceId,
          item,
          accountId,
          insertOptions,
        );
      }

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
          toNumber(invoiceForInsert.extraDiscountAccountId) ?? accountId;
        this.createJournalEntry(
          invoiceType,
          invoiceForInsert,
          accountId,
          totalAmount + extraDiscount,
          this.pricingService.getPolicyDiscountPercentForInventoryIds(
            accountId,
            invoiceForInsert.invoiceItems.map((item) => item.inventoryId),
          ),
        );
        this.createExtraDiscountJournalEntry(
          invoiceType,
          invoiceForInsert,
          discountAccountId,
          creditAccountId,
          extraDiscount,
        );
      } else {
        this.createJournalEntry(
          invoiceType,
          invoiceForInsert,
          accountId,
          totalAmount,
          this.pricingService.getPolicyDiscountPercentForInventoryIds(
            accountId,
            invoiceForInsert.invoiceItems.map((item) => item.inventoryId),
          ),
        );
      }
      return {
        invoiceId,
        nextInvoiceNumber: invoice.invoiceNumber + 1,
      };
    }

    return invalid;
  }

  getInvoicesInDateRange(
    startDate?: string,
    endDate?: string,
  ): InvoicesExport[] {
    const stmGetInvoicesInDateRange = this.db.prepare(`
      SELECT i.id, i.invoiceNumber, i.invoiceType, i.date, i.totalAmount, a.name AS 'accountName', i.biltyNumber, i.cartons,
             SUM(ii.quantity) AS 'totalQuantity'
      FROM invoices i
      JOIN account a ON i.accountId = a.id
      JOIN invoice_items ii ON i.id = ii.invoiceId
      WHERE i.invoiceType = 'Sale' ${
        startDate && endDate ? 'AND i.date BETWEEN @startDate AND @endDate' : ''
      }
      GROUP BY i.id
      ORDER BY i.invoiceNumber
    `);

    const result = stmGetInvoicesInDateRange.all({
      startDate,
      endDate,
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
    });

    return toNumber(get(result, 'invoiceNumber', 0));
  }

  getLastInvoiceNumber(invoiceType: InvoiceType): number {
    const result = <{ lastInvoiceNumber: number } | undefined>(
      this.stmGetLastInvoiceNumber.get(invoiceType)
    );
    return result?.lastInvoiceNumber ?? 0;
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

  private createJournalEntry(
    invoiceType: InvoiceType,
    invoice: Invoice,
    accountId: number,
    amount: number,
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
  ): boolean {
    if (extraDiscountAmount <= 0) return true;
    return this.journalService.insertJournal({
      id: -1,
      date: invoice.date,
      isPosted: true,
      narration: `${invoiceType} Invoice #${invoice.invoiceNumber} (extra discount)`,
      billNumber: invoice.invoiceNumber,
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

  private getTotalAmount(items: InvoiceItem[]): number {
    const stmGetInventoryPrices = this.db.prepare(`
      SELECT id, price
      FROM inventory
      WHERE id IN (${items.map((item) => item.inventoryId).join(', ')})
    `);

    const results = <{ id: number; price: number }[]>(
      stmGetInventoryPrices.all()
    );

    // let totalAmount = 0;
    // items.forEach((item) => {
    //   const price = results.find((r) => r.id === item.inventoryId)?.price ?? 0;
    //   const { quantity, discount } = item;
    //   totalAmount += quantity * price * (1 - discount / 100);
    // });

    const totalAmount = items.reduce(
      (total, item) =>
        total +
        InvoiceService.getInvoiceItemTotal(
          item,
          results.find((r) => r.id === item.inventoryId)?.price ?? 0,
        ),
      0,
    );
    return totalAmount;
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

  private initPreparedStatements() {
    this.stmGetNextInvoiceNumber = this.db.prepare(`
      SELECT (MAX(invoiceNumber) + 1) AS 'invoiceNumber'
      FROM invoices
      WHERE invoiceType = ?
    `);

    this.stmInsertInvoice = this.db.prepare(`
      INSERT INTO invoices (date, accountId, invoiceType, totalAmount, invoiceNumber, extraDiscount, biltyNumber, cartons)
      VALUES (@date, @accountId, @invoiceType, @totalAmount, @invoiceNumber, @extraDiscount, @biltyNumber, @cartons)
    `);

    this.stmInsertInvoiceItems = this.db.prepare(`
      INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId)
      VALUES (@invoiceId, @inventoryId, @quantity, (SELECT price FROM inventory WHERE id = @inventoryId), @discount, @accountId)
    `);

    this.stmInsertInvoiceItemsExplicitPrice = this.db.prepare(`
      INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price, discount, accountId)
      VALUES (@invoiceId, @inventoryId, @quantity, @price, @discount, @accountId)
    `);

    this.stmUpdateInventoryItem = this.db.prepare(`
      UPDATE inventory
      SET quantity = quantity + ?
      WHERE id = ?
    `);

    this.stmDoesAccountExistById = this.db.prepare(`
      SELECT COUNT(1) AS count
      FROM account
      WHERE id = @id
      LIMIT 1
    `);

    this.stmDoesInventoryExistById = this.db.prepare(`
      SELECT COUNT(1) AS count
      FROM inventory
      WHERE id = @id
      LIMIT 1
    `);

    this.stmGetAccountNameById = this.db.prepare(`
      SELECT name
      FROM account
      WHERE id = @id
      LIMIT 1
    `);

    this.stmGetAccountIdByName = this.db.prepare(`
      SELECT id
      FROM account
      WHERE LOWER(TRIM(name)) = LOWER(TRIM(@name))
      LIMIT 1
    `);

    this.stmGetAccountCodeById = this.db.prepare(`
      SELECT code
      FROM account
      WHERE id = @id
      LIMIT 1
    `);

    this.stmGetAccountIdByCode = this.db.prepare(`
      SELECT id
      FROM account
      WHERE LOWER(TRIM(code)) = LOWER(TRIM(@code))
      LIMIT 1
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
        COALESCE(
          NULLIF(GROUP_CONCAT(DISTINCT a2.name), ''),
          a.name
        ) AS 'accountName',
        i.biltyNumber,
        i.cartons
      FROM invoices i
      JOIN account a ON i.accountId = a.id
      LEFT JOIN invoice_items ii ON i.id = ii.invoiceId AND ii.accountId IS NOT NULL
      LEFT JOIN account a2 ON ii.accountId = a2.id
      WHERE i.invoiceType = ?
      GROUP BY i.id, i.invoiceNumber, i.invoiceType, i.date, i.totalAmount, a.name, i.biltyNumber, i.cartons
    `);

    this.stmGetInvoice = this.db.prepare(`
      SELECT
        i.id,
        i.date,
        i.invoiceNumber,
        i.invoiceType,
        i.totalAmount,
        i.extraDiscount,
        i.biltyNumber,
        i.cartons,
        i.createdAt,
        i.updatedAt,
        a.name AS 'invoiceAccountName',
        ii.inventoryId,
        ii.quantity,
        ii.price,
        ii.discount,
        iii.name as 'inventoryItemName',
        iii.description AS 'inventoryItemDescription',
        it.name as 'itemTypeName',
        COALESCE(
          CASE WHEN ii.accountId IS NOT NULL THEN a2.name ELSE NULL END,
          a.name
        ) AS 'accountName'
      FROM invoices i
      JOIN account a ON i.accountId = a.id
      JOIN invoice_items ii ON i.id = ii.invoiceId
      JOIN inventory iii ON iii.id = ii.inventoryId
      LEFT JOIN item_types it ON it.id = iii.itemTypeId
      LEFT JOIN account a2 ON ii.accountId = a2.id AND ii.accountId IS NOT NULL
      WHERE i.id = @invoiceId
    `);

    this.stmDoesInvoiceExist = this.db.prepare(`
      SELECT invoiceNumber
      FROM invoices
      WHERE invoiceType = @invoiceType AND id = @invoiceId
      LIMIT 1
    `);

    this.stmGetLastInvoiceNumber = this.db.prepare(`
      SELECT MAX(invoiceNumber) as lastInvoiceNumber
      FROM invoices
      WHERE invoiceType = ?
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
  }
}
