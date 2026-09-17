import { pinStockAccounts } from '../pinStockAccounts';

describe('pinStockAccounts', () => {
  it('puts tracksVendorStock accounts first, each group sorted by name', () => {
    const result = pinStockAccounts([
      { id: 1, name: 'Zebra Co', tracksVendorStock: false },
      { id: 2, name: 'Beta Stock', tracksVendorStock: true },
      { id: 3, name: 'Alpha Stock', tracksVendorStock: true },
      { id: 4, name: 'Apple Vendor', tracksVendorStock: false },
    ]);

    expect(result.map((a) => a.id)).toEqual([3, 2, 4, 1]);
  });

  it('treats missing tracksVendorStock as not pinned', () => {
    const result = pinStockAccounts([
      { id: 1, name: 'B', tracksVendorStock: true },
      { id: 2, name: 'A' },
    ]);

    expect(result.map((a) => a.id)).toEqual([1, 2]);
  });

  it('returns empty array unchanged', () => {
    expect(pinStockAccounts([])).toEqual([]);
  });
});
