import { itemNameError, reservedCharsIn } from '../itemName';

describe('reservedCharsIn', () => {
  it('finds a reserved character', () => {
    expect(reservedCharsIn('A_B', '~_')).toEqual(['_']);
  });

  it('reports each offending character once', () => {
    expect(reservedCharsIn('A_B_C', '~_')).toEqual(['_']);
  });

  it('reports several distinct characters', () => {
    expect(reservedCharsIn('A_B~C', '~_').sort()).toEqual(['_', '~']);
  });

  it('accepts a clean name', () => {
    expect(reservedCharsIn('55-A/30', '~_')).toEqual([]);
  });

  it('restricts nothing when no characters are configured', () => {
    // an installation that publishes nowhere must not be constrained
    expect(reservedCharsIn('A_B~C', '')).toEqual([]);
  });
});

describe('itemNameError', () => {
  it('is null for an allowed name', () => {
    expect(itemNameError('S-23-G', '~_')).toBeNull();
  });

  it('names the offending character so the fix is obvious', () => {
    expect(itemNameError('A_B', '~_')).toContain('"_"');
  });

  it('leaves ordinary punctuation alone', () => {
    // these are exactly the characters AZS codes are full of
    for (const name of ['55-A/30', 'HIZBUL M', '.S-23', '361(SHAMA)']) {
      expect(itemNameError(name, '~_')).toBeNull();
    }
  });

  it('is null when nothing is reserved', () => {
    expect(itemNameError('A_B', '')).toBeNull();
  });
});
