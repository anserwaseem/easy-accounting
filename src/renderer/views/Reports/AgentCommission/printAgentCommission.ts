import { escape } from 'lodash';
import type { AgentCommissionReport, CommissionAdjustment } from '@/types';
import { printStyles } from '../components/printStyles';

interface PrintAgentCommissionOptions {
  report: AgentCommissionReport;
  adjustments: CommissionAdjustment[];
  title: string;
  subtitle: string;
  includeLineItems?: boolean;
}

const formatMoney = (val: number | null | undefined): string => {
  if (val == null || Number.isNaN(val)) return '0';
  return Math.round(val).toLocaleString();
};

export const printAgentCommissionIframe = (
  options: PrintAgentCommissionOptions,
) => {
  const { report, adjustments, title, subtitle, includeLineItems } = options;

  const totalAdjustments = adjustments.reduce(
    (sum, adj) => sum + (adj.amount || 0),
    0,
  );
  const netCommission = report.grossCommission + totalAdjustments;

  // Buckets table rows
  const bucketRows = report.buckets
    .map(
      (b) => `<tr>
      <td>${escape(b.title)}</td>
      <td class="fit">${escape(b.ruleType.replace('_', ' '))}</td>
      <td class="num">${escape(b.totalQty.toLocaleString())}</td>
      <td class="num">${escape(formatMoney(b.totalCharged))}</td>
      <td class="num font-bold">${escape(formatMoney(b.totalCommission))}</td>
    </tr>`,
    )
    .join('');

  // Adjustments table rows
  const adjustmentRows =
    adjustments.length > 0
      ? adjustments
          .map(
            (adj) => `<tr>
          <td colspan="4">${escape(adj.description)}</td>
          <td class="num">${escape(formatMoney(adj.amount))}</td>
        </tr>`,
          )
          .join('')
      : '';

  // Optional line items table
  let lineItemsHtml = '';
  if (includeLineItems) {
    const allLines = report.buckets.flatMap((b) => b.lines);
    const lineRows = allLines
      .map(
        (line, idx) => `<tr>
        <td class="fit num">${idx + 1}</td>
        <td class="fit">${escape(line.invoiceDate)}</td>
        <td class="fit num">${line.invoiceNumber}</td>
        <td>${escape(line.accountName)}${
          line.accountCode ? ` (${escape(line.accountCode)})` : ''
        }</td>
        <td>${escape(line.itemName)}</td>
        <td class="fit">${escape(line.itemTypeName)}</td>
        <td class="num">${line.quantity}</td>
        <td class="num">${
          line.netPrice != null ? `${line.netPrice} (net)` : line.price
        }</td>
        <td class="num">${escape(formatMoney(line.chargedAmount))}</td>
        <td class="fit">${escape(line.rateType)} (${line.rateValue})</td>
        <td class="num">${escape(formatMoney(line.commissionAmount))}</td>
      </tr>`,
      )
      .join('');

    lineItemsHtml = `
      <div style="page-break-before: always; margin-top: 24px;">
        <h2 style="font-size: 13px; margin-bottom: 8px;">Detailed Line Items</h2>
        <table>
          <thead>
            <tr>
              <th class="fit">#</th>
              <th class="fit">Date</th>
              <th class="fit">Inv #</th>
              <th>Customer</th>
              <th>Item / SKU</th>
              <th class="fit">Type</th>
              <th class="num">Qty</th>
              <th class="num">Price</th>
              <th class="num">Charged</th>
              <th class="fit">Rate</th>
              <th class="num">Commission</th>
            </tr>
          </thead>
          <tbody>
            ${lineRows}
          </tbody>
        </table>
      </div>
    `;
  }

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
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${safeTitle}</title>
  <style>${printStyles}</style>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    @media print {
      @page { size: A4 portrait; margin: 10mm; }
    }
    body { margin: 0; padding: 8px; font-family: system-ui, sans-serif; font-size: 11px; color: #000; }
    h1 { text-align: center; font-size: 15px; margin: 0 0 4px; font-weight: bold; }
    p.sub { text-align: center; margin: 0 0 12px; font-size: 11px; color: #444; }
    .metrics { display: flex; justify-content: space-between; border: 1px solid #000; padding: 8px; margin-bottom: 14px; background: #fafafa; }
    .metric-item { text-align: center; }
    .metric-label { font-size: 9px; text-transform: uppercase; color: #555; }
    .metric-val { font-size: 13px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th, td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
    th { font-size: 10px; background-color: #f0f0f0; }
    td.num, th.num { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
    th.fit, td.fit { width: 1%; white-space: nowrap; padding-left: 4px; padding-right: 4px; }
    .font-bold { font-weight: bold; }
    .footer-row { background-color: #f7f7f7; font-weight: bold; }
  </style>
</head>
<body>
  <h1>${safeTitle}</h1>
  <p class="sub">${escape(subtitle)}</p>

  <div class="metrics">
    <div class="metric-item">
      <div class="metric-label">Total Units</div>
      <div class="metric-val">${report.totalQty.toLocaleString()}</div>
    </div>
    <div class="metric-item">
      <div class="metric-label">Total Charged</div>
      <div class="metric-val">Rs. ${formatMoney(report.totalCharged)}</div>
    </div>
    <div class="metric-item">
      <div class="metric-label">Gross Commission</div>
      <div class="metric-val">Rs. ${formatMoney(report.grossCommission)}</div>
    </div>
    <div class="metric-item">
      <div class="metric-label">Adjustments</div>
      <div class="metric-val">Rs. ${formatMoney(totalAdjustments)}</div>
    </div>
    <div class="metric-item">
      <div class="metric-label">Net Payable</div>
      <div class="metric-val" style="color: #0b6623;">Rs. ${formatMoney(
        netCommission,
      )}</div>
    </div>
  </div>

  <h2 style="font-size: 12px; margin-bottom: 6px;">Commission Rates Breakdown</h2>
  <table>
    <thead>
      <tr>
        <th>Commission Tier / Rule</th>
        <th class="fit">Rule Type</th>
        <th class="num">Units Sold</th>
        <th class="num">Charged Amount</th>
        <th class="num">Commission (Rs.)</th>
      </tr>
    </thead>
    <tbody>
      ${bucketRows}
      <tr class="footer-row">
        <td colspan="2">Total Gross Commission</td>
        <td class="num">${report.totalQty.toLocaleString()}</td>
        <td class="num">Rs. ${formatMoney(report.totalCharged)}</td>
        <td class="num font-bold">Rs. ${formatMoney(
          report.grossCommission,
        )}</td>
      </tr>
      ${
        adjustments.length > 0
          ? `
        <tr>
          <th colspan="5" style="text-align: left; padding-top: 6px; padding-bottom: 6px;">Manual Adjustments</th>
        </tr>
        ${adjustmentRows}
        <tr class="footer-row" style="background-color: #e6f4ea;">
          <td colspan="4" style="font-size: 12px;">NET COMMISSION PAYABLE</td>
          <td class="num font-bold" style="font-size: 12px;">Rs. ${formatMoney(
            netCommission,
          )}</td>
        </tr>
      `
          : ''
      }
    </tbody>
  </table>

  ${lineItemsHtml}
</body>
</html>`);
  doc.close();

  setTimeout(() => {
    win.focus();
    win.print();
    iframe.remove();
  }, 250);
};
