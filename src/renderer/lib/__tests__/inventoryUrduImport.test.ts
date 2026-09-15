import {
  INVENTORY_URDU_EXPORT_HEADERS,
  buildInventoryUrduExportRows,
  parseInventoryUrduImportRows,
} from '../inventoryUrduImport';
import type { InventoryItem } from 'types';

const sampleItem = {
  id: 12,
  name: '76-Z',
  description: 'The Holy Quran',
  descriptionUrdu: 'قرآن مجید',
  price: 100,
  quantity: 1,
} as InventoryItem;

describe('inventoryUrduImport (compat)', () => {
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
        description: 'The Holy Quran',
        descriptionUrdu: 'قرآن مجید',
      },
    ]);
  });
});
