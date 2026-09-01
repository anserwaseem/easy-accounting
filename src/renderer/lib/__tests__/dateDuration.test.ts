import { formatDaysDuration, getMonthsAndDaysBetween } from '../utils';

describe('getMonthsAndDaysBetween', () => {
  it('returns zero for the same date', () => {
    expect(
      getMonthsAndDaysBetween(new Date('2025-06-01'), new Date('2025-06-01')),
    ).toEqual({ months: 0, remainingDays: 0 });
  });

  it('counts whole months with no day remainder', () => {
    expect(
      getMonthsAndDaysBetween(new Date('2025-01-15'), new Date('2025-02-15')),
    ).toEqual({ months: 1, remainingDays: 0 });
    expect(
      getMonthsAndDaysBetween(new Date('2025-01-30'), new Date('2025-03-30')),
    ).toEqual({ months: 2, remainingDays: 0 });
  });

  it('does not overcount months for a month-end start date (naive diff would say 2 months)', () => {
    expect(
      getMonthsAndDaysBetween(new Date('2025-01-31'), new Date('2025-03-03')),
    ).toEqual({ months: 1, remainingDays: 3 });
  });

  it('clamps to the last day of a short February in a non-leap year', () => {
    // Jan 31 + 1 month lands on Feb 28 (2025 is not a leap year), not into March
    expect(
      getMonthsAndDaysBetween(new Date('2025-01-31'), new Date('2025-02-28')),
    ).toEqual({ months: 1, remainingDays: 0 });
  });

  it('accounts for the extra day in a leap-year February', () => {
    // Feb 2024 has 29 days, so Jan 29 -> Mar 1 is exactly 1 month 1 day
    expect(
      getMonthsAndDaysBetween(new Date('2024-01-29'), new Date('2024-03-01')),
    ).toEqual({ months: 1, remainingDays: 1 });
    // Feb 2025 (non-leap) has 28 days, so the same span is 1 month 1 day too,
    // but anchored a day earlier in the calendar (Feb 28 vs Feb 29)
    expect(
      getMonthsAndDaysBetween(new Date('2025-01-29'), new Date('2025-03-01')),
    ).toEqual({ months: 1, remainingDays: 1 });
  });

  it('spans a full year correctly', () => {
    expect(
      getMonthsAndDaysBetween(new Date('2025-01-01'), new Date('2025-12-31')),
    ).toEqual({ months: 11, remainingDays: 30 });
  });

  it('never returns a negative result when `to` precedes `from`', () => {
    expect(
      getMonthsAndDaysBetween(new Date('2025-06-15'), new Date('2025-06-01')),
    ).toEqual({ months: 0, remainingDays: 0 });
  });
});

describe('formatDaysDuration', () => {
  it('formats zero as "0 days"', () => {
    expect(formatDaysDuration(0, 0)).toBe('0 days');
  });

  it('pluralizes days correctly', () => {
    expect(formatDaysDuration(0, 1)).toBe('1 day');
    expect(formatDaysDuration(0, 5)).toBe('5 days');
  });

  it('pluralizes months correctly', () => {
    expect(formatDaysDuration(1, 0)).toBe('1 month');
    expect(formatDaysDuration(6, 0)).toBe('6 months');
  });

  it('combines months and days', () => {
    expect(formatDaysDuration(6, 20)).toBe('6 months 20 days');
    expect(formatDaysDuration(1, 1)).toBe('1 month 1 day');
  });

  it('clamps negative inputs to zero', () => {
    expect(formatDaysDuration(-2, -5)).toBe('0 days');
  });
});
