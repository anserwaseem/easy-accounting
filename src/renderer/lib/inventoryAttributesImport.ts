import { toString, trim } from 'lodash';
import type { AttributeDefinition, InventoryItem } from 'types';
import {
  formatAttributeValueForExport,
  parseAttributeValueFromImport,
} from './attributeValues';

export interface InventoryAttributesExportRow {
  id: number;
  name: string;
  description: string;
  descriptionUrdu: string;
  /** values keyed by attribute definition key */
  attributes: Record<string, string>;
}

export interface InventoryAttributesPatch {
  /** preferred match key when present and valid */
  id?: number;
  name?: string;
  description?: string | null;
  descriptionUrdu?: string | null;
  /**
   * only keys present here are written.
   * null clears that attribute; omitted keys are left alone.
   */
  attributes?: Record<string, unknown | null>;
}

export interface InventoryAttributesImportResult {
  patches: InventoryAttributesPatch[];
  skippedRows: number;
}

const FIXED_HEADER_ALIASES: Record<
  'id' | 'name' | 'description' | 'descriptionUrdu',
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

type FixedHeaderKey = keyof typeof FIXED_HEADER_ALIASES;

const normalizeHeader = (value: unknown): string =>
  toString(value).trim().toLowerCase().replace(/\s+/g, ' ');

const cellText = (value: unknown): string => trim(toString(value ?? ''));

const RESERVED_NORMALIZED = new Set<string>(
  Object.values(FIXED_HEADER_ALIASES).flatMap((aliases) => aliases),
);

/** export column title for one definition; disambiguate collisions */
export const attributeExportHeader = (
  def: AttributeDefinition,
  allDefs: AttributeDefinition[],
): string => {
  const label = def.label.trim() || def.key;
  const labelNorm = normalizeHeader(label);
  const collidesWithFixed = RESERVED_NORMALIZED.has(labelNorm);
  const labelDupes = allDefs.filter(
    (other) => normalizeHeader(other.label.trim() || other.key) === labelNorm,
  );
  if (collidesWithFixed || labelDupes.length > 1) {
    return `${label} (${def.key})`;
  }
  return label;
};

/** active definitions in display order for spreadsheet columns */
export const attributeDefsForExport = (
  definitions: AttributeDefinition[],
): AttributeDefinition[] =>
  definitions
    .filter((def) => def.isActive)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

export const buildInventoryAttributesExportHeaders = (
  definitions: AttributeDefinition[],
): string[] => [
  'Id',
  'Name',
  'Description',
  'Description (Urdu)',
  ...attributeDefsForExport(definitions).map((def) =>
    attributeExportHeader(def, definitions),
  ),
];

export const buildInventoryAttributesExportRows = (
  items: InventoryItem[],
  definitions: AttributeDefinition[],
): InventoryAttributesExportRow[] => {
  const defs = attributeDefsForExport(definitions);
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    descriptionUrdu: item.descriptionUrdu ?? '',
    attributes: defs.reduce<Record<string, string>>((acc, def) => {
      acc[def.key] = formatAttributeValueForExport(
        item.attributes?.[def.key],
        def.valueType,
      );
      return acc;
    }, {}),
  }));
};

/** map a header cell to a definition key via label, key, or "Label (key)" */
const matchAttributeDefinition = (
  normalizedHeader: string,
  definitions: AttributeDefinition[],
): AttributeDefinition | undefined => {
  const byKey = definitions.find(
    (def) => normalizeHeader(def.key) === normalizedHeader,
  );
  if (byKey) return byKey;

  const labelMatches = definitions.filter(
    (def) => normalizeHeader(def.label.trim() || def.key) === normalizedHeader,
  );
  if (labelMatches.length === 1) return labelMatches[0];

  return definitions.find((def) => {
    const label = def.label.trim() || def.key;
    return normalizeHeader(`${label} (${def.key})`) === normalizedHeader;
  });
};

interface ResolvedHeaders {
  fixed: Partial<Record<FixedHeaderKey, number>>;
  attributes: Array<{ index: number; def: AttributeDefinition }>;
}

const resolveHeaders = (
  headerRow: unknown[],
  definitions: AttributeDefinition[],
): ResolvedHeaders => {
  const fixed: Partial<Record<FixedHeaderKey, number>> = {};
  const attributes: Array<{ index: number; def: AttributeDefinition }> = [];
  const claimed = new Set<number>();

  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    if (!normalized) return;

    (Object.keys(FIXED_HEADER_ALIASES) as FixedHeaderKey[]).forEach((key) => {
      if (fixed[key] != null) return;
      if (FIXED_HEADER_ALIASES[key].includes(normalized)) {
        fixed[key] = index;
        claimed.add(index);
      }
    });
  });

  headerRow.forEach((cell, index) => {
    if (claimed.has(index)) return;
    const normalized = normalizeHeader(cell);
    if (!normalized) return;
    const def = matchAttributeDefinition(normalized, definitions);
    if (def) {
      attributes.push({ index, def });
      claimed.add(index);
    }
  });

  return { fixed, attributes };
};

/** parse spreadsheet rows (header + data) into attribute / Urdu patches */
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

  const { fixed, attributes: attrCols } = resolveHeaders(
    headerRow,
    definitions,
  );
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

  const patches: InventoryAttributesPatch[] = [];
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

    const patch: InventoryAttributesPatch = {};
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
        attrs[def.key] = parseAttributeValueFromImport(
          cellText(row[index]),
          def.valueType,
        );
      });
      patch.attributes = attrs;
    }

    patches.push(patch);
  });

  return { patches, skippedRows };
};

/** @deprecated use buildInventoryAttributesExportHeaders */
export const INVENTORY_URDU_EXPORT_HEADERS = [
  'Id',
  'Name',
  'Description',
  'Description (Urdu)',
] as const;

/** @deprecated use buildInventoryAttributesExportRows */
export const buildInventoryUrduExportRows = (
  items: InventoryItem[],
): Array<{
  id: number;
  name: string;
  description: string;
  descriptionUrdu: string;
}> =>
  buildInventoryAttributesExportRows(items, []).map(
    ({ id, name, description, descriptionUrdu }) => ({
      id,
      name,
      description,
      descriptionUrdu,
    }),
  );

/** @deprecated use parseInventoryAttributesImportRows */
export const parseInventoryUrduImportRows = (
  rows: unknown[],
): InventoryAttributesImportResult =>
  parseInventoryAttributesImportRows(rows, []);
