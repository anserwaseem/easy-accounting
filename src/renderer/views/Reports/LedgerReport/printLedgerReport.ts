import { escape, toString } from 'lodash';
import { currency } from 'renderer/lib/constants';
import {
  getFormattedCurrency,
  getFormattedDebitCreditWithoutCurrency,
} from 'renderer/lib/utils';
import type { LedgerView } from '@/types';
import { extractJournalIdFromParticulars } from '@/shared/journalParticulars';
import { formatJournalDiscountLabel } from '@/lib/journalDiscountLabel';
import { formatDisplayDate } from '@/lib/displayDate';
import { printStyles } from '../components/printStyles';
import { formatLedgerParticularsForExport } from './formatLedgerParticulars';
import { ledgerPrintStyles } from './ledgerPrintStyles';
import { ledgerReportLabels, localizedBalanceType } from './ledgerLabels';

interface LedgerReportPrintOptions {
  rows: LedgerView[];
  accountName: string;
  dateSubtitle: string;
  totals: {
    totalDebit: number;
    totalCredit: number;
    totalDifference: number;
    totalType: string;
  };
  visibleColumns?: ReadonlySet<string>;
  language?: 'en' | 'ur';
}

const narrationTextForRow = (row: LedgerView): string => {
  const jid = extractJournalIdFromParticulars(row.particulars);
  if (row.journalSummary?.narration) return row.journalSummary.narration;
  if (jid != null) return `View Journal #${jid}`;
  return '';
};

const narrationLinesForRow = (row: LedgerView): string[] => {
  const base = narrationTextForRow(row);
  if (!row.journalSummary) return base ? [base] : [];

  const isSaleInvoice =
    typeof row.journalSummary.narration === 'string' &&
    /^sale invoice\b/i.test(row.journalSummary.narration);

  const lines: string[] = [];
  if (base) lines.push(base);
  // for grouped sale-invoice rows the bill#/discount live in the tier breakdown
  if (!row.tierBreakdown) {
    if (!isSaleInvoice && row.journalSummary.billNumber != null) {
      lines.push(`Bill#: ${row.journalSummary.billNumber}`);
    }
    const discountLabel = formatJournalDiscountLabel(
      row.journalSummary.discountPercentage,
    );
    if (discountLabel !== '-') {
      lines.push(`Discount: ${discountLabel}`);
    }
  }
  return lines;
};

const buildLedgerTableBodyHtml = (
  rows: LedgerView[],
  debitCreditZeroLabel: string,
  visibleColumns: ReadonlySet<string>,
): string => {
  return rows
    .map((row) => {
      const cells: string[] = [];
      if (visibleColumns.has('date'))
        cells.push(
          `<td>${row.date ? escape(formatDisplayDate(row.date)) : ''}</td>`,
        );
      if (visibleColumns.has('particulars'))
        cells.push(
          `<td>${escape(formatLedgerParticularsForExport(row, 'both'))}</td>`,
        );
      if (visibleColumns.has('tierBreakdown'))
        cells.push(
          `<td>${(row.tierBreakdown ?? '')
            .split('\n')
            .map((l) => escape(l))
            .join('<br/>')}</td>`,
        );
      if (visibleColumns.has('narration'))
        cells.push(
          `<td>${narrationLinesForRow(row)
            .map((l) => escape(l))
            .join(' | ')}</td>`,
        );
      if (visibleColumns.has('debit'))
        cells.push(
          `<td style="text-align:right">${escape(
            getFormattedDebitCreditWithoutCurrency(
              row.debit,
              debitCreditZeroLabel,
            ),
          )}</td>`,
        );
      if (visibleColumns.has('credit'))
        cells.push(
          `<td style="text-align:right">${escape(
            getFormattedDebitCreditWithoutCurrency(
              row.credit,
              debitCreditZeroLabel,
            ),
          )}</td>`,
        );
      if (visibleColumns.has('balance'))
        cells.push(
          `<td style="text-align:right">${escape(
            getFormattedCurrency(row.balance).replace(currency, '').trim(),
          )}</td>`,
        );
      if (visibleColumns.has('balanceType'))
        cells.push(`<td>${escape(toString(row.balanceType))}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
};

/**
 * prints ledger in a hidden iframe so the main window keeps the virtual table (no flash, no multi‑second freeze).
 */
const LEDGER_REPORT_COLUMN_IDS = new Set([
  'date',
  'particulars',
  'tierBreakdown',
  'narration',
  'debit',
  'credit',
  'balance',
  'balanceType',
]);

export const printLedgerReportIframe = (options: LedgerReportPrintOptions) => {
  const {
    rows,
    accountName,
    dateSubtitle,
    totals,
    visibleColumns: visibleColumnsOption,
    language = 'en',
  } = options;
  const visibleColumns = new Set(
    visibleColumnsOption ?? LEDGER_REPORT_COLUMN_IDS,
  );
  // do not print an empty tier column for non-grouped/single-account ledgers
  if (!rows.some((r) => r.tierBreakdown)) {
    visibleColumns.delete('tierBreakdown');
  }
  if (rows.length === 0) return;

  const debitCreditZeroLabel = toString(
    window.electron.store.get('debitCreditDefaultLabel') ?? ' ',
  );

  const title = escape(
    language === 'ur'
      ? `لیجر رپورٹ: ${accountName} — ${dateSubtitle}`
      : `Ledger Report for ${accountName}: ${dateSubtitle}`,
  );
  const bodyHtml = buildLedgerTableBodyHtml(
    rows,
    debitCreditZeroLabel,
    visibleColumns,
  );
  const footerDebit = escape(
    getFormattedCurrency(totals.totalDebit).replace(currency, '').trim(),
  );
  const footerCredit = escape(
    getFormattedCurrency(totals.totalCredit).replace(currency, '').trim(),
  );
  const footerDiff = escape(
    getFormattedCurrency(totals.totalDifference).replace(currency, '').trim(),
  );
  const localizedTotalType = localizedBalanceType(language, totals.totalType);
  const footerType = escape(toString(localizedTotalType));

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
<html lang="${language === 'ur' ? 'ur' : 'en'}" dir="${
    language === 'ur' ? 'rtl' : 'ltr'
  }">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
  <style>${printStyles}</style>
  <style>${ledgerPrintStyles}</style>
  <style>
    body { margin: 0; padding: 8px; font-family: system-ui, sans-serif; font-size: 10px; color: #000; }
    .data-table-wrapper th,
    .data-table-wrapper td {
      border: 1px solid #d9d9d9;
    }
    .data-table-wrapper {
      direction: ${language === 'ur' ? 'rtl' : 'ltr'};
    }
    ${
      language === 'ur'
        ? '.data-table-wrapper th { text-align: right !important; }'
        : ''
    }
    .ledger-print-title { text-align: center; font-size: 12px; font-weight: 700; margin-bottom: 8px; page-break-after: avoid; }
    /* totals as last tbody row — not tfoot — so print engines do not repeat it on every page */
    @media print {
      .ledger-print-totals-row { page-break-inside: avoid !important; }
    }
  </style>
</head>
<body>
  <div class="ledger-print-title print-header">${title}</div>
  <table class="data-table-wrapper print-table" style="width:100%;border-collapse:collapse;">
    <thead>
      <tr>
        ${
          visibleColumns.has('date')
            ? `<th>${escape(ledgerReportLabels(language).date)}</th>`
            : ''
        }
        ${
          visibleColumns.has('particulars')
            ? `<th>${escape(ledgerReportLabels(language).particulars)}</th>`
            : ''
        }
        ${
          visibleColumns.has('tierBreakdown')
            ? `<th>${escape(ledgerReportLabels(language).tierBreakdown)}</th>`
            : ''
        }
        ${
          visibleColumns.has('narration')
            ? `<th>${escape(ledgerReportLabels(language).narration)}</th>`
            : ''
        }
        ${
          visibleColumns.has('debit')
            ? `<th style="text-align:right">${escape(
                ledgerReportLabels(language).debit,
              )}</th>`
            : ''
        }
        ${
          visibleColumns.has('credit')
            ? `<th style="text-align:right">${escape(
                ledgerReportLabels(language).credit,
              )}</th>`
            : ''
        }
        ${
          visibleColumns.has('balance')
            ? `<th style="text-align:right">${escape(
                ledgerReportLabels(language).balance,
              )}</th>`
            : ''
        }
        ${
          visibleColumns.has('balanceType')
            ? `<th>${escape(ledgerReportLabels(language).balanceType)}</th>`
            : ''
        }
      </tr>
    </thead>
    <tbody>${bodyHtml}
      <tr class="ledger-print-totals-row">
        ${visibleColumns.has('date') ? '<td></td>' : ''}
        ${visibleColumns.has('particulars') ? '<td></td>' : ''}
        ${visibleColumns.has('tierBreakdown') ? '<td></td>' : ''}
        ${visibleColumns.has('narration') ? '<td></td>' : ''}
        ${
          visibleColumns.has('debit')
            ? `<td style="text-align:right"><strong>${footerDebit}</strong></td>`
            : ''
        }
        ${
          visibleColumns.has('credit')
            ? `<td style="text-align:right"><strong>${footerCredit}</strong></td>`
            : ''
        }
        ${
          visibleColumns.has('balance')
            ? `<td style="text-align:right"><strong>${footerDiff}</strong></td>`
            : ''
        }
        ${
          visibleColumns.has('balanceType')
            ? `<td><strong>${footerType}</strong></td>`
            : ''
        }
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
    if (timers.fallback !== undefined) {
      window.clearTimeout(timers.fallback);
    }
    win.removeEventListener('afterprint', cleanup);
    iframe.remove();
  };

  // fallback cleanup after 2 minutes
  timers.fallback = window.setTimeout(cleanup, 120_000);
  win.addEventListener('afterprint', cleanup);

  // yield so the print button can repaint before we open the dialog
  window.setTimeout(() => {
    win.focus();
    win.print();
  }, 0);
};
