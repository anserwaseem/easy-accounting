import type { AttributeDefinition, InventoryItem } from 'types';
import {
  buildInventoryAttributesAoa,
  parseInventoryAttributesImportRows,
} from '../inventoryAttributesImport';

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

describe('inventoryAttributesImport', () => {
  it('builds a sheet with active attribute columns only', () => {
    expect(buildInventoryAttributesAoa([sampleItem], defs)).toEqual([
      [
        'Id',
        'Name',
        'Description',
        'Description (Urdu)',
        'Binding',
        'Pages',
        'Tajweedi',
      ],
      [
        12,
        '76-Z',
        'The Holy Quran',
        'قرآن مجید',
        'Hard Binding',
        '568',
        'true',
      ],
    ]);
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

  it('parses Description columns and clears blanks', () => {
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

  it('accepts key headers and name-only match', () => {
    const result = parseInventoryAttributesImportRows(
      [
        ['Item', 'binding'],
        ['76-Z', 'Soft Binding'],
      ],
      defs,
    );
    expect(result.patches).toEqual([
      { name: '76-Z', attributes: { binding: 'Soft Binding' } },
    ]);
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
