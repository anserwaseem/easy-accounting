import { escape } from 'lodash';
import { printStyles } from '../components/printStyles';
import { stockAsOfPrintStyles } from './stockAsOfPrintStyles';

export interface StockAsOfPrintRow {
  listPosition: number | null;
  item: string;
  itemType: string | null;
  unitPrice: number;
  currentQuantity: number;
  quantityAsOf: number;
  quantityDiff: number;
}

interface PrintStockAsOfOptions {
  rows: StockAsOfPrintRow[];
  /** e.g. as-of date line for title */
  subtitle: string;
  /** visible column ids; defaults to every column when omitted */
  visibleColumns?: ReadonlySet<string>;
}

const ids = new Set([
  'listPosition',
  'item',
  'itemType',
  'unitPrice',
  'currentQuantity',
  'quantityAsOf',
  'quantityDiff',
]);

const buildBodyHtml = (
  rows: StockAsOfPrintRow[],
  visibleColumns: ReadonlySet<string>,
): string =>
  rows
    .map((row) => {
      const cells: string[] = [];
      if (visibleColumns.has('listPosition')) {
        cells.push(
          `<td class="num">${
            row.listPosition != null
              ? escape(String(row.listPosition))
              : escape('—')
          }</td>`,
        );
      }
      if (visibleColumns.has('item'))
        cells.push(`<td>${escape(row.item)}</td>`);
      if (visibleColumns.has('itemType'))
        cells.push(`<td>${escape(row.itemType || '—')}</td>`);
      if (visibleColumns.has('unitPrice'))
        cells.push(
          `<td class="num">${escape(String(row.unitPrice ?? 0))}</td>`,
        );
      if (visibleColumns.has('currentQuantity'))
        cells.push(
          `<td class="num">${escape(String(row.currentQuantity))}</td>`,
        );
      if (visibleColumns.has('quantityAsOf'))
        cells.push(`<td class="num">${escape(String(row.quantityAsOf))}</td>`);
      if (visibleColumns.has('quantityDiff'))
        cells.push(`<td class="num">${escape(String(row.quantityDiff))}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

/**
 * prints stock as-of in a hidden iframe so the virtual table in the main view does not affect output.
 */
export const printStockAsOfReportIframe = (options: PrintStockAsOfOptions) => {
  const { rows, subtitle, visibleColumns: visibleColumnsOption } = options;
  const visibleColumns = visibleColumnsOption ?? ids;
  if (rows.length === 0) return;

  const title = escape(`Stock as of date: ${subtitle}`);
  const headerCells: string[] = [];
  if (visibleColumns.has('listPosition'))
    headerCells.push('<th class="num">List #</th>');
  if (visibleColumns.has('item')) headerCells.push('<th>Item</th>');
  if (visibleColumns.has('itemType')) headerCells.push('<th>Type</th>');
  if (visibleColumns.has('unitPrice'))
    headerCells.push('<th class="num">Price</th>');
  if (visibleColumns.has('currentQuantity'))
    headerCells.push('<th class="num">Current</th>');
  if (visibleColumns.has('quantityAsOf'))
    headerCells.push('<th class="num">Qty (as of)</th>');
  if (visibleColumns.has('quantityDiff'))
    headerCells.push('<th class="num">Δ vs as of</th>');
  const headerHtml = headerCells.join('');
  const bodyHtml = buildBodyHtml(rows, visibleColumns);

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
  <style>${stockAsOfPrintStyles}</style>
  <style>
    body { margin: 0; padding: 8px; font-family: system-ui, sans-serif; font-size: 10px; color: #000; }
    .sa-print-title { text-align: center; font-size: 12px; font-weight: 700; margin-bottom: 8px; page-break-after: avoid; }
  </style>
</head>
<body>
  <div class="sa-print-title print-header">${title}</div>
  <table class="data-table-wrapper print-table" style="width:100%;border-collapse:collapse;">
    <thead>
      <tr>
        ${headerHtml}
      </tr>
    </thead>
    <tbody>${bodyHtml}</tbody>
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
