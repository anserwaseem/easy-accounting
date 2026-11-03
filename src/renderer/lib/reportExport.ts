import { formatDisplayDate } from '@/lib/displayDate';

type ExcelJsModule = typeof import('exceljs');

let exceljsPromise: Promise<ExcelJsModule> | null = null;

const loadExcelJs = (): Promise<ExcelJsModule> => {
  if (exceljsPromise === null) {
    exceljsPromise = import('exceljs');
  }
  return exceljsPromise;
};

type ReportColumnFormat = 'string' | 'number' | 'currency' | 'date';

interface ReportColumn<T = Record<string, unknown>> {
  key: keyof T extends string ? keyof T : string;
  header: string;
  format?: ReportColumnFormat;
  width?: number;
}

export interface ReportExportPayload<T = Record<string, unknown>> {
  title: string;
  subtitle?: string;
  sheetName: string;
  columns: ReportColumn<T>[];
  rows: T[];
  footerRow?: Partial<T>;
  suggestedFileName: string;
}

/** sort order for export when report has debit/credit columns */
export type DebitCreditExportSortOrder = 'unsorted' | 'amount';

/** ledger report excel: how to fill the particulars column */
export type LedgerParticularsExportMode = 'name' | 'code' | 'both';

/** sort rows by amount for export; no-op when unsorted.
 * when ordered by amount, all debit rows (debit > 0) come first, sorted by debit descending,
 * followed by all credit rows (credit > 0), sorted by credit descending.
 */
export function sortDebitCreditRows<
  T extends { debit: number; credit: number },
>(rows: T[], order: DebitCreditExportSortOrder): T[] {
  if (order === 'unsorted') return rows;
  const indexed = rows.map((row, index) => ({ row, index }));
  const debitRows = indexed.filter((r) => r.row.debit > 0);
  const creditRows = indexed.filter((r) => r.row.credit > 0);

  debitRows.sort((a, b) => b.row.debit - a.row.debit || a.index - b.index);
  creditRows.sort((a, b) => b.row.credit - a.row.credit || a.index - b.index);

  return [...debitRows, ...creditRows].map((r) => r.row);
}

const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * format a cell value for excel based on column format.
 * currency and number are written as raw numbers so Excel treats them as numeric (formulas like AutoSum work).
 */
function formatCellValue(
  value: unknown,
  colFormat?: ReportColumnFormat,
): string | number {
  if (value == null) return '';
  if (colFormat === 'string') return String(value);
  if (colFormat === 'number') return Number(value);
  if (colFormat === 'currency') {
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
  }
  if (colFormat === 'date') {
    // pass the raw value through: formatDisplayDate handles both a Date and a
    // stored string, and a bare 'YYYY-MM-DD' must not be parsed as UTC midnight
    return formatDisplayDate(value as string | Date);
  }
  return String(value);
}

/**
 * build array-of-arrays for the sheet: optional title, subtitle, header row, data rows, optional footer
 */
function buildSheetRows<T extends Record<string, unknown>>(
  payload: ReportExportPayload<T>,
): (string | number)[][] {
  const { title, subtitle, columns, rows, footerRow } = payload;
  const headers = columns.map((c) => c.header);
  const aoa: (string | number)[][] = [];

  if (title) aoa.push([title]);
  if (subtitle) aoa.push([subtitle]);
  aoa.push(headers);

  for (const row of rows) {
    const arr = columns.map((col) => {
      const raw = row[col.key as keyof T];
      return formatCellValue(raw, col.format);
    });
    aoa.push(arr);
  }

  if (footerRow && Object.keys(footerRow).length > 0) {
    const footerArr = columns.map((col) => {
      const raw = footerRow[col.key as keyof T];
      return formatCellValue(raw, col.format);
    });
    aoa.push(footerArr);
  }

  return aoa;
}

const CURRENCY_NUMBER_FORMAT = '#,##0.00';

function buildWorksheet<T extends Record<string, unknown>>(
  ws: import('exceljs').Worksheet,

  payload: ReportExportPayload<T>,
) {
  const aoa = buildSheetRows(payload);
  ws.addRows(aoa);

  // data starts after title (optional), subtitle (optional), and header row
  const dataStartRow = (payload.title ? 1 : 0) + (payload.subtitle ? 1 : 0) + 1;
  // set number format for currency columns so Excel displays with thousand separators and 2 decimals
  payload.columns.forEach((col, c) => {
    if (col.format === 'currency') {
      for (let r = dataStartRow; r < aoa.length; r++) {
        const cell = ws.getRow(r + 1).getCell(c + 1);
        if (typeof cell.value === 'number') {
          cell.numFmt = CURRENCY_NUMBER_FORMAT;
        }
      }
    }
  });

  if (payload.columns.some((col) => col.width != null)) {
    ws.columns = payload.columns.map((col) => ({
      width: col.width ?? 12,
    }));
  }
}

const downloadWorkbook = async (wb: any, fileName: string) => {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: EXCEL_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export async function exportReportToExcel<T extends Record<string, unknown>>(
  payload: ReportExportPayload<T>,
): Promise<void> {
  const ExcelJS = (await loadExcelJs()) as any;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(payload.sheetName.slice(0, 31));
  buildWorksheet(ws, payload);
  await downloadWorkbook(wb, payload.suggestedFileName);
}

/** extra sheets use string column keys so item + invoice-line grains can share one workbook */
export interface ExtraReportSheet {
  title: string;
  subtitle?: string;
  sheetName: string;
  columns: Array<{
    key: string;
    header: string;
    format?: ReportColumnFormat;
    width?: number;
  }>;
  rows: Array<Record<string, unknown>>;
  footerRow?: Record<string, unknown>;
}

export async function exportReportWorkbook(
  sheets: ExtraReportSheet[],
  suggestedFileName: string,
): Promise<void> {
  const ExcelJS = (await loadExcelJs()) as any;
  const wb = new ExcelJS.Workbook();
  sheets.forEach((sheet) => {
    const ws = wb.addWorksheet(sheet.sheetName.slice(0, 31));
    buildWorksheet(ws, sheet as ReportExportPayload<Record<string, unknown>>);
  });
  await downloadWorkbook(wb, suggestedFileName);
}
