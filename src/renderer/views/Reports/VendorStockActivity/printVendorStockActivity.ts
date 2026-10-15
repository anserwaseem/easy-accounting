import { escape } from 'lodash';
import type { VendorStockActivityItem } from 'types';
import { printHtmlInHiddenIframe } from '@/renderer/lib/printIframe';
import {
  ACTIVITY_COLUMN_HEADERS,
  ACTIVITY_EQUATION,
} from './activityPresentation';

interface PrintVendorStockActivityOptions {
  rows: VendorStockActivityItem[];
  vendorName: string;
  dateSubtitle: string;
}

/** print full activity rows without opening an Electron browser window */
export const printVendorStockActivityIframe = (
  options: PrintVendorStockActivityOptions,
): void => {
  const { rows, vendorName, dateSubtitle } = options;
  if (rows.length === 0) return;

  const rowsHtml = rows
    .map(
      (row) => `<tr>
        <td>${escape(row.inventoryName)}</td>
        <td class="num">${escape(String(row.opening))}</td>
        <td class="num">${escape(String(row.issued))}</td>
        <td class="num">${escape(String(row.purchased))}</td>
        <td class="num">${escape(String(row.purchaseReturned))}</td>
        <td class="num">${escape(String(row.adjusted))}</td>
        <td class="num">${escape(String(row.closing))}</td>
      </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escape(`At-vendor activity — ${vendorName}`)}</title>
  <style>
    @page { margin: 6mm; }
    body { margin: 0; padding: 0; font-family: system-ui, sans-serif; color: #000; }
    h1 { margin: 0 0 2px; font-size: 15px; }
    p { margin: 0 0 8px; font-size: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #ddd; padding: 3px 4px; text-align: left; font-size: 10px; }
    th { background: #f3f4f6; font-weight: 700; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  </style>
</head>
<body>
  <h1>At-vendor activity — ${escape(vendorName)}</h1>
  <p>${escape(dateSubtitle)}</p>
  <p>${escape(ACTIVITY_EQUATION)}</p>
  <table>
    <thead>
      <tr>
        <th>${ACTIVITY_COLUMN_HEADERS.inventoryName}</th>
        <th class="num">${ACTIVITY_COLUMN_HEADERS.opening}</th>
        <th class="num">${ACTIVITY_COLUMN_HEADERS.issued}</th>
        <th class="num">${ACTIVITY_COLUMN_HEADERS.purchased}</th>
        <th class="num">${ACTIVITY_COLUMN_HEADERS.purchaseReturned}</th>
        <th class="num">${ACTIVITY_COLUMN_HEADERS.adjusted}</th>
        <th class="num">${ACTIVITY_COLUMN_HEADERS.closing}</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;

  printHtmlInHiddenIframe(html);
};
