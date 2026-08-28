import { InvoiceType } from '@/types';
import { getInvoiceDocumentBaseName } from '../invoiceDocumentName';

describe('getInvoiceDocumentBaseName', () => {
  it('keeps sale names bare so previously saved PDFs keep their naming', () => {
    expect(
      getInvoiceDocumentBaseName({
        invoiceType: InvoiceType.Sale,
        invoiceNumber: 12,
        isQuotation: false,
      }),
    ).toBe('12');
  });

  it('prefixes purchase rows, which reuse the same invoice numbers as sales', () => {
    expect(
      getInvoiceDocumentBaseName({
        invoiceType: InvoiceType.Purchase,
        invoiceNumber: 12,
        isQuotation: false,
      }),
    ).toBe('purchase-12');
  });

  it('separates sale and purchase quotations of the same number', () => {
    const saleQuotation = getInvoiceDocumentBaseName({
      invoiceType: InvoiceType.Sale,
      invoiceNumber: -5,
      isQuotation: true,
    });
    const purchaseQuotation = getInvoiceDocumentBaseName({
      invoiceType: InvoiceType.Purchase,
      invoiceNumber: -5,
      isQuotation: true,
    });

    // quotations persist a negative placeholder number; the human ref is its abs
    expect(saleQuotation).toBe('quotation-5');
    expect(purchaseQuotation).toBe('purchase-quotation-5');
    expect(saleQuotation).not.toBe(purchaseQuotation);
  });

  it('returns no name for a posted row without an invoice number', () => {
    expect(
      getInvoiceDocumentBaseName({
        invoiceType: InvoiceType.Sale,
        invoiceNumber: null,
        isQuotation: false,
      }),
    ).toBe('');
    expect(
      getInvoiceDocumentBaseName({
        invoiceType: InvoiceType.Purchase,
        invoiceNumber: undefined,
        isQuotation: false,
      }),
    ).toBe('');
  });
});
