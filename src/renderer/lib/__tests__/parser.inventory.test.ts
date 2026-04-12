import {
  parseInventory,
  parseInventoryListPositionRows,
} from '@/renderer/lib/parser';
import type { InventoryItem } from 'types';

describe('parseInventory', () => {
  it('maps header columns in any order', () => {
    const sheet: unknown[][] = [
      ['price', 'name', 'list'],
      [12, 'Alpha', 2],
      [10, 'Beta', 1],
    ];
    const rows = parseInventory(sheet);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'Alpha',
      price: 12,
      listPosition: 2,
    } satisfies Partial<InventoryItem>);
    expect(rows[1]).toMatchObject({
      name: 'Beta',
      price: 10,
      listPosition: 1,
    } satisfies Partial<InventoryItem>);
  });

  it('rejects sheets without name+price header row', () => {
    const sheet: unknown[][] = [
      ['Widget', 'd1', 9],
      ['Gadget', 11],
    ];
    expect(() => parseInventory(sheet)).toThrow(/header row/i);
  });
});

describe('parseInventoryListPositionRows', () => {
  it('requires name and list headers', () => {
    const sheet: unknown[][] = [
      ['item', 'List #'],
      ['X', 42],
    ];
    const rows = parseInventoryListPositionRows(sheet);
    expect(rows).toEqual([{ name: 'X', listPosition: 42 }]);
  });
});
