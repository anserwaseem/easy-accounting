import { toString, trim } from 'lodash';
import type { InventoryItem } from 'types';

export interface InventoryUrduExportRow {
  id: number;
  name: string;
  description: string;
  descriptionUrdu: string;
}

export interface InventoryUrduPatch {
  /** preferred match key when present and valid */
  id?: number;
  name?: string;
  descriptionUrdu?: string | null;
}

export interface InventoryUrduImportResult {
  patches: InventoryUrduPatch[];
  skippedRows: number;
}

const HEADER_ALIASES: Record<
  keyof Omit<InventoryUrduExportRow, never>,
  string[]
> = {
  id: ['id', 'inventory id', 'item id', 'inventoryid', 'itemid'],
  name: ['name', 'item', 'item name', 'item code', 'sku', 'itemname'],
  description: ['description', 'item description'],
  descriptionUrdu: [
    'descriptionurdu',
    'description (urdu)',
    'item description (urdu)',
    'urdu description',
  ],
};

const normalizeHeader = (value: unknown): string =>
  toString(value).trim().toLowerCase().replace(/\s+/g, ' ');

const cellText = (value: unknown): string => trim(toString(value ?? ''));

export const buildInventoryUrduExportRows = (
  items: InventoryItem[],
): InventoryUrduExportRow[] =>
  items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    descriptionUrdu: item.descriptionUrdu ?? '',
  }));

const resolveHeaderMap = (
  headerRow: unknown[],
): Partial<Record<keyof InventoryUrduExportRow, number>> => {
  const map: Partial<Record<keyof InventoryUrduExportRow, number>> = {};
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    (
      Object.keys(HEADER_ALIASES) as Array<keyof InventoryUrduExportRow>
    ).forEach((key) => {
      if (map[key] != null) return;
      if (HEADER_ALIASES[key].includes(normalized)) {
        map[key] = index;
      }
    });
  });
  return map;
};

/** parse spreadsheet rows (header + data) into Urdu description patches */
export const parseInventoryUrduImportRows = (
  rows: unknown[],
): InventoryUrduImportResult => {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error(
      'Urdu import needs a header row and at least one data row.',
    );
  }

  const headerRow = rows[0];
  if (!Array.isArray(headerRow)) {
    throw new Error('Urdu import header row is invalid.');
  }

  const headerMap = resolveHeaderMap(headerRow);
  if (headerMap.descriptionUrdu == null) {
    throw new Error('Urdu import needs a Description (Urdu) column.');
  }
  if (headerMap.id == null && headerMap.name == null) {
    throw new Error('Urdu import needs Id or Name to match inventory items.');
  }

  const descriptionUrduCol = headerMap.descriptionUrdu;
  const patches: InventoryUrduPatch[] = [];
  let skippedRows = 0;

  rows.slice(1).forEach((row) => {
    if (!Array.isArray(row)) {
      skippedRows += 1;
      return;
    }

    const idRaw = headerMap.id != null ? cellText(row[headerMap.id]) : '';
    const id = idRaw ? Number(idRaw) : undefined;
    const name =
      headerMap.name != null ? cellText(row[headerMap.name]) : undefined;

    const hasMatchKey =
      (id != null && Number.isFinite(id) && id > 0) || Boolean(name);
    if (!hasMatchKey) {
      skippedRows += 1;
      return;
    }

    const patch: InventoryUrduPatch = {};
    if (id != null && Number.isFinite(id) && id > 0) patch.id = id;
    if (name) patch.name = name;

    patch.descriptionUrdu = cellText(row[descriptionUrduCol]) || null;

    patches.push(patch);
  });

  return { patches, skippedRows };
};

export const INVENTORY_URDU_EXPORT_HEADERS = [
  'Id',
  'Name',
  'Description',
  'Description (Urdu)',
] as const;
