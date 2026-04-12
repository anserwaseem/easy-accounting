/** compact print-specific styles for reports */
export const printStyles = `
  @media print {
    /* remove all height constraints from root elements */
    html, body, #root {
      font-size: 10px !important;
      margin: 0 !important;
      padding: 0 !important;
      color: #000 !important;
      height: auto !important;
      min-height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }

    /* remove height constraints from all parent containers */
    body > div,
    #root > div,
    div[class*="flex"],
    div[class*="h-screen"],
    div[class*="h-full"] {
      height: auto !important;
      min-height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }

    .print-container {
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      color: #000 !important;
      height: auto !important;
      overflow: visible !important;
    }

    .print-card {
      padding: 0 !important;
      box-shadow: none !important;
      border: none !important;
      color: #000 !important;
      height: auto !important;
      overflow: visible !important;
    }

    .print-table {
      width: 100% !important;
      border-collapse: collapse !important;
      color: #000 !important;
      table-layout: auto !important;
      page-break-inside: auto !important;
    }

    /* allow table rows to break across pages */
    .print-table tbody {
      display: table-row-group !important;
    }

    /* repeat table header on each page */
    .print-table thead {
      display: table-header-group !important;
    }

    /* ensure footer appears on last page */
    .print-table tfoot {
      display: table-footer-group !important;
    }

    /* totals row only once at end (table-footer-group repeats on every pdf page) */
    .print-table.print-tfoot-no-repeat tfoot {
      display: table-row-group !important;
    }

    /* allow rows to break across pages, but try to keep them together */
    .print-table tr {
      page-break-inside: avoid !important;
      page-break-after: auto !important;
    }

    /* prevent table cells from breaking */
    .print-table th,
    .print-table td {
      padding: 1px 2px !important;
      line-height: 1 !important;
      color: #000 !important;
      white-space: nowrap !important;
      page-break-inside: avoid !important;
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
      page-break-after: avoid !important;
    }

    .print-caption {
      margin-top: 4px !important;
      font-size: 8px !important;
      color: #000 !important;
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
      margin: 0.1cm 0.3cm 0 0;
      size: auto;
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

    /* no line under totals row (tfoot + black border-color override made this harsh in pdf) */
    .print-table tfoot td,
    .print-table tfoot th {
      border-bottom: none !important;
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
      height: auto !important;
      overflow: visible !important;
    }

    /* Make tables use full width in print */
    .print-table {
      width: 100% !important;
      max-width: none !important;
    }

    /* ensure containers allow content to flow across pages */
    .print-container,
    .print-container > div {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }

    /* allow content to break across pages */
    div, section, article {
      page-break-inside: auto !important;
    }

    /* remove flex constraints in print mode */
    .print-container.flex,
    div.flex {
      display: block !important;
    }

    .print-container .flex-grow,
    div.flex-grow {
      flex-grow: 0 !important;
      height: auto !important;
      min-height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }

    /* specific overrides for common layout patterns - must come after general rules */
    div[class*="overflow-y"],
    div[class*="overflow-hidden"],
    div[class*="h-screen"],
    div[class*="h-full"] {
      height: auto !important;
      min-height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }

    /* ensure content containers don't constrain height */
    div.flex-grow,
    div[class*="flex-grow"] {
      height: auto !important;
      min-height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }

    /* universal override for container elements - remove height constraints */
    div, section, article, main, aside {
      height: auto !important;
      min-height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      overflow-x: visible !important;
      overflow-y: visible !important;
    }

    /* ensure tables can expand naturally */
    table, thead, tbody, tfoot {
      height: auto !important;
      min-height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }
  }
`;
