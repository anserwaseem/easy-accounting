import { escape } from 'lodash';
import type { PurchasesByVendorItem } from 'types';
import { printStyles } from '../components/printStyles';

interface PrintPurchasesByVendorOptions {
  rows: PurchasesByVendorItem[];
  vendorName: string;
  dateSubtitle: string;
  totalQty: number;
}

const buildGroupHtml = (rows: PurchasesByVendorItem[]): string => `
  <table class="item-group">
    <thead>
      <tr>
        <th>Item</th>
        <th class="num">Qty</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row) => `<tr>
            <td>${escape(row.itemName)}</td>
            <td class="num">${escape(String(row.quantity))}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>
`;

/** prints purchases-by-vendor item table in a hidden iframe (full row list). */
export const printPurchasesByVendorIframe = (
  options: PrintPurchasesByVendorOptions,
) => {
  const { rows, vendorName, dateSubtitle, totalQty } = options;
  if (rows.length === 0) return;

  const title = escape(`Purchases by Vendor: ${vendorName} — ${dateSubtitle}`);
  const groupSize = Math.ceil(rows.length / 3);
  const groups = Array.from({ length: 3 }, (_, index) =>
    buildGroupHtml(rows.slice(index * groupSize, (index + 1) * groupSize)),
  ).join('');

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: 'none',
    visibility: 'hidden',
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
  <style>${printStyles}</style>
  <style>
    body { margin: 0; padding: 8px; font-family: system-ui, sans-serif; font-size: 10px; color: #000; }
    .pbv-print-title { text-align: center; font-size: 12px; font-weight: 700; margin-bottom: 8px; page-break-after: avoid; }
    .item-groups { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; }
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
  <div class="pbv-print-title print-header">${title}</div>
  <div class="item-groups">${groups}</div>
  <div class="total">Total quantity: ${escape(String(totalQty))}</div>
</body>
</html>`);
  doc.close();

  let cleaned = false;
  const timers: { fallback?: number } = {};
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timers.fallback !== undefined) {
      window.clearTimeout(timers.fallback);
    }
    win.removeEventListener('afterprint', cleanup);
    iframe.remove();
  };

  timers.fallback = window.setTimeout(cleanup, 120_000);
  win.addEventListener('afterprint', cleanup);

  window.setTimeout(() => {
    win.focus();
    win.print();
  }, 0);
};
