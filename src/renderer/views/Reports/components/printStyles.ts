/** compact print-specific styles for reports */
export const printStyles = `
  @media print {
    html, body {
      font-size: 10px !important;
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

    /* Set optimized margins for better space utilization */
    @page {
      margin: 0.3cm;
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

    /* Preserve original border colors and styles in print mode */
    .print-table * {
      -webkit-print-color-adjust: exact !important;
      color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* Hide interactive elements in print mode since they don't work */
    .print-table th svg,
    .print-table button,
    .print-table [role="button"] {
      display: none !important;
    }

    /* Ensure consistent border styling for all tables */
    .print-table table {
      border-collapse: collapse !important;
    }

    .print-table th,
    .print-table td {
      border-bottom: 1px solid #e5e7eb !important; /* very light grey */
    }

    /* Ensure text doesn't wrap in print mode for better layout */
    .print-table td,
    .print-table th {
      white-space: nowrap !important;
    }

    /* Optimize print container for maximum space usage */
    .print-container {
      max-width: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    /* Make tables use full width in print */
    .print-table {
      width: 100% !important;
      max-width: none !important;
    }
  }
`;
