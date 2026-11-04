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
const parseCsvToAoa = (
  text: string,
  preferDisplayText?: boolean,
): unknown[][] => {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === '\n' && !inQuotes) {
      lines.push(current);
      current = '';
    } else if (char === '\r' && text[i + 1] === '\n' && !inQuotes) {
      // skip CR before LF
    } else {
      current += char;
    }
  }
  if (current !== '' || lines.length > 0) lines.push(current);

  const parseRow = (row: string): unknown[] => {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') {
        if (quoted && row[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        cells.push(cell);
        cell = '';
      } else {
        cell += char;
      }
    }
    cells.push(cell);

    return cells.map((value) => {
      const trimmed = value.trim();
      if (preferDisplayText || trimmed === '') return value;
      const numeric = Number(trimmed);
      return Number.isNaN(numeric) ? value : numeric;
    });
  };

  return lines
    .map((line) => (line === '' ? null : parseRow(line)))
    .filter((row): row is unknown[] => row !== null);
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
    const json = parseCsvToAoa(text, preferDisplayText);

    console.table(json);
    return json;
  }

  const ExcelJS = (await import('exceljs')) as typeof import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const worksheet = workbook.worksheets[0] ?? workbook.worksheets[0];
  const json: unknown[][] = [];

  worksheet.eachRow({ includeEmpty: false }, (row: ExcelJsRow) => {
    const values: unknown[] = [];
    row.eachCell(
      { includeEmpty: true },
      (cell: ExcelJsCell, colNumber: number) => {
        const value = preferDisplayText
          ? cell.text ?? cell.value ?? null
          : cell.value ?? null;
        values[colNumber - 1] = value;
      },
    );
    json.push(values);
  });

  console.table(json);
  return json;
};
