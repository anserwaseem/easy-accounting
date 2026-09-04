import {
  formatInvoicePrintCurrency,
  formatInvoicePrintDate,
  getInvoicePrintLabels,
  pickPrintLocalizedText,
} from '../locale';

describe('invoicePrint locale helpers', () => {
  it('returns Urdu chrome labels', () => {
    const labels = getInvoicePrintLabels('ur');
    expect(labels.billTo).toBe('بل بنام:');
    expect(labels.totalQuantity).toBe('کل مقدار:');
    expect(labels.currencyWordsPrefix).toBe('روپے');
  });

  it('formats Urdu Gregorian dates with Urdu month names', () => {
    // local Date avoids UTC offset shifting the calendar day
    expect(formatInvoicePrintDate(new Date(2026, 8, 3), 'ur')).toBe(
      '3 ستمبر 2026',
    );
  });

  it('prefers Urdu text when locale is ur and Urdu is set', () => {
    expect(pickPrintLocalizedText('English Co', 'اردو کمپنی', 'ur')).toBe(
      'اردو کمپنی',
    );
  });

  it('falls back to English when Urdu is empty', () => {
    expect(pickPrintLocalizedText('English Co', '  ', 'ur')).toBe(
      'English Co',
    );
  });

  it('formats Urdu currency with Western digits', () => {
    expect(formatInvoicePrintCurrency(85680, 'ur')).toBe('85,680.00 روپے');
  });
});
