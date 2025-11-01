import { read, utils } from 'xlsx';
import { raise } from './utils';

/**
 * Converts a File object to JSON format.
 * @param file - The File object to convert.
 * @returns A Promise that resolves to an array of unknown values representing the JSON data.
 * @throws {Error} if no file is provided.
 */
export const convertFileToJson = async (
  file: File | undefined,
): Promise<unknown[]> => {
  const validFile = file ?? raise('No file provided');

  const data = await validFile.arrayBuffer();
  // parse
  const wb = read(data);
  // get the first worksheet
  const ws = wb.Sheets[wb.SheetNames[0]];
  // convert to json
  const json = utils.sheet_to_json(ws, {
    header: 1,
    blankrows: false,
    defval: null,
  });
  // eslint-disable-next-line no-console
  console.table(json);
  return json;
};
