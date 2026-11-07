import { raise } from './utils';
import type { Row as ExcelJsRow, Cell as ExcelJsCell } from 'exceljs';

interface ConvertFileToJsonOptions {
  /** .xlsx/.xls: sheet_to_json raw:false → displayed string (avoids raw date serials). Ignored for meaning on .csv when read({ raw:true }) already forces string cells. Balance sheet upload omits this (needs numeric cells). */
  preferDisplayText?: boolean;
}

/**
 * Converts a File object to JSON format.
 * @param file - The File object to convert.
 * @returns A Promise that resolves to an array of unknown values representing the JSON data.
 * @throws {Error} if no file is provided.
 */
interface ParsedCsvCell {
  value: string;
  quoted: boolean;
}

// exported so unit tests can exercise the parser without a File/Workbook
export const parseCsvToAoa = (
  text: string,
  preferDisplayText?: boolean,
): unknown[][] => {
  // Single-pass state machine: handles quoted fields with embedded newlines,
  // escaped quotes, and CR / CRLF / LF line endings.
  const rows: ParsedCsvCell[][] = [];
  let row: ParsedCsvCell[] = [];
  let cell = '';
  let inQuotes = false;
  let quoted = false;
  let cellOpen = false; // true when characters have been added since the last delimiter
  let afterDelimiter = false; // true when the row currently ends on a delimiter

  const finalizeCell = () => {
    row.push({ value: cell, quoted });
    cell = '';
    quoted = false;
    cellOpen = false;
  };

  const finalizeRow = () => {
    if (cellOpen) {
      finalizeCell();
    } else if (afterDelimiter) {
      row.push({ value: '', quoted: false });
    }
    if (row.length === 0) {
      row.push({ value: '', quoted: false });
    }
    rows.push(row);
    row = [];
    cell = '';
    quoted = false;
    cellOpen = false;
    afterDelimiter = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
          cellOpen = true;
          afterDelimiter = false;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
        cellOpen = true;
        afterDelimiter = false;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        quoted = true;
        cellOpen = true;
        afterDelimiter = false;
      } else if (char === ',') {
        finalizeCell();
        afterDelimiter = true;
      } else if (char === '\n') {
        finalizeRow();
      } else if (char === '\r') {
        if (text[i + 1] === '\n') {
          i++;
        }
        finalizeRow();
      } else {
        cell += char;
        cellOpen = true;
        afterDelimiter = false;
      }
    }
  }

  // trailing content
  if (row.length > 0 || cellOpen || quoted || afterDelimiter) {
    if (cellOpen || quoted) {
      finalizeCell();
    } else if (afterDelimiter) {
      row.push({ value: '', quoted: false });
    }
    if (row.length > 0) {
      rows.push(row);
    }
  }

  return rows
    .map((cells) => {
      const values = cells.map((parsedCell) => {
        if (parsedCell.quoted) {
          // Preserve quoted content verbatim, including leading zeros.
          return parsedCell.value;
        }
        const trimmed = parsedCell.value.trim();
        if (preferDisplayText || trimmed === '') {
          return trimmed;
        }
        const numeric = Number(trimmed);
        return Number.isNaN(numeric) ? trimmed : numeric;
      });
      const allEmpty = values.every(
        (v) => v === '' || v === null || v === undefined,
      );
      return allEmpty ? null : values;
    })
    .filter((r) => r !== null) as unknown[][];
};

export const convertFileToJson = async (
  file: File | undefined,
  options?: ConvertFileToJsonOptions,
): Promise<unknown[]> => {
  const validFile = file ?? raise('No file provided');

  const data = await validFile.arrayBuffer();
  const isCsv = validFile.name.toLowerCase().endsWith('.csv');
  const preferDisplayText = options?.preferDisplayText === true;

  if (isCsv) {
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(data);
    return parseCsvToAoa(text, preferDisplayText);
  }

  const ExcelJS = (await import('exceljs')) as typeof import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const worksheet = workbook.worksheets[0];
  const json: unknown[][] = [];

  worksheet.eachRow({ includeEmpty: false }, (row: ExcelJsRow) => {
    const values: unknown[] = [];
    row.eachCell(
      { includeEmpty: true },
      (cell: ExcelJsCell, colNumber: number) => {
        let value: unknown = preferDisplayText
          ? cell.text ?? cell.value ?? null
          : cell.value ?? null;
        // Normalize ExcelJS formula objects (and rich text) to their displayed result.
        if (value && typeof value === 'object') {
          const obj = value as {
            result?: unknown;
            richText?: { text: string }[];
          };
          if (Object.prototype.hasOwnProperty.call(obj, 'result')) {
            value = obj.result ?? null;
          } else if (Array.isArray(obj.richText)) {
            value = obj.richText.map((t) => t.text).join('');
          }
        }
        values[colNumber - 1] = value;
      },
    );
    json.push(values);
  });

  return json;
};
