import { escape } from 'lodash';
import { printStyles } from '../components/printStyles';
import {
  collectionSheetHeaders,
  collectionSheetTotals,
  collectionSheetTourTotals,
  formatSheetAmount,
  formatTourAmount,
  isUnpaidTourCell,
  tourColumnHeader,
  type CollectionSheetLanguage,
  type CollectionSheetRow,
  type CollectionSheetTourColumn,
} from './buildCollectionSheetRows';

interface CollectionSheetPrintOptions {
  rows: CollectionSheetRow[];
  tours: CollectionSheetTourColumn[];
  title: string;
  subtitle: string;
  language: CollectionSheetLanguage;
}

const cell = (value: string, extra = ''): string =>
  `<td${extra}>${escape(value)}</td>`;

export const printCollectionSheetIframe = (
  options: CollectionSheetPrintOptions,
) => {
  const { rows, tours, title, subtitle, language } = options;
  if (rows.length === 0) return;

  const headers = collectionSheetHeaders(language);
  const totals = collectionSheetTotals(rows);
  const tourTotals = collectionSheetTourTotals(
    rows,
    tours.map((tour) => tour.id),
  );
  const dir = language === 'ur' ? 'rtl' : 'ltr';
  // fixed columns span both header rows when tour columns add a second one
  const span = tours.length > 0 ? ' rowspan="2"' : '';
  const tourCells = (row: CollectionSheetRow): string =>
    tours
      .map((tour) => {
        const paid = row.tourPaid[tour.id];
        const unpaid = isUnpaidTourCell(paid) ? ' unpaid' : '';
        return `<td class="num tour${unpaid}">${escape(
          formatTourAmount(paid),
        )}</td>`;
      })
      .join('');
  const body = rows
    .map((row) => {
      const dittoClass =
        row.addressDisplay === '//'
          ? ` class="ditto${language === 'ur' ? ' ditto-right' : ''}" dir="ltr"`
          : '';
      const addressCell =
        row.addressDisplay === '//'
          ? `<td${dittoClass}>//</td>`
          : cell(row.addressDisplay);
      return `<tr>
        ${cell(String(row.serial), ' class="num"')}
        <td>${escape(row.shop)}</td>
        ${addressCell}
        ${cell(row.code, ' class="ltr fit" dir="ltr"')}
        ${cell(row.billNumber, ' class="ltr fit" dir="ltr"')}
        ${cell(row.billDate, ' class="ltr fit" dir="ltr"')}
        <td class="num fit">${escape(formatSheetAmount(row.balance))}</td>
        <td class="num">${escape(formatSheetAmount(row.collected))}</td>
        ${tourCells(row)}
        <td class="write"></td>
        <td class="write"></td>
        <td class="write"></td>
      </tr>`;
    })
    .join('');

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

  const safeTitle = escape(title);
  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="${language === 'ur' ? 'ur' : 'en'}" dir="${dir}">
<head>
  <meta charset="utf-8"/>
  <title>${safeTitle}</title>
  <style>${printStyles}</style>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    @media print {
      @page { size: A4 landscape; margin: 8mm; }
    }
    body { margin: 0; padding: 8px; font-family: system-ui, sans-serif; font-size: 11px; color: #000; }
    h1 { text-align: center; font-size: 14px; margin: 0 0 4px; }
    p { text-align: center; margin: 0 0 8px; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
    th { font-size: 10px; }
    td.num, th.num { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
    th.ltr, td.ltr { text-align: left; direction: ltr; }
    th.fit, td.fit { width: 1%; white-space: nowrap; padding-left: 3px; padding-right: 3px; }
    td.ditto { color: #bdbdbd; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td.ditto-right { text-align: right; }
    th.write, td.write { min-width: 16mm; }
    th.tour, td.tour { white-space: nowrap; }
    td.unpaid { background: #ececec; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tr { break-inside: avoid; }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>${escape(subtitle)}</p>
  <table>
    <thead>
      <tr>
        <th class="num"${span}>${escape(headers.serial)}</th>
        <th${span}>${escape(headers.shop)}</th>
        <th${span}>${escape(headers.address)}</th>
        <th class="ltr fit" dir="ltr"${span}>${escape(headers.code)}</th>
        <th class="ltr fit" dir="ltr"${span}>${escape(headers.bill)}</th>
        <th class="ltr fit" dir="ltr"${span}>${escape(headers.billDate)}</th>
        <th class="num fit"${span}>${escape(headers.balance)}</th>
        <th class="num"${span}>${escape(headers.collected)}</th>
        ${
          tours.length > 0
            ? `<th colspan="${tours.length}">${escape(headers.tours)}</th>`
            : ''
        }
        <th class="write"${span}>${escape(headers.collection)}</th>
        <th class="write"${span}>${escape(headers.difference)}</th>
        <th class="write"${span}>${escape(headers.remaining)}</th>
      </tr>
      ${
        tours.length > 0
          ? `<tr>${tours
              .map(
                (tour) =>
                  `<th class="num tour" dir="ltr">${escape(
                    tourColumnHeader(tour),
                  )}</th>`,
              )
              .join('')}</tr>`
          : ''
      }
    </thead>
    <tbody>
      ${body}
      <tr>
        <td></td>
        <td><strong>${escape(headers.total)}</strong></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td class="num"><strong>${escape(
          formatSheetAmount(totals.balance),
        )}</strong></td>
        <td class="num"><strong>${escape(
          formatSheetAmount(totals.collected),
        )}</strong></td>
        ${tours
          .map(
            (tour) =>
              `<td class="num tour"><strong>${escape(
                formatTourAmount(tourTotals[tour.id]),
              )}</strong></td>`,
          )
          .join('')}
        <td class="write"></td>
        <td class="write"></td>
        <td class="write"></td>
      </tr>
    </tbody>
  </table>
</body>
</html>`);
  doc.close();

  let cleaned = false;
  const timers: { fallback?: number } = {};
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timers.fallback !== undefined) window.clearTimeout(timers.fallback);
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
