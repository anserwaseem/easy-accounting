import { escape } from 'lodash';
import type { VendorStockRow } from 'types';
import { printHtmlInHiddenIframe } from '@/renderer/lib/printIframe';
import { printStyles } from '../Reports/components/printStyles';

interface PrintVendorStockOptions {
  rows: VendorStockRow[];
  vendorLabel: string;
  totalQty: number;
  includeVendor: boolean;
}

const buildGroupHtml = (
  rows: VendorStockRow[],
  includeVendor: boolean,
): string => `
  <table class="item-group">
    <thead>
      <tr>
        ${includeVendor ? '<th>Vendor</th>' : ''}
        <th>Item</th>
        <th class="num">Qty</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row) => `<tr>
            ${includeVendor ? `<td>${escape(row.vendorAccountName)}</td>` : ''}
            <td>${escape(row.inventoryName)}</td>
            <td class="num">${escape(String(row.quantity))}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>
`;

/** prints at-vendor qty table in a hidden iframe (full row list). */
export const printVendorStockIframe = (options: PrintVendorStockOptions) => {
  const { rows, vendorLabel, totalQty, includeVendor } = options;
  if (rows.length === 0) return;

  const title = escape(`Vendor Stock: ${vendorLabel}`);
  const columnCount = includeVendor ? 2 : 3;
  const groupSize = Math.ceil(rows.length / columnCount);
  const groups = Array.from({ length: columnCount }, (_, index) =>
    buildGroupHtml(
      rows.slice(index * groupSize, (index + 1) * groupSize),
      includeVendor,
    ),
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
  <style>${printStyles}</style>
  <style>
    body { margin: 0; padding: 8px; font-family: system-ui, sans-serif; font-size: 10px; color: #000; }
    .vs-print-title { text-align: center; font-size: 12px; font-weight: 700; margin-bottom: 8px; page-break-after: avoid; }
    .item-groups { display: grid; grid-template-columns: repeat(${columnCount}, minmax(0, 1fr)); gap: 12px; align-items: start; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 2px 4px; font-size: 9px; line-height: 1.2; text-align: left; border-bottom: 1px solid #ddd; }
    th { font-weight: 700; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .item-group th:last-child, .item-group td:last-child { width: 24%; }
    .total { margin: 8px 0 0; padding-top: 4px; border-top: 1px solid #000; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  </style>
</head>
<body>
  <div class="vs-print-title print-header">${title}</div>
  <div class="item-groups">${groups}</div>
  <div class="total">Total quantity: ${escape(String(totalQty))}</div>
</body>
</html>`;

  printHtmlInHiddenIframe(html);
};
