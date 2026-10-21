import { formatInvoicePrintDate, getInvoicePrintDateParts } from '../locale';

describe('printed invoice date format', () => {
  it('prints the English invoice date in the app-wide format', () => {
    expect(formatInvoicePrintDate('2026-02-03T07:00:00.000Z', 'en')).toBe(
      '03 Feb, 2026',
    );
  });

  it('prints the English date parts with the app-wide format', () => {
    const parts = getInvoicePrintDateParts('2026-02-03T07:00:00.000Z', 'en');
    expect(parts).toEqual({
      day: 3,
      month: 'Feb',
      year: 2026,
      formatted: '03 Feb, 2026',
    });
  });

  it('does not shift a bare calendar day west of UTC', () => {
    // '2026-02-03' parsed as UTC midnight would print as Feb 2 in a negative offset
    expect(formatInvoicePrintDate('2026-02-03', 'en')).toBe('03 Feb, 2026');
  });
});
