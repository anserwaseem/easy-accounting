import { escape } from 'lodash';
import { printStyles } from '../components/printStyles';
import { inventoryHealthPrintStyles } from './inventoryHealthPrintStyles';
import { formatInventoryHealthLastInvoiceCell } from './formatInventoryHealthLastInvoiceCell';

/** row shape for print (no issues column; matches inventory health table minus flags) */
export interface InventoryHealthPrintRow {
  listPosition: number | null;
  item: string;
  itemType: string | null;
  price: number;
  onHandQty: number;
  soldQtyInDate: number;
  purchasedQtyInDate: number;
  adjustmentQtyInDate: number;
  lastSaleDate: string | null;
  lastSaleInvoiceNumber: number | null;
  lastPurchaseDate: string | null;
  lastPurchaseInvoiceNumber: number | null;
  daysSinceMovement: number | null;
  daysOfCover: number | null;
}

interface PrintInventoryHealthOptions {
  rows: InventoryHealthPrintRow[];
  dateSubtitle: string;
  showAdjustedColumn: boolean;
  /** visible column ids; defaults to every column when omitted */
  visibleColumns?: ReadonlySet<string>;
}

const isVisible = (visible: ReadonlySet<string>, id: string): boolean =>
  visible.has(id);

const buildBodyHtml = (
  rows: InventoryHealthPrintRow[],
  visibleColumns: ReadonlySet<string>,
): string => {
  return rows
    .map((row) => {
      const cells: string[] = [];
      if (isVisible(visibleColumns, 'listPosition')) {
        const listCell =
          row.listPosition != null
            ? escape(String(row.listPosition))
            : escape('—');
        cells.push(`<td class="num">${listCell}</td>`);
      }
      if (isVisible(visibleColumns, 'item')) {
        cells.push(`<td>${escape(row.item)}</td>`);
      }
      if (isVisible(visibleColumns, 'itemType')) {
        cells.push(`<td>${escape(row.itemType ?? '')}</td>`);
      }
      if (isVisible(visibleColumns, 'price')) {
        cells.push(`<td class="num">${escape(String(row.price ?? 0))}</td>`);
      }
      if (isVisible(visibleColumns, 'onHandQty')) {
        cells.push(
          `<td class="num">${escape(String(row.onHandQty ?? 0))}</td>`,
        );
      }
      if (isVisible(visibleColumns, 'soldQtyInDate')) {
        cells.push(
          `<td class="num">${escape(String(row.soldQtyInDate ?? 0))}</td>`,
        );
      }
      if (isVisible(visibleColumns, 'purchasedQtyInDate')) {
        cells.push(
          `<td class="num">${escape(String(row.purchasedQtyInDate ?? 0))}</td>`,
        );
      }
      if (isVisible(visibleColumns, 'adjustmentQtyInDate')) {
        cells.push(
          `<td class="num">${escape(
            String(row.adjustmentQtyInDate ?? 0),
          )}</td>`,
        );
      }
      if (isVisible(visibleColumns, 'lastSaleDate')) {
        const lastSale = escape(
          formatInventoryHealthLastInvoiceCell(
            row.lastSaleDate,
            row.lastSaleInvoiceNumber ?? null,
          ) || '—',
        );
        cells.push(`<td>${lastSale}</td>`);
      }
      if (isVisible(visibleColumns, 'lastPurchaseDate')) {
        const lastPurch = escape(
          formatInventoryHealthLastInvoiceCell(
            row.lastPurchaseDate,
            row.lastPurchaseInvoiceNumber ?? null,
          ) || '—',
        );
        cells.push(`<td>${lastPurch}</td>`);
      }
      if (isVisible(visibleColumns, 'daysSinceMovement')) {
        const daysM =
          row.daysSinceMovement != null
            ? escape(String(row.daysSinceMovement))
            : '';
        cells.push(`<td class="num">${daysM}</td>`);
      }
      if (isVisible(visibleColumns, 'daysOfCover')) {
        const daysC =
          row.daysOfCover != null ? escape(String(row.daysOfCover)) : '';
        cells.push(`<td class="num">${daysC}</td>`);
      }
      return `<tr>${cells.join('')}</tr>`;
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
  const {
    rows,
    dateSubtitle,
    showAdjustedColumn,
    visibleColumns: visibleColumnsOption,
  } = options;
  const visibleColumns =
    visibleColumnsOption ??
    new Set([
      'listPosition',
      'item',
      'itemType',
      'price',
      'onHandQty',
      'soldQtyInDate',
      'purchasedQtyInDate',
      'adjustmentQtyInDate',
      'lastSaleDate',
      'lastPurchaseDate',
      'daysSinceMovement',
      'daysOfCover',
    ]);
  const vc = (id: string) => visibleColumns.has(id);
  const effectiveVisibleColumns = new Set(visibleColumns);
  if (!showAdjustedColumn) {
    effectiveVisibleColumns.delete('adjustmentQtyInDate');
  }
  const showAdjusted = Boolean(showAdjustedColumn && vc('adjustmentQtyInDate'));
  const headerCells: string[] = [];
  if (effectiveVisibleColumns.has('listPosition'))
    headerCells.push('<th class="num">List #</th>');
  if (effectiveVisibleColumns.has('item')) headerCells.push('<th>Item</th>');
  if (effectiveVisibleColumns.has('itemType'))
    headerCells.push('<th>Type</th>');
  if (effectiveVisibleColumns.has('price'))
    headerCells.push('<th class="num">Price</th>');
  if (effectiveVisibleColumns.has('onHandQty'))
    headerCells.push('<th class="num">On hand</th>');
  if (effectiveVisibleColumns.has('soldQtyInDate'))
    headerCells.push('<th class="num">Sold</th>');
  if (effectiveVisibleColumns.has('purchasedQtyInDate'))
    headerCells.push('<th class="num">Purchased</th>');
  if (effectiveVisibleColumns.has('adjustmentQtyInDate') && showAdjusted)
    headerCells.push('<th class="num">Adjusted</th>');
  if (effectiveVisibleColumns.has('lastSaleDate'))
    headerCells.push('<th>Last sale</th>');
  if (effectiveVisibleColumns.has('lastPurchaseDate'))
    headerCells.push('<th>Last purchase</th>');
  if (effectiveVisibleColumns.has('daysSinceMovement'))
    headerCells.push('<th class="num">Days movement</th>');
  if (effectiveVisibleColumns.has('daysOfCover'))
    headerCells.push('<th class="num">Days cover</th>');
  const headerHtml = headerCells.join('');
  if (rows.length === 0) return;

  const title = escape(`Inventory Health: ${dateSubtitle}`);
  const bodyHtml = buildBodyHtml(rows, effectiveVisibleColumns);

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
