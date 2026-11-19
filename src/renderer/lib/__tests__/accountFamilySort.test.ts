import {
  clusterAccountsByFamily,
  compareAccountCode,
  getAccountFamilyBaseCode,
  sortAccountFamiliesByLabel,
  sortAccountsKeepingFamiliesTogether,
} from '../accountFamilySort';
import { buildPartyTypingContext } from '@/renderer/views/NewInvoice/lib/partyAccountTyping';

describe('accountFamilySort', () => {
  const itemTypes = ['T', 'TT'];

  const accounts = [
    { id: 3, name: 'MRD-A-TT', code: 'MRD-A-TT', outstanding: 2100 },
    { id: 1, name: 'Other', code: 'ZZ-OTHER', outstanding: 5000 },
    { id: 2, name: 'MRD-A', code: 'MRD-A', outstanding: 40000 },
    { id: 4, name: 'MRD-A-T', code: 'MRD-A-T', outstanding: 8500 },
    { id: 5, name: 'Kar', code: 'KAR-USMANIA', outstanding: 12000 },
  ];

  it('compareAccountCode uses numeric-aware ordering', () => {
    expect(compareAccountCode('MRD-A', 'MRD-A-T')).toBeLessThan(0);
    expect(compareAccountCode('A-2', 'A-10')).toBeLessThan(0);
  });

  it('getAccountFamilyBaseCode collapses typed tiers to base', () => {
    const ctx = buildPartyTypingContext(accounts, itemTypes);
    expect(
      getAccountFamilyBaseCode({ name: 'MRD-A-T', code: 'MRD-A-T' }, ctx),
    ).toBe('MRD-A');
    expect(
      getAccountFamilyBaseCode({ name: 'MRD-A', code: 'MRD-A' }, ctx),
    ).toBe('MRD-A');
  });

  it('clusterAccountsByFamily keeps tiers contiguous and base-first', () => {
    const clustered = clusterAccountsByFamily(accounts, itemTypes);
    const codes = clustered.map((a) => a.code);
    const mrdStart = codes.indexOf('MRD-A');
    expect(codes.slice(mrdStart, mrdStart + 3)).toEqual([
      'MRD-A',
      'MRD-A-T',
      'MRD-A-TT',
    ]);
  });

  it('clusterAccountsByFamily with empty item types still groups by code prefix order', () => {
    const clustered = clusterAccountsByFamily(accounts, []);
    const codes = clustered.map((a) => a.code);
    const mrdStart = codes.indexOf('MRD-A');
    expect(codes.slice(mrdStart, mrdStart + 3)).toEqual([
      'MRD-A',
      'MRD-A-T',
      'MRD-A-TT',
    ]);
  });

  it('sortAccountsKeepingFamiliesTogether orders families by max metric', () => {
    const sorted = sortAccountsKeepingFamiliesTogether(
      accounts,
      itemTypes,
      (a) => a.outstanding,
      { familyMetric: 'max', direction: 'desc' },
    );
    expect(sorted.map((a) => a.code)).toEqual([
      'MRD-A',
      'MRD-A-T',
      'MRD-A-TT',
      'KAR-USMANIA',
      'ZZ-OTHER',
    ]);
  });

  it('sortAccountsKeepingFamiliesTogether asc uses min family metric', () => {
    const sorted = sortAccountsKeepingFamiliesTogether(
      accounts,
      itemTypes,
      (a) => a.outstanding,
      { familyMetric: 'min', direction: 'asc' },
    );
    // MRD family min=2100, KAR=12000, ZZ=5000 → MRD, ZZ, KAR
    expect(sorted.map((a) => a.code)).toEqual([
      'MRD-A',
      'MRD-A-T',
      'MRD-A-TT',
      'ZZ-OTHER',
      'KAR-USMANIA',
    ]);
  });

  it('sortAccountFamiliesByLabel orders by base name', () => {
    const sorted = sortAccountFamiliesByLabel(
      accounts,
      itemTypes,
      (members) => members[0]?.name ?? '',
      'asc',
    );
    // within-family order puts MRD-A first; family labels: Kar, MRD-A, Other
    expect(sorted.map((a) => a.code)).toEqual([
      'KAR-USMANIA',
      'MRD-A',
      'MRD-A-T',
      'MRD-A-TT',
      'ZZ-OTHER',
    ]);
  });
});
