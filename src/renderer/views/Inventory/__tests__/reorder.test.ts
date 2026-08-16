import { moveByOffset } from '../reorder';

describe('moveByOffset', () => {
  const items = ['a', 'b', 'c', 'd'];

  it('moves an item up', () => {
    expect(moveByOffset(items, 2, -1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('moves an item down', () => {
    expect(moveByOffset(items, 1, 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('returns the same array reference when the move is a no-op', () => {
    // identity lets callers skip a needless write/re-render
    expect(moveByOffset(items, 0, -1)).toBe(items);
    expect(moveByOffset(items, 3, 1)).toBe(items);
    expect(moveByOffset(items, 1, 0)).toBe(items);
    expect(moveByOffset(items, -1, 1)).toBe(items);
    expect(moveByOffset(items, 9, -1)).toBe(items);
  });

  it('does not mutate the input', () => {
    const original = [...items];
    moveByOffset(items, 0, 1);
    expect(items).toEqual(original);
  });

  it('handles multi-step offsets', () => {
    expect(moveByOffset(items, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
  });
});
