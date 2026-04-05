import {
  buildPartyTypingContext,
  findBasePartyRowForSingleAccountId,
  isTypedPartyAccount,
  resolvePartyRowForSplitByType,
  splitPartyCode,
  splitPartyName,
} from '../partyAccountTyping';

describe('partyAccountTyping', () => {
  describe('splitPartyName / splitPartyCode', () => {
    it('splits last dash segment', () => {
      expect(splitPartyName('Acme-TT')).toEqual({
        baseName: 'Acme',
        suffix: 'TT',
      });
      expect(splitPartyCode('RET-TT')).toEqual({
        baseCode: 'RET',
        suffix: 'TT',
      });
    });

    it('no dash returns whole string as base', () => {
      expect(splitPartyName('Acme')).toEqual({ baseName: 'Acme', suffix: '' });
      expect(splitPartyCode('RET')).toEqual({ baseCode: 'RET', suffix: '' });
    });
  });

  describe('isTypedPartyAccount', () => {
    const ctx = buildPartyTypingContext(
      [
        { name: 'Acme', code: 'AC' },
        { name: 'Acme-TT', code: 'AC-TT' },
      ],
      ['TT'],
    );

    it('detects name-suffixed typed row', () => {
      expect(isTypedPartyAccount({ name: 'Acme-TT', code: 'x' }, ctx)).toBe(
        true,
      );
    });

    it('detects code-suffixed typed row', () => {
      expect(isTypedPartyAccount({ name: 'Other', code: 'AC-TT' }, ctx)).toBe(
        true,
      );
    });

    it('returns false for base row', () => {
      expect(isTypedPartyAccount({ name: 'Acme', code: 'AC' }, ctx)).toBe(
        false,
      );
    });
  });

  describe('findBasePartyRowForSingleAccountId', () => {
    const base = { id: 10, name: 'Acme', code: 'AC', chartId: 1 };
    const typed = { id: 55, name: 'Acme-TT', code: 'AC-TT', chartId: 1 };
    const ctx = buildPartyTypingContext([base, typed], ['TT']);

    it('returns base row when singleId is base id', () => {
      expect(
        findBasePartyRowForSingleAccountId(10, [base], [base, typed], ctx),
      ).toEqual(base);
    });

    it('maps typed id to base party', () => {
      expect(
        findBasePartyRowForSingleAccountId(55, [base], [base, typed], ctx),
      ).toEqual(base);
    });

    it('returns undefined when id unknown', () => {
      expect(
        findBasePartyRowForSingleAccountId(999, [base], [base], ctx),
      ).toBeUndefined();
    });
  });

  describe('resolvePartyRowForSplitByType', () => {
    const base = { id: 10, name: 'Acme', code: 'AC', chartId: 1 };
    const typed = { id: 55, name: 'Acme-TT', code: 'AC-TT', chartId: 1 };
    const ctx = buildPartyTypingContext([base, typed], ['TT']);

    it('returns base row for base header id', () => {
      expect(
        resolvePartyRowForSplitByType(10, [base], [base, typed], ctx),
      ).toEqual(base);
    });

    it('returns base row for typed header id when base exists', () => {
      expect(
        resolvePartyRowForSplitByType(55, [base], [base, typed], ctx),
      ).toEqual(base);
    });

    it('synthetic base name when typed has no base row but chartId present', () => {
      const r = resolvePartyRowForSplitByType(55, [], [typed], ctx);
      expect(r?.name).toBe('Acme');
      expect(r?.chartId).toBe(1);
    });
  });
});
