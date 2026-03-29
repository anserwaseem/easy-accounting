/**
 * Batch-import historic invoices from JSON (same shape as azs-oracle-sqlite-migration export).
 *
 * Set EASY_ACCOUNTING_DB_PATH before starting Node (e.g. in the shell) so DatabaseService opens that file.
 *
 * Example:
 *   EASY_ACCOUNTING_DB_PATH=release/app/database.db \\
 *     npx cross-env NODE_ENV=test TS_NODE_TRANSPILE_ONLY=true ts-node ./.erb/scripts/import-historic-invoices.ts ./output/historic-invoices-2026.json
 *
 * Or: npm run import:historic -- /path/to/historic-invoices-2026.json
 */

import fs from 'fs';
import path from 'path';
import { DatabaseService } from '../../src/main/services/Database.service';
import { InvoiceService } from '../../src/main/services/Invoice.service';
import {
  InvoiceType,
  type HistoricInvoiceImportFile,
} from '../../src/types/types';
import { raise } from '../../src/main/utils/general';

const jsonPathArg = process.argv[2];
if (!jsonPathArg) {
  console.error(
    'usage: ts-node .erb/scripts/import-historic-invoices.ts <path-to-json>',
  );
  process.exit(1);
}
if (!process.env.EASY_ACCOUNTING_DB_PATH?.trim()) {
  console.error('Set EASY_ACCOUNTING_DB_PATH to your SQLite database file.');
  process.exit(1);
}
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(logsDir, `import-historic-invoices-${ts}.log`);
function logLine(message: string) {
  fs.appendFileSync(logFile, `${message}\n`, 'utf8');
}

const absJson = path.isAbsolute(jsonPathArg)
  ? jsonPathArg
  : path.resolve(process.cwd(), jsonPathArg);
const raw = fs.readFileSync(absJson, 'utf8');
const data = JSON.parse(raw) as HistoricInvoiceImportFile;

if (!Array.isArray(data?.invoices)) {
  raise('JSON must contain { invoices: [...] }');
}

const validTypes = [InvoiceType.Sale, InvoiceType.Purchase];
data.invoices.forEach((row, i) => {
  if (!validTypes.includes(row.invoiceType)) {
    raise(`invoices[${i}]: invalid invoiceType "${String(row.invoiceType)}"`);
  }
});

logLine('='.repeat(60));
logLine(`import-historic-invoices ${new Date().toISOString()}`);
logLine(`DB: ${process.env.EASY_ACCOUNTING_DB_PATH}`);
logLine(`JSON: ${absJson}`);
logLine(`rows: ${data.invoices.length}`);
logLine('='.repeat(60));
console.log(`Log file: ${logFile}`);

DatabaseService.resetInstance();

const invoiceService = new InvoiceService();
try {
  const result = invoiceService.insertHistoricInvoicesAtomic(data.invoices);
  logLine(`OK inserted=${result.inserted}`);
  logLine('='.repeat(60));
  console.log(`Imported ${result.inserted} invoices from ${absJson}`);
} catch (e) {
  logLine(`FAILED: ${String(e)}`);
  logLine('='.repeat(60));
  throw e;
}
