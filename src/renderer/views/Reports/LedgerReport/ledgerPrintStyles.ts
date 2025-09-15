// Additional print styles specific to the ledger report
export const ledgerPrintStyles = `
  @media print {
    /* Optimize column widths for print - use more space */
    .data-table-wrapper th:nth-child(1),
    .data-table-wrapper td:nth-child(1) {
      width: 10% !important; /* Date column */
    }

    .data-table-wrapper th:nth-child(2),
    .data-table-wrapper td:nth-child(2) {
      width: 20% !important; /* Particulars column */
    }

    .data-table-wrapper th:nth-child(3),
    .data-table-wrapper td:nth-child(3) {
      width: 35% !important; /* Narration column - largest */
    }

    .data-table-wrapper th:nth-child(4),
    .data-table-wrapper td:nth-child(4) {
      width: 10% !important; /* Debit column */
    }

    .data-table-wrapper th:nth-child(5),
    .data-table-wrapper td:nth-child(5) {
      width: 10% !important; /* Credit column */
    }

    .data-table-wrapper th:nth-child(6),
    .data-table-wrapper td:nth-child(6) {
      width: 10% !important; /* Balance column */
    }

    .data-table-wrapper th,
    .data-table-wrapper td {
      padding: 1px 3px !important;
      line-height: 1.2 !important;
    }

    .data-table-wrapper th {
      font-weight: bold !important;
      text-align: left !important;
    }

    /* Allow text wrapping for Particulars and Narration in print */
    .data-table-wrapper td:nth-child(2),
    .data-table-wrapper td:nth-child(3) {
      white-space: normal !important;
      word-wrap: break-word !important;
      vertical-align: top !important;
    }

    /* Keep other columns on single line */
    .data-table-wrapper td:nth-child(1),
    .data-table-wrapper td:nth-child(4),
    .data-table-wrapper td:nth-child(5),
    .data-table-wrapper td:nth-child(6),
    .data-table-wrapper td:nth-child(7) {
      white-space: nowrap !important;
    }
  }
`;
