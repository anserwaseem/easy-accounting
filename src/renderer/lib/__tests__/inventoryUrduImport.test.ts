import type { InventoryItem } from 'types';
import {
  INVENTORY_URDU_EXPORT_HEADERS,
  buildInventoryUrduExportRows,
  parseInventoryUrduImportRows,
} from '../inventoryUrduImport';

const sampleItem = {
  id: 12,
  name: '76-Z',
  description: 'The Holy Quran',
  descriptionUrdu: 'قرآن مجید',
  price: 100,
  quantity: 1,
} as InventoryItem;

describe('inventoryUrduImport', () => {
  it('builds export rows from inventory', () => {
    expect(buildInventoryUrduExportRows([sampleItem])).toEqual([
      {
        id: 12,
        name: '76-Z',
        description: 'The Holy Quran',
        descriptionUrdu: 'قرآن مجید',
      },
    ]);
  });

  it('parses canonical export headers', () => {
    const result = parseInventoryUrduImportRows([
      [...INVENTORY_URDU_EXPORT_HEADERS],
      [12, '76-Z', 'The Holy Quran', 'قرآن مجید'],
    ]);
    expect(result.skippedRows).toBe(0);
    expect(result.patches).toEqual([
      {
        id: 12,
        name: '76-Z',
        descriptionUrdu: 'قرآن مجید',
      },
    ]);
  });

  it('accepts header aliases and name-only match', () => {
    const result = parseInventoryUrduImportRows([
      ['Item', 'Urdu Description'],
      ['76-Z', 'قرآن مجید'],
    ]);
    expect(result.patches).toEqual([
      {
        name: '76-Z',
        descriptionUrdu: 'قرآن مجید',
      },
    ]);
  });

  it('treats blank Urdu cells as null clears', () => {
    const result = parseInventoryUrduImportRows([
      ['Id', 'Description (Urdu)'],
      [12, ''],
    ]);
    expect(result.patches).toEqual([{ id: 12, descriptionUrdu: null }]);
  });

  it('skips rows without a match key', () => {
    const result = parseInventoryUrduImportRows([
      ['Id', 'Name', 'Description (Urdu)'],
      ['', '', 'قرآن مجید'],
    ]);
    expect(result.patches).toEqual([]);
    expect(result.skippedRows).toBe(1);
  });
});
