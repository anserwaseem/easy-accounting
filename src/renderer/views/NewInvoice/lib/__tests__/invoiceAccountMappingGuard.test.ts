import {
  restoreSingleAccountIdFromSections,
  shouldWarnWhenTurningSplitLedgerOff,
} from '../invoiceAccountMappingGuard';

describe('shouldWarnWhenTurningSplitLedgerOff', () => {
  it('returns false when no per-row ids', () => {
    expect(shouldWarnWhenTurningSplitLedgerOff(10, [])).toBe(false);
  });

  it('returns true when two distinct row accounts', () => {
    expect(shouldWarnWhenTurningSplitLedgerOff(10, [10, 20])).toBe(true);
  });

  it('returns true when a row id differs from header', () => {
    expect(shouldWarnWhenTurningSplitLedgerOff(10, [55])).toBe(true);
  });

  it('returns false when all rows match header', () => {
    expect(shouldWarnWhenTurningSplitLedgerOff(10, [10, 10])).toBe(false);
  });
});

describe('restoreSingleAccountIdFromSections', () => {
  it('prefers active section account id', () => {
    expect(
      restoreSingleAccountIdFromSections(
        [
          { id: 'a', accountId: 1 },
          { id: 'b', accountId: 2 },
        ],
        'b',
      ),
    ).toBe(2);
  });

  it('falls back to first section when active is missing', () => {
    expect(
      restoreSingleAccountIdFromSections([{ id: 'a', accountId: 99 }], null),
    ).toBe(99);
  });

  it('returns undefined when no valid account id', () => {
    expect(restoreSingleAccountIdFromSections([], null)).toBeUndefined();
    expect(
      restoreSingleAccountIdFromSections([{ id: 'a' }], 'a'),
    ).toBeUndefined();
  });
});
