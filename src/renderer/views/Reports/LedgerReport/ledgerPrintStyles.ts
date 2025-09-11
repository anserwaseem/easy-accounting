// Additional print styles specific to the ledger report
export const ledgerPrintStyles = `
  @media print {
    /* Ledger-specific table styling - more compact for detailed data */
    .data-table-wrapper table {
      width: 100% !important;
    }

    .data-table-wrapper th,
    .data-table-wrapper td {
      padding: 1px 3px !important;
      font-size: 8px !important;
      line-height: 1.2 !important;
    }

    .data-table-wrapper th {
      font-weight: bold !important;
      text-align: left !important;
    }

    /* Add adequate spacing between cells for ledger readability */
    .data-table-wrapper td:not(:last-child),
    .data-table-wrapper th:not(:last-child) {
      padding-right: 6px !important;
    }
  }
`;
