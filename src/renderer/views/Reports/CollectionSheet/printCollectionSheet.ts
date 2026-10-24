import { escape } from 'lodash';
import { printStyles } from '../components/printStyles';
import {
  collectionSheetHeaders,
  collectionSheetTotals,
  collectionSheetTourTotals,
  collectionSheetUntouredTotal,
  formatSheetAmount,
  formatTourAmount,
  isUnpaidTourCell,
  tourColumnRange,
  type CollectionSheetLanguage,
  type CollectionSheetRow,
  type CollectionSheetTourColumn,
} from './buildCollectionSheetRows';

interface CollectionSheetPrintOptions {
  rows: CollectionSheetRow[];
  tours: CollectionSheetTourColumn[];
  showUntoured?: boolean;
  title: string;
  subtitle: string;
  language: CollectionSheetLanguage;
  visibleColumns?: ReadonlySet<string>;
}

const cell = (value: string, extra = ''): string =>
  `<td${extra}>${escape(value)}</td>`;

export const printCollectionSheetIframe = (
  options: CollectionSheetPrintOptions,
) => {
  const { rows, tours: allTours, title, subtitle, language } = options;
  const showUntoured = options.showUntoured ?? false;
  const visibleColumns: ReadonlySet<string> =
    options.visibleColumns ??
    new Set<string>([
      'shop',
      'city',
      'code',
      'billNumber',
      'billDate',
      'balance',
      ...allTours.map((tour) => `tour_${tour.id}`),
      ...(showUntoured ? ['untoured'] : []),
      'collection',
      'difference',
      'remaining',
    ]);
  const isVisible = (id: string): boolean => visibleColumns.has(id);
  const visibleTours: CollectionSheetTourColumn[] = allTours.filter((tour) =>
    isVisible(`tour_${tour.id}`),
  );
  const tours: CollectionSheetTourColumn[] = visibleTours;
  if (rows.length === 0) return;

  const headers = collectionSheetHeaders(language);
  const totals = collectionSheetTotals(rows);
  const untouredTotal = collectionSheetUntouredTotal(rows);
  const tourTotals = collectionSheetTourTotals(
    rows,
    tours.map((tour) => tour.id),
  );
  const dir = language === 'ur' ? 'rtl' : 'ltr';
  // fixed columns span both header rows when tour columns add a second one
  const span = tours.length > 0 ? ' rowspan="2"' : '';
  const tourCells = (row: CollectionSheetRow): string => {
    return tours
      .map((tour) => {
        const paid = row.tourPaid[tour.id];
        if (paid === null) {
          return `<td class="num tour continuation">—</td>`;
        }
        const balance = row.tourBalance[tour.id];
        const unpaid = isUnpaidTourCell(paid) ? ' unpaid' : '';
        const paidText = isUnpaidTourCell(paid) ? '0' : formatTourAmount(paid);
        const balanceText =
          balance == null
            ? ''
            : `<span class="tour-balance">${escape(
                formatSheetAmount(balance),
              )}</span>`;
        return `<td class="num tour${unpaid}"><span class="tour-paid">${escape(
          paidText,
        )}</span>${balanceText}</td>`;
      })
      .join('');
  };
  const untouredHead =
    showUntoured && isVisible('untoured')
      ? `<th class="num tour"${span}>${escape(headers.untoured)}</th>`
      : '';
  const untouredBody = (row: CollectionSheetRow): string =>
    showUntoured && isVisible('untoured')
      ? `<td class="num tour">${escape(formatTourAmount(row.untoured))}</td>`
      : '';
  const untouredFoot =
    showUntoured && isVisible('untoured')
      ? `<td class="num tour"><strong>${escape(
          formatTourAmount(untouredTotal),
        )}</strong></td>`
      : '';

  const body = rows
    .map((row) => {
      const codeCell =
        row.billIndex === 1
          ? `<td class="ltr fit code" dir="ltr">${escape(row.code)}</td>`
          : '<td class="ltr fit ditto" dir="ltr">//</td>';
      const shopCell =
        row.shopDisplay === '//'
          ? '<td class="ltr fit ditto" dir="ltr">//</td>'
          : `<td class="ltr fit" dir="ltr">${escape(row.shop)}</td>`;
      const cityCell =
        row.cityDisplay === '//'
          ? '<td class="ltr fit ditto" dir="ltr">//</td>'
          : `<td class="ltr fit" dir="ltr">${escape(row.city)}</td>`;
      return `<tr>
        ${isVisible('shop') ? shopCell : ''}
        ${isVisible('city') ? cityCell : ''}
        ${isVisible('code') ? codeCell : ''}
        ${
          isVisible('billNumber')
            ? `<td class="ltr fit" dir="ltr">${escape(row.billNumber)}</td>`
            : ''
        }
        ${
          isVisible('billDate')
            ? cell(row.billDate, ' class="ltr fit" dir="ltr"')
            : ''
        }
        ${
          isVisible('balance')
            ? `<td class="num fit">${escape(
                formatSheetAmount(row.balance),
              )}</td>`
            : ''
        }
        ${tourCells(row)}
        ${untouredBody(row)}
        ${isVisible('collection') ? '<td class="write"></td>' : ''}
        ${isVisible('difference') ? '<td class="write"></td>' : ''}
        ${isVisible('remaining') ? '<td class="write"></td>' : ''}
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
    td.code, th.code { font-weight: 600; }
    td.ditto { color: #bdbdbd; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    th.write, td.write { min-width: 14mm; }
    th.tour, td.tour { white-space: nowrap; }
    th.tour .tour-name { display: block; font-weight: 700; }
    th.tour .tour-range { display: block; font-weight: 400; font-size: 9px; }
    td.tour .tour-paid { display: block; }
    td.tour .tour-balance { display: block; font-size: 9px; color: #555; border-top: 1px dotted #bbb; margin-top: 1px; padding-top: 1px; }
    .legend { margin: -4px 0 8px; font-size: 9px; color: #555; }
    td.unpaid { background: #ececec; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .continuation { color: #9e9e9e; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tr { break-inside: avoid; }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>${escape(subtitle)}</p>
  ${
    tours.length > 0
      ? `<p class="legend">${escape(
          language === 'ur'
            ? 'ہر دورہ کالم: اوپر اس دورے کی وصولی، نیچے اس دورے کے اختتام پر بقایا (سرمئی)'
            : 'Tour columns: top = collected during the tour, grey = balance at the tour’s end',
        )}</p>`
      : ''
  }
  <table>
    <thead>
      <tr>
        ${
          isVisible('code')
            ? `<th class="ltr fit code" dir="ltr"${span}>${escape(
                headers.code,
              )}</th>`
            : ''
        }
        ${
          isVisible('billNumber')
            ? `<th class="ltr fit" dir="ltr"${span}>${escape(
                headers.bill,
              )}</th>`
            : ''
        }
        ${
          isVisible('billDate')
            ? `<th class="ltr fit" dir="ltr"${span}>${escape(
                headers.billDate,
              )}</th>`
            : ''
        }
        ${
          isVisible('balance')
            ? `<th class="num fit"${span}>${escape(headers.balance)}</th>`
            : ''
        }
        ${
          tours.length > 0
            ? `<th colspan="${tours.length}">${escape(headers.tours)}</th>`
            : ''
        }
        ${showUntoured && isVisible('untoured') ? untouredHead : ''}
        ${
          isVisible('collection')
            ? `<th class="write"${span}>${escape(headers.collection)}</th>`
            : ''
        }
        ${
          isVisible('difference')
            ? `<th class="write"${span}>${escape(headers.difference)}</th>`
            : ''
        }
        ${
          isVisible('remaining')
            ? `<th class="write"${span}>${escape(headers.remaining)}</th>`
            : ''
        }
      </tr>
      ${
        tours.length > 0
          ? `<tr>${tours
              .map(
                (tour) =>
                  `<th class="num tour" dir="ltr"><span class="tour-name">${escape(
                    tour.name,
                  )}</span><span class="tour-range">${escape(
                    tourColumnRange(tour),
                  )}${tour.clipped ? ' (part)' : ''}</span></th>`,
              )
              .join('')}</tr>`
          : ''
      }
    </thead>
    <tbody>
      ${body}
      <tr>
        ${
          isVisible('code')
            ? `<td class="ltr code" dir="ltr"><strong>${escape(
                headers.total,
              )}</strong></td>`
            : ''
        }
        ${isVisible('billNumber') ? '<td></td>' : ''}
        ${isVisible('billDate') ? '<td></td>' : ''}
        ${
          isVisible('balance')
            ? `<td class="num"><strong>${escape(
                formatSheetAmount(totals.balance),
              )}</strong></td>`
            : ''
        }
        ${tours
          .map(
            (tour) =>
              `<td class="num tour"><strong>${escape(
                formatTourAmount(tourTotals[tour.id]),
              )}</strong></td>`,
          )
          .join('')}
        ${untouredFoot}
        ${isVisible('collection') ? '<td class="write"></td>' : ''}
        ${isVisible('difference') ? '<td class="write"></td>' : ''}
        ${isVisible('remaining') ? '<td class="write"></td>' : ''}
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
