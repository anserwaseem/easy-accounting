/** print layout for stock as-of iframe table (mirrors inventory health / ledger pattern) */
export const stockAsOfPrintStyles = `
  @media print {
    .data-table-wrapper {
      page-break-inside: auto !important;
    }

    .data-table-wrapper thead {
      display: table-header-group !important;
    }

    .data-table-wrapper tr {
      page-break-inside: avoid !important;
      page-break-after: auto !important;
    }

    .data-table-wrapper th,
    .data-table-wrapper td {
      page-break-inside: avoid !important;
      padding: 2px 4px !important;
      line-height: 1.2 !important;
      font-size: 9px !important;
    }

    .data-table-wrapper th {
      font-weight: bold !important;
      text-align: left !important;
    }

    .data-table-wrapper .num {
      text-align: right !important;
      white-space: nowrap !important;
    }

    .data-table-wrapper td:first-child,
    .data-table-wrapper th:first-child {
      white-space: normal !important;
      word-break: break-word !important;
      max-width: 32% !important;
    }
  }
`;
