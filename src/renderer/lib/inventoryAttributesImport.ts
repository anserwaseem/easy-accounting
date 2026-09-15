import { toString, trim } from 'lodash';
import type {
  AttributeDefinition,
  InventoryAttributeFieldPatch,
  InventoryItem,
} from 'types';

export interface InventoryAttributesImportResult {
  patches: InventoryAttributeFieldPatch[];
  skippedRows: number;
}

const FIXED_ALIASES: Record<string, string[]> = {
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

const activeDefs = (
  definitions: AttributeDefinition[],
): AttributeDefinition[] =>
  definitions
    .filter((def) => def.isActive)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

const formatAttr = (
  value: unknown,
  valueType: AttributeDefinition['valueType'],
): string => {
  if (value === null || value === undefined) return '';
  if (valueType === 'bool') return value ? 'true' : '';
  return String(value);
};

/** empty clears; bool false/0/no clears; else coerce like the attributes form */
const parseAttr = (
  raw: string,
  valueType: AttributeDefinition['valueType'],
): unknown | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (valueType === 'bool') {
    const lower = trimmed.toLowerCase();
    if (['false', '0', 'no', 'n'].includes(lower)) return null;
    return true;
  }
  if (valueType === 'number') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  return trimmed;
};

/** match header to a definition by label or key */
const matchDef = (
  normalized: string,
  definitions: AttributeDefinition[],
): AttributeDefinition | undefined =>
  definitions.find(
    (def) =>
      normalizeHeader(def.key) === normalized ||
      normalizeHeader(def.label) === normalized,
  );

/** spreadsheet for export: header row + data rows */
export const buildInventoryAttributesAoa = (
  items: InventoryItem[],
  definitions: AttributeDefinition[],
): (string | number)[][] => {
  const defs = activeDefs(definitions);
  return [
    [
      'Id',
      'Name',
      'Description',
      'Description (Urdu)',
      ...defs.map((def) => def.label),
    ],
    ...items.map((item) => [
      item.id,
      item.name,
      item.description ?? '',
      item.descriptionUrdu ?? '',
      ...defs.map((def) =>
        formatAttr(item.attributes?.[def.key], def.valueType),
      ),
    ]),
  ];
};

/** parse spreadsheet rows (header + data) into patches */
export const parseInventoryAttributesImportRows = (
  rows: unknown[],
  definitions: AttributeDefinition[],
): InventoryAttributesImportResult => {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error(
      'Attributes import needs a header row and at least one data row.',
    );
  }

  const headerRow = rows[0];
  if (!Array.isArray(headerRow)) {
    throw new Error('Attributes import header row is invalid.');
  }

  const fixed: Partial<Record<keyof typeof FIXED_ALIASES, number>> = {};
  const attrCols: Array<{ index: number; def: AttributeDefinition }> = [];
  const claimed = new Set<number>();

  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    if (!normalized) return;
    const fixedKey = (
      Object.keys(FIXED_ALIASES) as Array<keyof typeof FIXED_ALIASES>
    ).find(
      (key) => fixed[key] == null && FIXED_ALIASES[key].includes(normalized),
    );
    if (fixedKey) {
      fixed[fixedKey] = index;
      claimed.add(index);
    }
  });

  headerRow.forEach((cell, index) => {
    if (claimed.has(index)) return;
    const normalized = normalizeHeader(cell);
    if (!normalized) return;
    const def = matchDef(normalized, definitions);
    if (def) attrCols.push({ index, def });
  });

  if (
    fixed.description == null &&
    fixed.descriptionUrdu == null &&
    attrCols.length === 0
  ) {
    throw new Error(
      'Attributes import needs Description, Description (Urdu), or at least one attribute column.',
    );
  }
  if (fixed.id == null && fixed.name == null) {
    throw new Error(
      'Attributes import needs Id or Name to match inventory items.',
    );
  }

  const patches: InventoryAttributeFieldPatch[] = [];
  let skippedRows = 0;

  rows.slice(1).forEach((row) => {
    if (!Array.isArray(row)) {
      skippedRows += 1;
      return;
    }

    const idRaw = fixed.id != null ? cellText(row[fixed.id]) : '';
    const id = idRaw ? Number(idRaw) : undefined;
    const name = fixed.name != null ? cellText(row[fixed.name]) : undefined;
    const hasMatchKey =
      (id != null && Number.isFinite(id) && id > 0) || Boolean(name);
    if (!hasMatchKey) {
      skippedRows += 1;
      return;
    }

    const patch: InventoryAttributeFieldPatch = {};
    if (id != null && Number.isFinite(id) && id > 0) patch.id = id;
    if (name) patch.name = name;
    if (fixed.description != null) {
      patch.description = cellText(row[fixed.description]) || null;
    }
    if (fixed.descriptionUrdu != null) {
      patch.descriptionUrdu = cellText(row[fixed.descriptionUrdu]) || null;
    }
    if (attrCols.length > 0) {
      const attrs: Record<string, unknown | null> = {};
      attrCols.forEach(({ index, def }) => {
        attrs[def.key] = parseAttr(cellText(row[index]), def.valueType);
      });
      patch.attributes = attrs;
    }
    patches.push(patch);
  });

  return { patches, skippedRows };
};
