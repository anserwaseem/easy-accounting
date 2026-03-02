import { format } from 'date-fns';
import { write, utils } from 'xlsx';

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
export type DebitCreditExportSortOrder = 'unsorted' | 'debit' | 'credit';

/** sort rows by debit or credit descending for export; no-op when unsorted */
export function sortDebitCreditRows<
  T extends { debit: number; credit: number },
>(rows: T[], order: DebitCreditExportSortOrder): T[] {
  if (order === 'unsorted') return rows;
  if (order === 'debit') return [...rows].sort((a, b) => b.debit - a.debit);
  return [...rows].sort((a, b) => b.credit - a.credit);
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
    if (value instanceof Date) return format(value, 'PP');
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : format(d, 'PP');
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

export function exportReportToExcel<T extends Record<string, unknown>>(
  payload: ReportExportPayload<T>,
): void {
  const aoa = buildSheetRows(payload);
  const ws = utils.aoa_to_sheet(aoa);

  // set number format for currency columns so Excel displays with thousand separators and 2 decimals
  const dataStartRow = 3; // row 0 title, 1 subtitle, 2 headers, 3+ data
  payload.columns.forEach((col, c) => {
    if (col.format === 'currency') {
      for (let r = dataStartRow; r < aoa.length; r++) {
        const ref = utils.encode_cell({ r, c });
        const cell = ws[ref];
        if (cell && typeof cell.v === 'number') {
          cell.z = CURRENCY_NUMBER_FORMAT; // v means value, z means format; set to currency format
        }
      }
    }
  });

  if (payload.columns.some((c) => c.width != null)) {
    ws['!cols'] = payload.columns.map((c) => ({
      wch: c.width ?? 12,
    }));
  }

  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, payload.sheetName.slice(0, 31));

  const buffer = write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buffer], { type: EXCEL_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = payload.suggestedFileName;
  link.click();
  URL.revokeObjectURL(url);
}
