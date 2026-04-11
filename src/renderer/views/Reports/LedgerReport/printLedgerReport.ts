import { escape, toString } from 'lodash';
import { currency, dateFormatOptions } from 'renderer/lib/constants';
import {
  getFormattedCurrency,
  getFormattedDebitCreditWithoutCurrency,
} from 'renderer/lib/utils';
import type { LedgerView } from '@/types';
import { extractJournalIdFromParticulars } from '@/shared/journalParticulars';
import { printStyles } from '../components/printStyles';
import { ledgerPrintStyles } from './ledgerPrintStyles';

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
  if (!isSaleInvoice && row.journalSummary.billNumber != null) {
    lines.push(`Bill#: ${row.journalSummary.billNumber}`);
  }
  if (row.journalSummary.discountPercentage != null) {
    lines.push(`Discount: ${row.journalSummary.discountPercentage}%`);
  }
  return lines;
};

const buildLedgerTableBodyHtml = (
  rows: LedgerView[],
  debitCreditZeroLabel: string,
): string => {
  return rows
    .map((row) => {
      const particulars = escape(row.linkedAccountName ?? row.particulars);
      const narration = narrationLinesForRow(row)
        .map((l) => escape(l))
        .join(' | ');
      const dateStr = row.date
        ? escape(new Date(row.date).toLocaleString('en-US', dateFormatOptions))
        : '';
      const debit = escape(
        getFormattedDebitCreditWithoutCurrency(row.debit, debitCreditZeroLabel),
      );
      const credit = escape(
        getFormattedDebitCreditWithoutCurrency(
          row.credit,
          debitCreditZeroLabel,
        ),
      );
      const balance = escape(
        getFormattedCurrency(row.balance).replace(currency, '').trim(),
      );
      const bType = escape(toString(row.balanceType));
      return `<tr><td>${dateStr}</td><td>${particulars}</td><td>${narration}</td><td style="text-align:right">${debit}</td><td style="text-align:right">${credit}</td><td style="text-align:right">${balance}</td><td>${bType}</td></tr>`;
    })
    .join('');
};

/**
 * prints ledger in a hidden iframe so the main window keeps the virtual table (no flash, no multi‑second freeze).
 */
export const printLedgerReportIframe = (options: LedgerReportPrintOptions) => {
  const { rows, accountName, dateSubtitle, totals } = options;
  if (rows.length === 0) return;

  const debitCreditZeroLabel = toString(
    window.electron.store.get('debitCreditDefaultLabel') ?? ' ',
  );

  const title = escape(`Ledger Report for ${accountName}: ${dateSubtitle}`);
  const bodyHtml = buildLedgerTableBodyHtml(rows, debitCreditZeroLabel);
  const footerDebit = escape(
    getFormattedCurrency(totals.totalDebit).replace(currency, '').trim(),
  );
  const footerCredit = escape(
    getFormattedCurrency(totals.totalCredit).replace(currency, '').trim(),
  );
  const footerDiff = escape(
    getFormattedCurrency(totals.totalDifference).replace(currency, '').trim(),
  );
  const footerType = escape(toString(totals.totalType));

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
  <style>${ledgerPrintStyles}</style>
  <style>
    body { margin: 0; padding: 8px; font-family: system-ui, sans-serif; font-size: 10px; color: #000; }
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
        <th>Date</th>
        <th>Particulars</th>
        <th>Narration</th>
        <th style="text-align:right">Debit</th>
        <th style="text-align:right">Credit</th>
        <th style="text-align:right">Balance</th>
        <th>Type</th>
      </tr>
    </thead>
    <tbody>${bodyHtml}
      <tr class="ledger-print-totals-row">
        <td></td>
        <td></td>
        <td></td>
        <td style="text-align:right"><strong>${footerDebit}</strong></td>
        <td style="text-align:right"><strong>${footerCredit}</strong></td>
        <td style="text-align:right"><strong>${footerDiff}</strong></td>
        <td><strong>${footerType}</strong></td>
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
