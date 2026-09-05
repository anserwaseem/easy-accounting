import { escape } from 'lodash';
import type { VendorStockActivityItem } from 'types';

interface PrintVendorStockActivityOptions {
  rows: VendorStockActivityItem[];
  vendorName: string;
  startDate: string;
  endDate: string;
}

/** print full activity rows without opening an Electron browser window */
export const printVendorStockActivityIframe = (
  options: PrintVendorStockActivityOptions,
): void => {
  const { rows, vendorName, startDate, endDate } = options;
  if (rows.length === 0) return;

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

  const rowsHtml = rows
    .map(
      (row) => `<tr>
        <td>${escape(row.inventoryName)}</td>
        <td class="num">${escape(String(row.closing))}</td>
      </tr>`,
    )
    .join('');

  doc.open();
  doc.write(`<!DOCTYPE html>
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
  <p>${escape(startDate)} to ${escape(endDate)}</p>
  <table>
    <thead>
      <tr><th>Family</th><th class="num">Closing</th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
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
