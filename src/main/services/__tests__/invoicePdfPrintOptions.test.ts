import {
  getInvoicePdfPrintOptions,
  INVOICE_PDF_FOOTER_MARGIN_INCHES,
  INVOICE_PDF_PAGE_FOOTER_TEMPLATE,
  INVOICE_PDF_PAGE_HEADER_TEMPLATE,
} from '../invoicePdfPrintOptions';

describe('getInvoicePdfPrintOptions', () => {
  it('enables Chromium header/footer page stamps', () => {
    const options = getInvoicePdfPrintOptions();

    expect(options.displayHeaderFooter).toBe(true);
    expect(options.printBackground).toBe(true);
    expect(options.preferCSSPageSize).toBe(true);
  });

  it('footer template injects pageNumber and totalPages', () => {
    expect(INVOICE_PDF_PAGE_FOOTER_TEMPLATE).toContain('class="pageNumber"');
    expect(INVOICE_PDF_PAGE_FOOTER_TEMPLATE).toContain('class="totalPages"');
    expect(getInvoicePdfPrintOptions().footerTemplate).toBe(
      INVOICE_PDF_PAGE_FOOTER_TEMPLATE,
    );
  });

  it('uses an empty header template to avoid default chrome', () => {
    expect(getInvoicePdfPrintOptions().headerTemplate).toBe(
      INVOICE_PDF_PAGE_HEADER_TEMPLATE,
    );
    expect(INVOICE_PDF_PAGE_HEADER_TEMPLATE).not.toContain('class="title"');
    expect(INVOICE_PDF_PAGE_HEADER_TEMPLATE).not.toContain('class="date"');
  });

  it('reserves a custom bottom margin band for the footer', () => {
    const { margins } = getInvoicePdfPrintOptions();

    expect(margins.marginType).toBe('custom');
    expect(margins.bottom).toBe(INVOICE_PDF_FOOTER_MARGIN_INCHES);
    expect(margins.bottom).toBeGreaterThan(0);
    expect(margins.top).toBe(0);
    expect(margins.left).toBe(0);
    expect(margins.right).toBe(0);
  });
});
