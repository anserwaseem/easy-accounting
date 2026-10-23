// one-off proforma invoice for an export agent: node render.mjs data.json [out.pdf]
// renders a clean A4 page and prints it to PDF through headless Chrome.
// put real company/customer data in an untracked json (this repo is public).
// run like this:
// node scripts/proforma-invoice/render.mjs data.json [out.pdf]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [dataPath, outArg] = process.argv.slice(2);
if (!dataPath) {
  console.error('usage: node render.mjs data.json [out.pdf]');
  process.exit(1);
}
const d = JSON.parse(readFileSync(dataPath, 'utf8'));
const esc = (v) =>
  String(v).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const money = (n) => `${d.currencySymbol}${Number(n).toFixed(2)}`;
const totalQty = d.items.reduce((s, i) => s + i.qty, 0);
const total = d.items.reduce((s, i) => s + i.amount, 0);

const rows = d.items
  .map(
    (i, n) =>
      `<tr><td class="c">${n + 1}</td><td>${esc(
        i.description,
      )}</td><td class="c">${esc(i.weight)}</td><td class="c">${esc(
        i.dimensions,
      )}</td><td class="c">${i.qty}</td><td class="r">${money(
        i.amount,
      )}</td></tr>`,
  )
  .join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Proforma Invoice ${esc(
  d.invoiceNumber,
)}</title>
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}
body{font-family:Helvetica,Arial,sans-serif;color:#111;font-size:13px;margin:0}
.head{text-align:center;border-bottom:3px solid #111;padding-bottom:10px}
.head h1{margin:0;font-size:30px;letter-spacing:3px}
.head p{margin:2px 0;color:#333}
.title{text-align:center;font-size:20px;font-weight:700;letter-spacing:2px;margin:16px 0}
.meta{display:flex;gap:20px;margin-bottom:16px}
.box{border:1px solid #999;padding:10px 12px;flex:1}
.box h4{margin:0 0 6px;font-size:11px;text-transform:uppercase;color:#666;letter-spacing:1px}
.box div{margin:2px 0}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #999;padding:8px 10px;text-align:left}
th{background:#eee;font-size:12px}
.r{text-align:right}.c{text-align:center}
tfoot td{font-weight:700}
.words{margin-top:10px;font-style:italic}
.note{margin-top:30px;color:#444;font-size:12px}
</style></head><body>
<div class="head"><h1>${esc(d.company.name)}</h1>
<p>${esc(d.company.address)}</p><p>${esc(d.company.contact)}</p><p><b>${esc(
  d.company.taxIds,
)}</b></p></div>
<div class="title">PROFORMA INVOICE</div>
<div class="meta">
<div class="box"><h4>Bill To</h4><div><b>${esc(
  d.billTo.name,
)}</b></div><div>${esc(d.billTo.location)}</div></div>
<div class="box"><h4>Details</h4><div><b>Proforma Invoice #:</b> ${esc(
  d.invoiceNumber,
)}</div><div><b>Date:</b> ${esc(d.date)}</div><div><b>Currency:</b> ${esc(
  d.currency,
)}</div></div>
</div>
<table><thead><tr><th class="c" style="width:36px">#</th><th>Description</th><th class="c">Weight</th><th class="c">Dimensions (L x W x H)</th><th class="c">Qty</th><th class="r">Amount</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="4" class="r">Total</td><td class="c">${totalQty}</td><td class="r">${money(
  total,
)}</td></tr></tfoot></table>
<div class="words">Amount in words: ${esc(d.amountInWords)}</div>
<div class="note">${esc(d.footerNote)}</div>
</body></html>`;

const tmp = join(mkdtempSync(join(tmpdir(), 'proforma-')), 'proforma.html');
writeFileSync(tmp, html);
const out = resolve(outArg ?? `Proforma-Invoice-${d.invoiceNumber}.pdf`);
const chrome =
  process.env.CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
execFileSync(
  chrome,
  [
    '--headless',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${out}`,
    tmp,
  ],
  { stdio: 'ignore' },
);
console.log(`wrote ${out}`);
