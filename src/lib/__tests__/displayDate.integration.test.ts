import {
  formatBillDate,
  tourColumnHeader,
} from '@/renderer/views/Reports/CollectionSheet/buildCollectionSheetRows';
import {
  getInvoicePrintDateParts,
  formatInvoicePrintDate,
} from '@/renderer/lib/invoicePrint/locale';
import { formatDisplayDate, formatDisplayDateTime } from '../displayDate';

describe('app-wide date format integration', () => {
  it('renders every stored shape as 03 Feb, 2026', () => {
    expect(formatDisplayDate('2026-02-03')).toBe('03 Feb, 2026');
    expect(formatDisplayDate('2026-02-03T07:00:00.000Z')).toBe('03 Feb, 2026');
    expect(formatDisplayDate('2026-02-03 14:05:09')).toBe('03 Feb, 2026');
  });

  it('renders the collection sheet bill date in the app format', () => {
    expect(formatBillDate('2026-02-03')).toBe('03 Feb, 2026');
    expect(formatBillDate('2026-02-03T07:00:00.000Z')).toBe('03 Feb, 2026');
  });

  it('renders tour column headers with a day-month day', () => {
    expect(
      tourColumnHeader({
        id: 1,
        name: 'Feb 2026',
        startDate: '2026-02-03',
        endDate: '2026-02-20',
      }),
    ).toBe('Feb 2026 · 03 Feb–20 Feb');
  });

  it('renders the printed invoice date in the app format', () => {
    expect(formatInvoicePrintDate('2026-02-03T07:00:00.000Z', 'en')).toBe(
      '03 Feb, 2026',
    );
    const parts = getInvoicePrintDateParts('2026-02-03T07:00:00.000Z', 'en');
    expect(parts?.formatted).toBe('03 Feb, 2026');
  });

  it('keeps the Urdu print date in its own script', () => {
    expect(formatInvoicePrintDate(new Date(2026, 8, 3), 'ur')).toBe(
      '3 ستمبر 2026',
    );
  });

  it('formats audit timestamps with a time', () => {
    expect(formatDisplayDateTime('2026-02-03 14:05:09')).toBe(
      '03 Feb, 2026, 02:05:09 PM',
    );
  });
});
