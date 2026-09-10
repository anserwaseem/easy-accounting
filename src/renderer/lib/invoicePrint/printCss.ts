/** paged print rules for invoices — one table, browser splits pages, thead repeats */
export const INVOICE_PRINT_PAGE_CSS = `
@page {
  size: auto;
  margin: 10mm 8mm 16mm 8mm;
}

@media print {
  html,
  body,
  #root {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    background: #fff !important;
  }

  .invoice-print-root {
    padding: 0 !important;
    max-width: none !important;
    width: 100% !important;
  }

  .invoice-print-sheet {
    max-width: none !important;
    width: 100% !important;
  }

  .invoice-print-table {
    table-layout: fixed !important;
    width: 100% !important;
    max-width: 100% !important;
    border-collapse: collapse !important;
  }

  .invoice-print-table thead tr:first-child td {
    border: none !important;
  }

  .invoice-print-table thead {
    display: table-header-group !important;
  }

  .invoice-print-table tbody {
    display: table-row-group !important;
  }

  .invoice-print-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .invoice-print-note {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .invoice-print-table [data-print-footer] td {
    overflow: hidden !important;
  }

  .invoice-print-table [data-print-footer] td.invoice-print-total-amount {
    border-width: 2px !important;
    border-color: #171717 !important;
  }
}
`;
