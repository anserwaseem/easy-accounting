import { getPrintBillToPartyName } from '../invoiceUtils';

describe('getPrintBillToPartyName Urdu preference', () => {
  it('uses header Urdu name when preferUrdu is set', () => {
    expect(
      getPrintBillToPartyName('ALBALAGH', [], undefined, {
        preferUrdu: true,
        headerAccountNameUrdu: 'البلغ',
      }),
    ).toBe('البلغ');
  });

  it('falls back to English header when Urdu is empty', () => {
    expect(
      getPrintBillToPartyName('ALBALAGH', [], undefined, {
        preferUrdu: true,
        headerAccountNameUrdu: '  ',
      }),
    ).toBe('ALBALAGH');
  });

  it('prefers line Urdu names over English line names', () => {
    expect(
      getPrintBillToPartyName(
        'Header',
        ['T'],
        [{ accountName: 'ALBALAGH-T', accountNameUrdu: 'البلغ' }],
        {
          preferUrdu: true,
        },
      ),
    ).toBe('البلغ');
  });
});
