import {
  getSearchTerms,
  matchesSearchTerms,
  normalizeSearchText,
} from '@/renderer/lib/utils';

describe('normalizeSearchText', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeSearchText('  MAKTABA   AYESHA\nSADIQA ')).toBe(
      'maktaba ayesha sadiqa',
    );
  });

  it('handles non-string values', () => {
    expect(normalizeSearchText(1234)).toBe('1234');
    expect(normalizeSearchText(undefined)).toBe('');
    expect(normalizeSearchText(null)).toBe('');
  });
});

describe('getSearchTerms', () => {
  it('splits a query into words', () => {
    expect(getSearchTerms(' AYESHA  SADIQA ')).toEqual(['ayesha', 'sadiqa']);
  });

  it('returns no terms for an empty query', () => {
    expect(getSearchTerms('   ')).toEqual([]);
    expect(getSearchTerms(undefined)).toEqual([]);
  });
});

describe('matchesSearchTerms', () => {
  const row = ['MAKTABA AYESHA SADIQA', 1234, '12/05/2025'];

  it('matches a single word', () => {
    expect(matchesSearchTerms(row, getSearchTerms('AYESHA'))).toBe(true);
  });

  it('matches multiple words in the same field', () => {
    expect(matchesSearchTerms(row, getSearchTerms('AYESHA SADIQA'))).toBe(true);
  });

  it('ignores word order and extra spacing', () => {
    expect(matchesSearchTerms(row, getSearchTerms('SADIQA   ayesha'))).toBe(
      true,
    );
  });

  it('matches irregular spacing in the value itself', () => {
    expect(
      matchesSearchTerms(
        ['MAKTABA  AYESHA\tSADIQA'],
        getSearchTerms('ayesha sadiqa'),
      ),
    ).toBe(true);
  });

  it('matches words spread across different fields', () => {
    expect(matchesSearchTerms(row, getSearchTerms('ayesha 1234'))).toBe(true);
  });

  it('rules out a record when one word matches nothing', () => {
    expect(matchesSearchTerms(row, getSearchTerms('AYESHA KUTUB'))).toBe(false);
  });

  it('matches everything when there are no terms', () => {
    expect(matchesSearchTerms(row, [])).toBe(true);
  });

  it('does not match empty fields against a term', () => {
    expect(matchesSearchTerms([undefined, null], getSearchTerms('a'))).toBe(
      false,
    );
  });
});
