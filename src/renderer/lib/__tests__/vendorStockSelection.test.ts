import { pickTrackedVendorId } from '../vendorStockSelection';

describe('pickTrackedVendorId', () => {
  it('returns first candidate still in the tracked list', () => {
    expect(pickTrackedVendorId([2, 5, 9], [1, 5, 9])).toBe(5);
  });

  it('skips empty, zero, and negative ids', () => {
    expect(pickTrackedVendorId([3], [undefined, null, 0, -1, 3])).toBe(3);
  });

  it('returns undefined when no candidate is tracked', () => {
    expect(pickTrackedVendorId([1], [2, 3])).toBeUndefined();
  });
});
