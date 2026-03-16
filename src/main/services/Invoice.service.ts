import type { Database, Statement } from 'better-sqlite3';
import log from 'electron-log';
import { forEach, get, groupBy, toNumber, uniq } from 'lodash';
import { write, utils } from 'xlsx';
import {
  type Invoice,
  InvoiceItem,
  InvoiceItemView,
  InvoiceType,
  InvoiceView,
  InvoicesExport,
  InvoicesView,
} from '../../types';
import { logErrors } from '../errorLogger';
import { DatabaseService } from './Database.service';
import { raise, convertOrdinalDate } from '../utils/general';
import { JournalService } from './Journal.service';
import { AccountService } from './Account.service';
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

  private stmGetNextInvoiceNumber!: Statement;

  private stmInsertInvoice!: Statement;

  private stmInsertInvoiceItems!: Statement;

  private stmUpdateInventoryItem!: Statement;

  private stmGetInvoices!: Statement;

  private stmGetInvoice!: Statement;

  private stmDoesInvoiceExist!: Statement;

  private stmGetLastInvoiceNumber!: Statement;

  private stmGetSalePurchaseAccounts!: Statement;

  private stmUpdateInvoiceBiltyAndCartons!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.journalService = new JournalService();
    this.accountService = new AccountService();
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

    const multipleIds = invoice.accountMapping.multipleAccountIds;
    const hasMultiple =
      Array.isArray(multipleIds) &&
      multipleIds.length === invoice.invoiceItems.length &&
      multipleIds.every((id) => typeof id === 'number' && id > 0);

    // multiple accounts (e.g. type-based split or sections) - multiple journals
    if (hasMultiple) {
      // use primary party (real customer) for invoice header so display shows unsuffixed name
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
      });
      const invoiceId = <number>invoiceResult.lastInsertRowid;

      const itemsByAccount = groupBy(invoice.invoiceItems, (item) => {
        return multipleIds[invoice.invoiceItems.indexOf(item)];
      });

      forEach(itemsByAccount, (groupItems, accountId) => {
        const groupTotalAmount = groupItems.reduce((sum, item) => {
          return (
            sum + InvoiceService.getInvoiceItemTotal(item, item.price || 0)
          );
        }, 0);

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
        );
      }
      return {
        invoiceId,
        nextInvoiceNumber: invoice.invoiceNumber + 1,
      };
    }

    // all items use the same account - single journal
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
      });
      const invoiceId = <number>invoiceResult.lastInsertRowid;

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
        );
        this.createExtraDiscountJournalEntry(
          invoiceType,
          invoice,
          discountAccountId,
          creditAccountId,
          extraDiscount,
        );
      } else {
        this.createJournalEntry(invoiceType, invoice, accountId, totalAmount);
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
