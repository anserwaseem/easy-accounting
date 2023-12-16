import { read, utils } from 'xlsx';

/**
 * Converts a File object to JSON format.
 * @param file - The File object to convert.
 * @returns A Promise that resolves to an array of unknown values representing the JSON data.
 * @throws {Error} if no file is provided.
 */
export const convertFileToJson = async (
  file: File | undefined,
): Promise<unknown[]> => {
  if (!file) throw new Error('No file provided');

  const data = await file.arrayBuffer();
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
  console.table(json);
  return json;
};
