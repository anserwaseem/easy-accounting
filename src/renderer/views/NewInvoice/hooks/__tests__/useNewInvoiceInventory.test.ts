import type { InventoryItem } from 'types';
import { InvoiceType } from 'types';
import {
  lineInventoryIdsKeyFromIds,
  mergeInventoryForInvoice,
  parseLineInventoryIdsKey,
} from '../useNewInvoiceInventory';

describe('lineInventoryIdsKeyFromIds / parseLineInventoryIdsKey', () => {
  it('roundtrips sorted unique ids', () => {
    const key = lineInventoryIdsKeyFromIds([3, 1, 3, 2]);
    expect(key).toBe('1,2,3');
    expect(parseLineInventoryIdsKey(key)).toEqual([1, 2, 3]);
  });
});

describe('mergeInventoryForInvoice', () => {
  it('includes 0-qty rows when they are referenced by an invoice line (sale edit)', () => {
    const raw: InventoryItem[] = [
      {
        id: 1,
        name: 'In stock',
        price: 10,
        quantity: 5,
        itemTypeId: 1,
        itemTypeName: 'A',
      },
      {
        id: 2,
        name: 'Sold out',
        price: 8,
        quantity: 0,
        itemTypeId: 2,
        itemTypeName: 'B',
      },
    ];
    const merged = mergeInventoryForInvoice(raw, InvoiceType.Sale, [2]);
    expect(merged.map((i) => i.id).sort((a, b) => a - b)).toEqual([1, 2]);
    const line = merged.find((i) => i.id === 2);
    expect(line?.quantity).toBe(0);
    expect(line?.itemTypeId).toBe(2);
  });

  it('sorts merged sale inventory by listPosition then id', () => {
    const raw: InventoryItem[] = [
      {
        id: 3,
        name: 'C',
        price: 10,
        quantity: 5,
        itemTypeId: 1,
        itemTypeName: 'A',
        listPosition: 30,
      },
      {
        id: 1,
        name: 'A',
        price: 10,
        quantity: 5,
        itemTypeId: 1,
        itemTypeName: 'A',
        listPosition: 10,
      },
      {
        id: 2,
        name: 'B',
        price: 10,
        quantity: 5,
        itemTypeId: 1,
        itemTypeName: 'A',
        listPosition: null,
      },
    ];
    const merged = mergeInventoryForInvoice(raw, InvoiceType.Sale, []);
    expect(merged.map((i) => i.id)).toEqual([1, 3, 2]);
  });
});
