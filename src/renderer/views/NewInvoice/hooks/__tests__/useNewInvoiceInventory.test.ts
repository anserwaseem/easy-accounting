import { act, renderHook, waitFor } from '@testing-library/react';
import type { InventoryItem } from 'types';
import { InvoiceType } from 'types';
import {
  lineInventoryIdsKeyFromIds,
  mergeInventoryForInvoice,
  parseLineInventoryIdsKey,
  useInvoiceInventoryLoader,
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

  it('quotation flow: includes 0-qty active items with positive price', () => {
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
      {
        id: 3,
        name: 'Inactive',
        price: 15,
        quantity: 0,
        isActive: false,
      },
      {
        id: 4,
        name: 'Unpriced',
        price: 0,
        quantity: 0,
      },
    ];
    // standard sale excludes item 2 (quantity 0)
    const saleMerged = mergeInventoryForInvoice(raw, InvoiceType.Sale, []);
    expect(saleMerged.map((i) => i.id)).toEqual([1]);

    // quotation flow includes item 2 (quantity 0), but excludes inactive (3) and unpriced (4)
    const quoteMerged = mergeInventoryForInvoice(
      raw,
      InvoiceType.Sale,
      [],
      true,
    );
    expect(quoteMerged.map((i) => i.id).sort((a, b) => a - b)).toEqual([1, 2]);
  });
});

describe('useInvoiceInventoryLoader', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('caches first fetch and refreshInventory bypasses cache', async () => {
    const first: InventoryItem[] = [
      {
        id: 1,
        name: 'Old',
        price: 10,
        quantity: 5,
        itemTypeId: 1,
        itemTypeName: 'A',
      },
    ];
    const second: InventoryItem[] = [
      {
        id: 1,
        name: 'New',
        price: 12,
        quantity: 8,
        itemTypeId: 1,
        itemTypeName: 'A',
      },
      {
        id: 2,
        name: 'Added',
        price: 5,
        quantity: 3,
        itemTypeId: 1,
        itemTypeName: 'A',
      },
    ];
    const getInventory = jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    (window as unknown as { electron: { getInventory: jest.Mock } }).electron =
      { getInventory };

    const setInventory = jest.fn();
    const { result, rerender } = renderHook(
      ({ key }) =>
        useInvoiceInventoryLoader(InvoiceType.Sale, key, setInventory),
      { initialProps: { key: '' } },
    );

    await waitFor(() => {
      expect(getInventory).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(setInventory).toHaveBeenCalled();
    });
    expect(setInventory.mock.calls.at(-1)?.[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 1, name: 'Old' })]),
    );

    // changing line key remaps from cache — no second network call
    setInventory.mockClear();
    rerender({ key: '1' });
    await waitFor(() => {
      expect(setInventory).toHaveBeenCalled();
    });
    expect(getInventory).toHaveBeenCalledTimes(1);

    await act(async () => {
      const merged = await result.current.refreshInventory();
      expect(merged?.map((i) => i.id).sort((a, b) => a - b)).toEqual([1, 2]);
    });

    expect(getInventory).toHaveBeenCalledTimes(2);
    expect(setInventory.mock.calls.at(-1)?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, name: 'New', quantity: 8 }),
        expect.objectContaining({ id: 2, name: 'Added' }),
      ]),
    );
  });

  it('updates merged inventory when isQuotationFlow changes', async () => {
    const raw: InventoryItem[] = [
      {
        id: 1,
        name: 'In stock',
        price: 10,
        quantity: 5,
      },
      {
        id: 2,
        name: 'Zero stock',
        price: 20,
        quantity: 0,
      },
    ];
    const getInventory = jest.fn().mockResolvedValue(raw);
    (window as unknown as { electron: { getInventory: jest.Mock } }).electron =
      { getInventory };

    const setInventory = jest.fn();
    const { rerender } = renderHook(
      ({ isQuotationFlow }) =>
        useInvoiceInventoryLoader(
          InvoiceType.Sale,
          '',
          setInventory,
          isQuotationFlow,
        ),
      { initialProps: { isQuotationFlow: false } },
    );

    await waitFor(() => {
      expect(setInventory).toHaveBeenCalled();
    });
    // initial non-quotation sale: only item 1
    expect(
      setInventory.mock.calls.at(-1)?.[0].map((i: InventoryItem) => i.id),
    ).toEqual([1]);

    // toggle to quotation flow
    setInventory.mockClear();
    rerender({ isQuotationFlow: true });

    await waitFor(() => {
      expect(setInventory).toHaveBeenCalled();
    });
    // quotation sale: items 1 and 2
    expect(
      setInventory.mock.calls
        .at(-1)?.[0]
        .map((i: InventoryItem) => i.id)
        .sort((a: number, b: number) => a - b),
    ).toEqual([1, 2]);
    // uses cache, no extra network fetch
    expect(getInventory).toHaveBeenCalledTimes(1);
  });
});
