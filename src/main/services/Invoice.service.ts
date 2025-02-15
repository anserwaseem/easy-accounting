import type { Database, Statement } from 'better-sqlite3';
import log from 'electron-log';
import { get, toNumber } from 'lodash';
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
import { JournalService } from './Journal.service';
import { cast } from '../utils/sqlite';
import { convertOrdinalDate } from '../utils/general';
import { INVOICE_DISCOUNT_PERCENTAGE } from '../utils/constants';

@logErrors
export class InvoiceService {
  private db: Database;

  private journalService!: JournalService;

  private stmGetNextInvoiceNumber!: Statement;

  private stmInsertInvoiceItems!: Statement;

  private stmUpdateInventoryItem!: Statement;

  private stmGetInvoices!: Statement;

  private stmGetInvoice!: Statement;

  private stmDoesInvoiceExist!: Statement;

  private stmGetLastInvoiceNumber!: Statement;

  private stmGetSalePurchaseAccounts!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.journalService = new JournalService();
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
      Omit<InvoiceView, 'invoiceItems'> & InvoiceItemView
    >;

    const res = result.reduce((prev, cur) => {
      if (!prev.id) {
        prev.id = cur.id;
        prev.date = cur.date;
        prev.invoiceNumber = cur.invoiceNumber;
        prev.invoiceType = cur.invoiceType;
        prev.totalAmount = cur.totalAmount;
        prev.accountName = cur.accountName;
        prev.invoiceItems = [];
      }
      prev.invoiceItems.push({
        quantity: cur.quantity,
        price: cur.price,
        inventoryItemName: cur.inventoryItemName,
        inventoryItemDescription: cur.inventoryItemDescription,
      });
      return prev;
    }, {} as InvoiceView);

    return res;
  }

  insertInvoice(invoiceType: InvoiceType, invoice: Invoice): number {
    return this.db.transaction(() => {
      return this.insertInvoiceWithoutTransaction(invoiceType, invoice);
    })();
  }

  insertInvoiceWithoutTransaction(
    invoiceType: InvoiceType,
    invoice: Invoice,
  ): number {
    if (!invoice.invoiceNumber) {
      log.error('No invoice number found while inserting invoice', invoice);
      return -1;
    }

    const totalAmount = this.getTotalAmount(invoice.invoiceItems);
    const stmInsertInvoice = `
      INSERT INTO invoices (date, accountId, invoiceType, totalAmount, invoiceNumber)
      VALUES (@date, @accountId, @invoiceType, @totalAmount, @invoiceNumber)
    `;
    const prpStmInsertInvoice = this.db.prepare(stmInsertInvoice);

    const invoiceResult = prpStmInsertInvoice.run({
      date: invoice.date,
      accountId: invoice.accountId,
      invoiceType,
      totalAmount,
      invoiceNumber: invoice.invoiceNumber,
    });

    const invoiceId = <number>invoiceResult.lastInsertRowid;

    // Process invoice items
    for (const item of invoice.invoiceItems) {
      this.stmInsertInvoiceItems.run({
        invoiceId,
        inventoryId: item.inventoryId,
        quantity: item.quantity,
      });

      this.stmUpdateInventoryItem.run(
        invoiceType === InvoiceType.Sale ? -item.quantity : item.quantity,
        item.inventoryId,
      );
    }

    // Get the appropriate accounts for journal entry
    const { debitAccountId, creditAccountId } = this.getTransactionAccounts(
      invoiceType,
      invoice,
    );

    this.journalService.insertJournal({
      id: -1,
      date: invoice.date,
      isPosted: true,
      narration: `${invoiceType} Invoice #${invoice.invoiceNumber}`,
      journalEntries: [
        {
          id: -1,
          accountId: debitAccountId,
          creditAmount: 0,
          debitAmount: totalAmount,
          journalId: 0,
        },
        {
          id: -1,
          accountId: creditAccountId,
          debitAmount: 0,
          creditAmount: totalAmount,
          journalId: 0,
        },
      ],
    });

    return invoice.invoiceNumber + 1;
  }

  getInvoicesInDateRange(
    startDate?: string,
    endDate?: string,
  ): InvoicesExport[] {
    const stmGetInvoicesInDateRange = this.db.prepare(`
      SELECT i.id, i.invoiceNumber, i.invoiceType, i.date, i.totalAmount, a.name AS 'accountName',
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

  private getTotalAmount(items: InvoiceItem[]): number {
    const stmGetInventoryPrices = this.db.prepare(`
      SELECT id, price
      FROM inventory
      WHERE id IN (${items.map((item) => item.inventoryId).join(', ')})
    `);

    const results = <{ id: number; price: number }[]>(
      stmGetInventoryPrices.all()
    );

    let totalAmount = 0;
    items.forEach((item) => {
      totalAmount +=
        item.quantity *
        (results.find((r) => r.id === item.inventoryId)?.price ?? 0);
    });

    return totalAmount;
  }

  private getTransactionAccounts(
    invoiceType: InvoiceType,
    invoice: Invoice,
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

    if (!purchaseAccount?.id || !salesAccount?.id) {
      throw new Error(
        "Please create both 'Purchase' and 'Sale' accounts first",
      );
    }

    if (invoiceType === InvoiceType.Purchase) {
      return {
        debitAccountId: purchaseAccount.id, // Debit Purchase
        creditAccountId: invoice.accountId, // Credit Vendor
      };
    }
    return {
      debitAccountId: invoice.accountId, // Debit Cash/Customer
      creditAccountId: salesAccount.id, // Credit Sales
    };
  }

  private initPreparedStatements() {
    this.stmGetNextInvoiceNumber = this.db.prepare(`
      SELECT (MAX(invoiceNumber) + 1) AS 'invoiceNumber'
      FROM invoices
      WHERE invoiceType = ?
    `);

    this.stmInsertInvoiceItems = this.db.prepare(`
      INSERT INTO invoice_items (invoiceId, inventoryId, quantity, price)
      VALUES (@invoiceId, @inventoryId, @quantity, (SELECT price FROM inventory WHERE id = @inventoryId))
    `);

    this.stmUpdateInventoryItem = this.db.prepare(`
      UPDATE inventory
      SET quantity = quantity + ?
      WHERE id = ?
    `);

    this.stmGetInvoices = this.db.prepare(`
      SELECT i.id, i.invoiceNumber, i.invoiceType, i.date, i.totalAmount, a.name AS 'accountName'
      FROM invoices i JOIN account a
      ON i.accountId = a.id
      WHERE i.invoiceType = ?
    `);

    this.stmGetInvoice = this.db.prepare(`
      SELECT i.id, i.date, i.invoiceNumber, i.invoiceType, i.totalAmount, ii.quantity, ii.price, iii.name as 'inventoryItemName', iii.description AS 'inventoryItemDescription',
        (SELECT a.name FROM account a JOIN invoices inv ON a.id = inv.accountId WHERE inv.id = @invoiceId) AS 'accountName'
      FROM invoices i
      JOIN invoice_items ii
      ON i.id = ii.invoiceId
      JOIN inventory iii
      ON iii.id = ii.inventoryId
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
  }
}
