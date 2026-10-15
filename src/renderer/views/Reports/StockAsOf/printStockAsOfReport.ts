import { escape } from 'lodash';
import { printHtmlInHiddenIframe } from '@/renderer/lib/printIframe';
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
}

const buildBodyHtml = (rows: StockAsOfPrintRow[]): string =>
  rows
    .map(
      (row) => `<tr>
  <td class="num">${
    row.listPosition != null ? escape(String(row.listPosition)) : escape('—')
  }</td>
  <td>${escape(row.item)}</td>
  <td>${escape(row.itemType || '—')}</td>
  <td class="num">${escape(String(row.unitPrice ?? 0))}</td>
  <td class="num">${escape(String(row.currentQuantity))}</td>
  <td class="num">${escape(String(row.quantityAsOf))}</td>
  <td class="num">${escape(String(row.quantityDiff))}</td>
</tr>`,
    )
    .join('');

/**
 * prints stock as-of in a hidden iframe so the virtual table in the main view does not affect output.
 */
export const printStockAsOfReportIframe = (options: PrintStockAsOfOptions) => {
  const { rows, subtitle } = options;
  if (rows.length === 0) return;

  const title = escape(`Stock as of date: ${subtitle}`);
  const bodyHtml = buildBodyHtml(rows);

  const html = `<!DOCTYPE html>
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
        <th class="num">List #</th>
        <th>Item</th>
        <th>Type</th>
        <th class="num">Price</th>
        <th class="num">Current</th>
        <th class="num">Qty (as of)</th>
        <th class="num">Δ vs as of</th>
      </tr>
    </thead>
    <tbody>${bodyHtml}</tbody>
  </table>
</body>
</html>`;

  printHtmlInHiddenIframe(html);
};
