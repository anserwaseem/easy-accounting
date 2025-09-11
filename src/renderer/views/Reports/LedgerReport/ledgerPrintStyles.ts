// Additional print styles specific to the ledger report
export const ledgerPrintStyles = `
  @media print {
    /* Make the table more compact for print */
    .data-table-wrapper table {
      border-collapse: collapse !important;
      width: 100% !important;
    }

    .data-table-wrapper th,
    .data-table-wrapper td {
      padding: 1px 3px !important;
      font-size: 8px !important;
      border-bottom: 1px solid #e5e7eb !important; /* very light grey */
      line-height: 1.2 !important;
    }

    .data-table-wrapper th {
      font-weight: bold !important;
      text-align: left !important;
    }

    /* Hide info icon in print mode since tooltips don't work */
    .data-table-wrapper th svg {
      display: none !important;
    }

    /* Preserve original border colors and styles in print mode */
    .data-table-wrapper * {
      -webkit-print-color-adjust: exact !important;
      color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* Ensure the text doesn't wrap and stays on one line */
    .data-table-wrapper td,
    .data-table-wrapper th {
      white-space: nowrap !important;
    }

    /* Add adequate spacing between cells */
    .data-table-wrapper td:not(:last-child),
    .data-table-wrapper th:not(:last-child) {
      padding-right: 6px !important;
    }
  }
`;
