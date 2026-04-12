import { read, utils } from 'xlsx';
import { raise } from './utils';

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
export const convertFileToJson = async (
  file: File | undefined,
  options?: ConvertFileToJsonOptions,
): Promise<unknown[]> => {
  const validFile = file ?? raise('No file provided');

  const data = await validFile.arrayBuffer();
  const isCsv = validFile.name.toLowerCase().endsWith('.csv');
  const wb = read(data, isCsv ? { raw: true } : undefined);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const useRaw = options?.preferDisplayText !== true;
  // convert to json
  const json = utils.sheet_to_json(ws, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: useRaw,
  });
  // eslint-disable-next-line no-console
  console.table(json);
  return json;
};
