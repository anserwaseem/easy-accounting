/** compact print-specific styles for reports */
export const printStyles = `
  @media print {
    html, body {
      font-size: 9px !important;
      margin: 0 !important;
      padding: 0 !important;
      color: #000 !important;
    }

    .print-container {
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      color: #000 !important;
    }

    .print-card {
      padding: 0 !important;
      box-shadow: none !important;
      border: none !important;
      color: #000 !important;
    }

    .print-table {
      width: 100% !important;
      border-collapse: collapse !important;
      color: #000 !important;
      table-layout: auto !important;
    }

    .print-table th,
    .print-table td {
      padding: 1px 2px !important;
      line-height: 1 !important;
      color: #000 !important;
      white-space: nowrap !important;
    }

    .print-table th {
      font-weight: 700 !important;
    }

    .print-table .print-spacing-right {
      padding-right: 3px !important;
    }

    .print-table .print-spacing-left {
      padding-left: 3px !important;
    }

    .print-header {
      margin-bottom: 4px !important;
      font-size: 12px !important;
      color: #000 !important;
    }

    .print-caption {
      margin-top: 4px !important;
      font-size: 8px !important;
      color: #000 !important;
    }

    /* Only show the footer on the last page */
    .print-table tfoot {
      display: table-row-group !important;
    }

    /* Remove hover effects in print */
    .print-table tr:hover {
      background: none !important;
    }

    /* Force black text for all elements */
    .print-table tr,
    .print-table td,
    .print-table th,
    .print-table tfoot td {
      color: #000 !important;
      border-color: #000 !important;
    }

    /* Reduce height of rows */
    .print-table tr {
      height: auto !important;
      max-height: 1em !important;
    }

    /* Clear any background colors */
    .print-table tr,
    .print-table th,
    .print-table td,
    .print-table tfoot td {
      background-color: transparent !important;
    }

    /* Set proper margins for portrait mode */
    @page {
      margin: 0.5cm;
    }

    /* Hide loading states in print */
    .print-loading-state {
      display: none !important;
    }

    /* Force black text for specific elements that might have custom colors */
    .text-primary,
    .text-muted-foreground,
    .font-mono,
    .font-medium,
    h1, h2, h3, h4, h5, h6 {
      color: #000 !important;
    }
  }
`;
