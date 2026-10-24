import { escape } from 'lodash';
import type { VendorStockActivityItem } from 'types';
import {
  ACTIVITY_COLUMN_HEADERS,
  ACTIVITY_EQUATION,
} from './activityPresentation';

interface PrintVendorStockActivityOptions {
  rows: VendorStockActivityItem[];
  vendorName: string;
  dateSubtitle: string;
  visibleColumns?: ReadonlySet<string>;
}

/** print full activity rows without opening an Electron browser window */
export const printVendorStockActivityIframe = (
  options: PrintVendorStockActivityOptions,
): void => {
  const { rows, vendorName, dateSubtitle } = options;
  const visibleColumns =
    options.visibleColumns ??
    new Set([
      'inventoryName',
      'opening',
      'issued',
      'purchased',
      'purchaseReturned',
      'adjusted',
      'closing',
    ]);
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

  const renderCells = (row: VendorStockActivityItem): string => {
    const cells: string[] = [];
    if (visibleColumns.has('inventoryName'))
      cells.push(`<td>${escape(row.inventoryName)}</td>`);
    if (visibleColumns.has('opening'))
      cells.push(`<td class="num">${escape(String(row.opening))}</td>`);
    if (visibleColumns.has('issued'))
      cells.push(`<td class="num">${escape(String(row.issued))}</td>`);
    if (visibleColumns.has('purchased'))
      cells.push(`<td class="num">${escape(String(row.purchased))}</td>`);
    if (visibleColumns.has('purchaseReturned'))
      cells.push(
        `<td class="num">${escape(String(row.purchaseReturned))}</td>`,
      );
    if (visibleColumns.has('adjusted'))
      cells.push(`<td class="num">${escape(String(row.adjusted))}</td>`);
    if (visibleColumns.has('closing'))
      cells.push(`<td class="num">${escape(String(row.closing))}</td>`);
    return cells.join('');
  };
  const rowsHtml = rows.map((row) => `<tr>${renderCells(row)}</tr>`).join('');

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
  <p>${escape(dateSubtitle)}</p>
  <p>${escape(ACTIVITY_EQUATION)}</p>
  <table>
    <thead>
      <tr>
        ${
          visibleColumns.has('inventoryName')
            ? `<th>${ACTIVITY_COLUMN_HEADERS.inventoryName}</th>`
            : ''
        }
        ${
          visibleColumns.has('opening')
            ? `<th class="num">${ACTIVITY_COLUMN_HEADERS.opening}</th>`
            : ''
        }
        ${
          visibleColumns.has('issued')
            ? `<th class="num">${ACTIVITY_COLUMN_HEADERS.issued}</th>`
            : ''
        }
        ${
          visibleColumns.has('purchased')
            ? `<th class="num">${ACTIVITY_COLUMN_HEADERS.purchased}</th>`
            : ''
        }
        ${
          visibleColumns.has('purchaseReturned')
            ? `<th class="num">${ACTIVITY_COLUMN_HEADERS.purchaseReturned}</th>`
            : ''
        }
        ${
          visibleColumns.has('adjusted')
            ? `<th class="num">${ACTIVITY_COLUMN_HEADERS.adjusted}</th>`
            : ''
        }
        ${
          visibleColumns.has('closing')
            ? `<th class="num">${ACTIVITY_COLUMN_HEADERS.closing}</th>`
            : ''
        }
      </tr>
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
