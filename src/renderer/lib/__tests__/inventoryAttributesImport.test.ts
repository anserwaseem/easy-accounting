import type { AttributeDefinition, InventoryItem } from 'types';
import {
  INVENTORY_URDU_EXPORT_HEADERS,
  attributeExportHeader,
  buildInventoryAttributesExportHeaders,
  buildInventoryAttributesExportRows,
  buildInventoryUrduExportRows,
  parseInventoryAttributesImportRows,
  parseInventoryUrduImportRows,
} from '../inventoryAttributesImport';
import {
  coerceAttributeValue,
  formatAttributeValueForExport,
  parseAttributeValueFromImport,
} from '../attributeValues';

const sampleItem = {
  id: 12,
  name: '76-Z',
  description: 'The Holy Quran',
  descriptionUrdu: 'قرآن مجید',
  price: 100,
  quantity: 1,
  attributes: {
    binding: 'Hard Binding',
    pages: 568,
    tajweedi: true,
  },
} as InventoryItem;

const defs = [
  {
    id: 1,
    key: 'binding',
    label: 'Binding',
    valueType: 'text',
    sortOrder: 1,
    isActive: 1,
    isPublic: 1,
  },
  {
    id: 2,
    key: 'pages',
    label: 'Pages',
    valueType: 'number',
    sortOrder: 2,
    isActive: 1,
    isPublic: 1,
  },
  {
    id: 3,
    key: 'tajweedi',
    label: 'Tajweedi',
    valueType: 'bool',
    sortOrder: 3,
    isActive: 1,
    isPublic: 1,
  },
  {
    id: 4,
    key: 'retired',
    label: 'Retired',
    valueType: 'text',
    sortOrder: 4,
    isActive: 0,
    isPublic: 0,
  },
] as AttributeDefinition[];

describe('attributeValues', () => {
  it('formats and parses spreadsheet cells by type', () => {
    expect(formatAttributeValueForExport(true, 'bool')).toBe('true');
    expect(formatAttributeValueForExport(false, 'bool')).toBe('');
    expect(formatAttributeValueForExport(568, 'number')).toBe('568');
    expect(parseAttributeValueFromImport('false', 'bool')).toBeNull();
    expect(parseAttributeValueFromImport('yes', 'bool')).toBe(true);
    expect(parseAttributeValueFromImport('568', 'number')).toBe(568);
    expect(coerceAttributeValue('  Art ', 'text')).toBe('Art');
  });
});

describe('inventoryAttributesImport', () => {
  it('builds export rows with active attribute columns only', () => {
    expect(buildInventoryAttributesExportHeaders(defs)).toEqual([
      'Id',
      'Name',
      'Description',
      'Description (Urdu)',
      'Binding',
      'Pages',
      'Tajweedi',
    ]);
    expect(buildInventoryAttributesExportRows([sampleItem], defs)).toEqual([
      {
        id: 12,
        name: '76-Z',
        description: 'The Holy Quran',
        descriptionUrdu: 'قرآن مجید',
        attributes: {
          binding: 'Hard Binding',
          pages: '568',
          tajweedi: 'true',
        },
      },
    ]);
  });

  it('disambiguates attribute headers that collide with fixed columns', () => {
    const colliding = [
      {
        id: 1,
        key: 'item_name',
        label: 'Name',
        valueType: 'text',
        sortOrder: 1,
        isActive: 1,
        isPublic: 0,
      },
    ] as AttributeDefinition[];
    expect(attributeExportHeader(colliding[0], colliding)).toBe(
      'Name (item_name)',
    );
  });

  it('parses attribute columns by label and clears blanks', () => {
    const result = parseInventoryAttributesImportRows(
      [
        ['Id', 'Binding', 'Pages', 'Tajweedi'],
        [12, 'Soft Binding', '', 'false'],
      ],
      defs,
    );
    expect(result.skippedRows).toBe(0);
    expect(result.patches).toEqual([
      {
        id: 12,
        attributes: {
          binding: 'Soft Binding',
          pages: null,
          tajweedi: null,
        },
      },
    ]);
  });

  it('parses Description and clears blanks', () => {
    const result = parseInventoryAttributesImportRows(
      [
        ['Id', 'Description', 'Description (Urdu)'],
        [12, 'New English', ''],
      ],
      defs,
    );
    expect(result.patches).toEqual([
      {
        id: 12,
        description: 'New English',
        descriptionUrdu: null,
      },
    ]);
  });

  it('still accepts Urdu-only sheets', () => {
    const result = parseInventoryAttributesImportRows(
      [
        [...INVENTORY_URDU_EXPORT_HEADERS],
        [12, '76-Z', 'The Holy Quran', 'قرآن مجید'],
      ],
      defs,
    );
    expect(result.patches).toEqual([
      {
        id: 12,
        name: '76-Z',
        description: 'The Holy Quran',
        descriptionUrdu: 'قرآن مجید',
      },
    ]);
  });

  it('keeps deprecated Urdu helpers working', () => {
    expect(buildInventoryUrduExportRows([sampleItem])).toEqual([
      {
        id: 12,
        name: '76-Z',
        description: 'The Holy Quran',
        descriptionUrdu: 'قرآن مجید',
      },
    ]);
    expect(
      parseInventoryUrduImportRows([
        ['Item', 'Urdu Description'],
        ['76-Z', 'قرآن مجید'],
      ]).patches,
    ).toEqual([{ name: '76-Z', descriptionUrdu: 'قرآن مجید' }]);
  });

  it('skips rows without a match key', () => {
    const result = parseInventoryAttributesImportRows(
      [
        ['Id', 'Name', 'Binding'],
        ['', '', 'Hard Binding'],
      ],
      defs,
    );
    expect(result.patches).toEqual([]);
    expect(result.skippedRows).toBe(1);
  });
});
