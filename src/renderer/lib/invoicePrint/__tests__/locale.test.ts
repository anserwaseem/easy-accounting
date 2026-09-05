import {
  formatInvoicePrintCurrency,
  formatInvoicePrintDate,
  getInvoicePrintDateParts,
  getInvoicePrintLabels,
  pickPrintLocalizedText,
} from '../locale';

describe('invoicePrint locale helpers', () => {
  it('returns Urdu chrome labels', () => {
    const labels = getInvoicePrintLabels('ur');
    expect(labels.billTo).toBe('بل بنام:');
    expect(labels.price).toBe('ریٹ');
    expect(labels.total).toBe('کل رقم:');
    expect(labels.returnedBanner).toBe('واپس شدہ');
    expect(labels.totalQuantity).toBe('کل مقدار:');
    expect(labels.currencyWordsPrefix).toBe('روپے');
  });

  it('applies non-empty Urdu overrides only', () => {
    const labels = getInvoicePrintLabels('ur', {
      billTo: '  وصول کنندہ:  ',
      total: '',
    });
    expect(labels.billTo).toBe('وصول کنندہ:');
    expect(labels.total).toBe('کل رقم:');
  });

  it('formats Urdu Gregorian dates with Urdu month names', () => {
    // local Date avoids UTC offset shifting the calendar day
    expect(formatInvoicePrintDate(new Date(2026, 8, 3), 'ur')).toBe(
      '3 ستمبر 2026',
    );
  });

  it('splits Urdu date so UI can LTR-isolate day/year', () => {
    const parts = getInvoicePrintDateParts(new Date(2026, 8, 3), 'ur');
    expect(parts).toEqual({
      day: 3,
      month: 'ستمبر',
      year: 2026,
      formatted: '3 ستمبر 2026',
    });
  });

  it('prefers Urdu text when locale is ur and Urdu is set', () => {
    expect(pickPrintLocalizedText('English Co', 'اردو کمپنی', 'ur')).toBe(
      'اردو کمپنی',
    );
  });

  it('falls back to English when Urdu is empty', () => {
    expect(pickPrintLocalizedText('English Co', '  ', 'ur')).toBe('English Co');
  });

  it('formats Urdu currency with Western digits', () => {
    expect(formatInvoicePrintCurrency(85680, 'ur')).toBe('85,680.00 روپے');
  });
});
