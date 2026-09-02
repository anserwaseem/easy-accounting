import {
  buildPartyTypingContext,
  findBasePartyRowForSingleAccountId,
  getHeaderTypedSuffixFromCode,
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

  describe('getHeaderTypedSuffixFromCode', () => {
    const base = { id: 10, name: 'Acme', code: 'AC', chartId: 1 };
    const typedTt = { id: 55, name: 'Acme-TT', code: 'AC-TT', chartId: 1 };
    const ctx = buildPartyTypingContext([base, typedTt], ['TT']);

    it('returns suffix from code when display name is base but code is suffixed', () => {
      expect(getHeaderTypedSuffixFromCode({ code: 'AC-TT' }, ctx)).toEqual({
        headerIsTyped: true,
        headerSuffix: 'TT',
      });
    });

    it('returns untyped when code has no typed suffix', () => {
      expect(getHeaderTypedSuffixFromCode(base, ctx)).toEqual({
        headerIsTyped: false,
        headerSuffix: '',
      });
    });

    it('ignores misleading name suffix when code is base', () => {
      expect(getHeaderTypedSuffixFromCode({ code: 'AC' }, ctx)).toEqual({
        headerIsTyped: false,
        headerSuffix: '',
      });
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

  describe('stored customer grouping', () => {
    // the production bug this guards: the same shop name exists in two
    // cities, distinguished only by code prefix; name-first matching binds
    // the typed account to whichever city's base row comes first
    const abdBase = {
      id: 1,
      name: 'Kitab Ghar',
      code: 'ABD-KITAB',
      chartId: 1,
      customerGroupId: 100,
    };
    const queBase = {
      id: 2,
      name: 'Kitab Ghar',
      code: 'QUE-KITAB',
      chartId: 1,
      customerGroupId: 200,
    };
    const queTyped = {
      id: 3,
      name: 'Kitab Ghar-T',
      code: 'QUE-KITAB-T',
      chartId: 1,
      customerGroupId: 200,
    };
    const all = [abdBase, queBase, queTyped];
    const ctx = buildPartyTypingContext(all, ['T']);

    it('resolves a grouped typed account within its own group, never the same-name other city', () => {
      // abdBase is listed FIRST, so name-first matching would return it
      const r = findBasePartyRowForSingleAccountId(
        3,
        [abdBase, queBase],
        all,
        ctx,
      );
      expect(r).toEqual(queBase);
    });

    it('returns nothing when the group holds no base row, instead of cross-binding by name', () => {
      const r = findBasePartyRowForSingleAccountId(3, [abdBase], all, ctx);
      expect(r).toBeUndefined();
    });

    it('keeps the existing string-matching for ungrouped accounts', () => {
      const ungroupedBase = { id: 10, name: 'Acme', code: 'AC', chartId: 1 };
      const ungroupedTyped = {
        id: 55,
        name: 'Acme-T',
        code: 'AC-T',
        chartId: 1,
      };
      const looseCtx = buildPartyTypingContext(
        [ungroupedBase, ungroupedTyped],
        ['T'],
      );
      expect(
        findBasePartyRowForSingleAccountId(
          55,
          [ungroupedBase],
          [ungroupedBase, ungroupedTyped],
          looseCtx,
        ),
      ).toEqual(ungroupedBase);
    });

    it('resolvePartyRowForSplitByType honors the group for the typed header', () => {
      const r = resolvePartyRowForSplitByType(3, [abdBase, queBase], all, ctx);
      expect(r).toEqual(queBase);
    });

    it('prefers the code-matching base row when a group has several', () => {
      const extraBase = {
        id: 4,
        name: 'Kitab Ghar Depot',
        code: 'QUE-DEPOT',
        chartId: 1,
        customerGroupId: 200,
      };
      const r = findBasePartyRowForSingleAccountId(
        3,
        [abdBase, extraBase, queBase],
        [...all, extraBase],
        buildPartyTypingContext([...all, extraBase], ['T']),
      );
      expect(r).toEqual(queBase);
    });
  });
});
