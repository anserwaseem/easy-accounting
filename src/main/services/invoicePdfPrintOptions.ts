/**
 * Chromium printToPDF options for invoice PDFs (batch save + UI Print).
 * Page stamps need displayHeaderFooter + a non-zero bottom margin band;
 * CSS @page margins alone do not reserve space for the footer template.
 * UI Print opens the stamped PDF in the OS viewer — window.print() and
 * printing a PDF via a hidden BrowserWindow cannot use these stamps reliably.
 */
export const INVOICE_PDF_PAGE_FOOTER_TEMPLATE = `
  <div style="width:100%;text-align:center;font-size:9px;color:#444;padding-top:2px;">
    <span class="pageNumber"></span> / <span class="totalPages"></span>
  </div>
`.trim();

/** empty header so Chromium does not inject default date/title chrome */
export const INVOICE_PDF_PAGE_HEADER_TEMPLATE = '<span></span>';

/** bottom margin in inches — room for the page-number footer strip */
export const INVOICE_PDF_FOOTER_MARGIN_INCHES = 0.4;

export type InvoicePdfPrintOptions = {
  printBackground: boolean;
  preferCSSPageSize: boolean;
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
  margins: {
    marginType: 'custom';
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
};

export const getInvoicePdfPrintOptions = (): InvoicePdfPrintOptions => ({
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: INVOICE_PDF_PAGE_HEADER_TEMPLATE,
  footerTemplate: INVOICE_PDF_PAGE_FOOTER_TEMPLATE,
  margins: {
    marginType: 'custom',
    // content inset still comes from CSS @page; only bottom band is for the stamp
    top: 0,
    bottom: INVOICE_PDF_FOOTER_MARGIN_INCHES,
    left: 0,
    right: 0,
  },
});
