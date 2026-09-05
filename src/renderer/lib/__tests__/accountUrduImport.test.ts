import type { Account } from 'types';
import {
  ACCOUNT_URDU_EXPORT_HEADERS,
  buildAccountUrduExportRows,
  parseAccountUrduImportRows,
} from '../accountUrduImport';

const sampleAccount = {
  id: 7,
  name: 'ALBALAGH',
  code: 'A-1',
  address: 'Lahore',
  nameUrdu: 'البلاغ',
  addressUrdu: 'لاہور',
  goodsName: 'Books',
  goodsNameUrdu: 'کتب',
} as Account;

describe('accountUrduImport', () => {
  it('builds export rows from accounts', () => {
    expect(buildAccountUrduExportRows([sampleAccount])).toEqual([
      {
        id: 7,
        code: 'A-1',
        name: 'ALBALAGH',
        nameUrdu: 'البلاغ',
        address: 'Lahore',
        addressUrdu: 'لاہور',
        goodsName: 'Books',
        goodsNameUrdu: 'کتب',
      },
    ]);
  });

  it('parses canonical export headers', () => {
    const result = parseAccountUrduImportRows([
      [...ACCOUNT_URDU_EXPORT_HEADERS],
      [7, 'A-1', 'ALBALAGH', 'نام', 'Lahore', 'پتہ', 'Books', 'سامان'],
    ]);
    expect(result.skippedRows).toBe(0);
    expect(result.patches).toEqual([
      {
        id: 7,
        code: 'A-1',
        name: 'ALBALAGH',
        nameUrdu: 'نام',
        addressUrdu: 'پتہ',
        goodsNameUrdu: 'سامان',
      },
    ]);
  });

  it('accepts header aliases and name-only match', () => {
    const result = parseAccountUrduImportRows([
      ['Account Name', 'Urdu Name', 'Address (Urdu)'],
      ['ALBALAGH', 'البلاغ', 'لاہور'],
    ]);
    expect(result.patches).toEqual([
      {
        name: 'ALBALAGH',
        nameUrdu: 'البلاغ',
        addressUrdu: 'لاہور',
      },
    ]);
  });

  it('treats blank Urdu cells as null clears', () => {
    const result = parseAccountUrduImportRows([
      ['Id', 'Name (Urdu)'],
      [7, ''],
    ]);
    expect(result.patches).toEqual([{ id: 7, nameUrdu: null }]);
  });

  it('skips rows without a match key', () => {
    const result = parseAccountUrduImportRows([
      ['Id', 'Name', 'Name (Urdu)'],
      ['', '', 'البلاغ'],
    ]);
    expect(result.patches).toEqual([]);
    expect(result.skippedRows).toBe(1);
  });

  it('rejects sheets without Urdu columns', () => {
    expect(() =>
      parseAccountUrduImportRows([
        ['Id', 'Name'],
        [1, 'X'],
      ]),
    ).toThrow(/Name \(Urdu\)/);
  });
});
