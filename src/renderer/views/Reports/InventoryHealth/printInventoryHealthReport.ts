import { escape } from 'lodash';
import { format } from 'date-fns';
import { printStyles } from '../components/printStyles';
import { inventoryHealthPrintStyles } from './inventoryHealthPrintStyles';

/** row shape for print (no issues column; matches inventory health table minus flags) */
export interface InventoryHealthPrintRow {
  item: string;
  itemType: string | null;
  price: number;
  onHandQty: number;
  soldQtyInDate: number;
  purchasedQtyInDate: number;
  adjustmentQtyInDate: number;
  lastSaleDate: string | null;
  lastPurchaseDate: string | null;
  daysSinceMovement: number | null;
  daysOfCover: number | null;
}

interface PrintInventoryHealthOptions {
  rows: InventoryHealthPrintRow[];
  dateSubtitle: string;
  showAdjustedColumn: boolean;
}

const formatDateCell = (v: string | null): string => {
  if (!v) return '';
  try {
    return escape(format(new Date(v), 'PP'));
  } catch {
    return '';
  }
};

const buildBodyHtml = (
  rows: InventoryHealthPrintRow[],
  showAdjusted: boolean,
): string => {
  return rows
    .map((row) => {
      const adjCell = showAdjusted
        ? `<td class="num">${escape(String(row.adjustmentQtyInDate ?? 0))}</td>`
        : '';
      const lastSale = formatDateCell(row.lastSaleDate);
      const lastPurch = formatDateCell(row.lastPurchaseDate);
      const daysM =
        row.daysSinceMovement != null
          ? escape(String(row.daysSinceMovement))
          : '';
      const daysC =
        row.daysOfCover != null ? escape(String(row.daysOfCover)) : '';
      return `<tr>
  <td>${escape(row.item)}</td>
  <td>${escape(row.itemType ?? '')}</td>
  <td class="num">${escape(String(row.price ?? 0))}</td>
  <td class="num">${escape(String(row.onHandQty ?? 0))}</td>
  <td class="num">${escape(String(row.soldQtyInDate ?? 0))}</td>
  <td class="num">${escape(String(row.purchasedQtyInDate ?? 0))}</td>
  ${adjCell}
  <td>${lastSale}</td>
  <td>${lastPurch}</td>
  <td class="num">${daysM}</td>
  <td class="num">${daysC}</td>
</tr>`;
    })
    .join('');
};

/**
 * prints inventory health in hidden iframe (full row list, no virtual scroll;
 * omits issues column for cleaner PDF).
 */
export const printInventoryHealthReportIframe = (
  options: PrintInventoryHealthOptions,
) => {
  const { rows, dateSubtitle, showAdjustedColumn } = options;
  if (rows.length === 0) return;

  const title = escape(`Inventory Health: ${dateSubtitle}`);
  const adjHeader = showAdjustedColumn ? '<th class="num">Adjusted</th>' : '';
  const bodyHtml = buildBodyHtml(rows, showAdjustedColumn);

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
  <style>${inventoryHealthPrintStyles}</style>
  <style>
    body { margin: 0; padding: 8px; font-family: system-ui, sans-serif; font-size: 10px; color: #000; }
    .ih-print-title { text-align: center; font-size: 12px; font-weight: 700; margin-bottom: 8px; page-break-after: avoid; }
  </style>
</head>
<body>
  <div class="ih-print-title print-header">${title}</div>
  <table class="data-table-wrapper print-table" style="width:100%;border-collapse:collapse;">
    <thead>
      <tr>
        <th>Item</th>
        <th>Type</th>
        <th class="num">Price</th>
        <th class="num">On hand</th>
        <th class="num">Sold</th>
        <th class="num">Purchased</th>
        ${adjHeader}
        <th>Last sale</th>
        <th>Last purchase</th>
        <th class="num">Days movement</th>
        <th class="num">Days cover</th>
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
