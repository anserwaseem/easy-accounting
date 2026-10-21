import {
  formatDisplayDate,
  formatDisplayDateTime,
  formatDisplayDayMonth,
  formatDisplayTime,
  displayDateTitle,
  parseStoredDate,
} from '../displayDate';

describe('parseStoredDate', () => {
  it('parses a bare calendar day as a local date, not UTC midnight', () => {
    // new Date('2026-02-03') is UTC midnight, which is Feb 2 west of UTC
    const parsed = parseStoredDate('2026-02-03');
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(1);
    expect(parsed!.getDate()).toBe(3);
  });

  it('parses a SQLite localtime timestamp as local wall-clock time', () => {
    const parsed = parseStoredDate('2026-02-03 14:05:09');
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(1);
    expect(parsed!.getDate()).toBe(3);
    expect(parsed!.getHours()).toBe(14);
    expect(parsed!.getMinutes()).toBe(5);
    expect(parsed!.getSeconds()).toBe(9);
  });

  it('accepts the T separator for localtime timestamps', () => {
    const parsed = parseStoredDate('2026-02-03T14:05:09');
    expect(parsed!.getDate()).toBe(3);
    expect(parsed!.getHours()).toBe(14);
  });

  it('keeps milliseconds from a fractional localtime timestamp', () => {
    const parsed = parseStoredDate('2026-02-03 14:05:09.250');
    expect(parsed!.getMilliseconds()).toBe(250);
  });

  it('parses a local-noon ISO instant', () => {
    const parsed = parseStoredDate('2026-02-03T07:00:00.000Z');
    expect(parsed).not.toBeNull();
    expect(Number.isNaN(parsed!.getTime())).toBe(false);
  });

  it('returns null for empty and unparseable values', () => {
    expect(parseStoredDate(null)).toBeNull();
    expect(parseStoredDate(undefined)).toBeNull();
    expect(parseStoredDate('')).toBeNull();
    expect(parseStoredDate('   ')).toBeNull();
    expect(parseStoredDate('not a date')).toBeNull();
  });

  it('passes a valid Date through', () => {
    const date = new Date(2026, 1, 3);
    expect(parseStoredDate(date)).toBe(date);
  });
});

describe('formatDisplayDate', () => {
  it('formats a date as 03 Feb, 2026', () => {
    expect(formatDisplayDate('2026-02-03')).toBe('03 Feb, 2026');
  });

  it('formats a local-noon ISO date as 03 Feb, 2026', () => {
    expect(formatDisplayDate('2026-02-03T07:00:00.000Z')).toBe('03 Feb, 2026');
  });

  it('formats a localtime timestamp as 03 Feb, 2026', () => {
    expect(formatDisplayDate('2026-02-03 14:05:09')).toBe('03 Feb, 2026');
  });

  it('zero-pads single digit days', () => {
    expect(formatDisplayDate('2026-02-03')).toBe('03 Feb, 2026');
    expect(formatDisplayDate('2026-11-09')).toBe('09 Nov, 2026');
  });

  it('returns an empty string for an empty value', () => {
    expect(formatDisplayDate(null)).toBe('');
    expect(formatDisplayDate('')).toBe('');
    expect(formatDisplayDate(undefined)).toBe('');
  });

  it('keeps an unparseable value visible instead of blanking it', () => {
    expect(formatDisplayDate('not a date')).toBe('not a date');
  });
});

describe('formatDisplayDateTime', () => {
  it('formats a timestamp with its time', () => {
    expect(formatDisplayDateTime('2026-02-03 14:05:09')).toBe(
      '03 Feb, 2026, 02:05 PM',
    );
  });
});

describe('formatDisplayDayMonth', () => {
  it('formats a compact day and month', () => {
    expect(formatDisplayDayMonth('2026-02-03')).toBe('03 Feb');
  });
});

describe('formatDisplayTime', () => {
  it('formats a time only', () => {
    expect(formatDisplayTime('2026-02-03 14:05:09')).toBe('02:05 PM');
  });
});

describe('displayDateTitle', () => {
  it('gives the full date with hour and minute for a hover title', () => {
    expect(displayDateTitle('2026-02-03 14:05:09')).toBe(
      '03 Feb, 2026, 02:05 PM',
    );
  });

  it('gives a local-noon ISO date the same title in any timezone', () => {
    // the stored instant is 12:00 local in UTC+5, so the clock time depends
    // on the timezone the test runs in; only the calendar day is fixed
    const title = displayDateTitle('2026-02-03T07:00:00.000Z');
    expect(title).toMatch(/^03 Feb, 2026, \d{2}:\d{2} (AM|PM)$/);
  });

  it('omits the title for an empty or unparseable value', () => {
    expect(displayDateTitle(null)).toBeUndefined();
    expect(displayDateTitle(undefined)).toBeUndefined();
    expect(displayDateTitle('')).toBeUndefined();
    expect(displayDateTitle('not a date')).toBeUndefined();
  });
});
