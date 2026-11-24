import {
  endOfMonth,
  endOfYear,
  format,
  startOfMonth,
  startOfYear,
  subMonths,
  subYears,
} from 'date-fns';
import {
  getDateRangePresetLabel,
  hydrateSavedDateFilter,
  isKnownDateRangePreset,
  mergeDateRangePresets,
  parseSavedDateRange,
  resolveDateRangePreset,
} from '../dateRangePresets';

const day = (d: Date) => format(d, 'yyyy-MM-dd');

describe('resolveDateRangePreset', () => {
  const now = new Date(2026, 10, 24, 12, 0, 0); // 24 Nov 2026 local

  it.each([
    ['all', '1926-11-24', '2026-11-24'],
    ['0', '2026-11-24', '2026-11-24'],
    ['-1', '2026-11-23', '2026-11-24'],
    ['-7', '2026-11-17', '2026-11-24'],
    ['-30', day(subMonths(now, 1)), '2026-11-24'],
    ['-365', day(subYears(now, 1)), '2026-11-24'],
    ['last-2-years', '2024-11-24', '2026-11-24'],
    ['current-month', '2026-11-01', '2026-11-24'],
    ['current-year', '2026-01-01', '2026-11-24'],
  ] as const)(
    'rolling preset %s ends at today',
    (preset, expectedFrom, expectedTo) => {
      const range = resolveDateRangePreset(preset, now)!;
      expect(day(range.from!)).toBe(expectedFrom);
      expect(day(range.to!)).toBe(expectedTo);
    },
  );

  it('closed presets stay on calendar month/year (not rolling to)', () => {
    const lastMonth = subMonths(now, 1);
    const lastYear = subYears(now, 1);
    const monthRange = resolveDateRangePreset('last-month', now)!;
    expect(day(monthRange.from!)).toBe(day(startOfMonth(lastMonth)));
    expect(day(monthRange.to!)).toBe(day(endOfMonth(lastMonth)));

    const yearRange = resolveDateRangePreset('last-year', now)!;
    expect(day(yearRange.from!)).toBe(day(startOfYear(lastYear)));
    expect(day(yearRange.to!)).toBe(day(endOfYear(lastYear)));
  });

  it('returns undefined for unknown / empty', () => {
    expect(resolveDateRangePreset('')).toBeUndefined();
    expect(resolveDateRangePreset('custom')).toBeUndefined();
    expect(resolveDateRangePreset('not-a-preset')).toBeUndefined();
    expect(isKnownDateRangePreset('all')).toBe(true);
    expect(isKnownDateRangePreset('-7')).toBe(true);
    expect(isKnownDateRangePreset('')).toBe(false);
    expect(isKnownDateRangePreset('custom')).toBe(false);
  });
});

describe('parseSavedDateRange / labels / merge', () => {
  it('accepts ISO strings and Date objects', () => {
    const fromIso = parseSavedDateRange({
      from: '2026-11-10T00:00:00.000Z',
      to: '2026-11-17T00:00:00.000Z',
    });
    expect(fromIso?.from).toBeInstanceOf(Date);
    expect(fromIso?.to).toBeInstanceOf(Date);

    const fromDates = parseSavedDateRange({
      from: new Date(2026, 10, 10),
      to: new Date(2026, 10, 17),
    });
    expect(day(fromDates!.from!)).toBe('2026-11-10');
    expect(day(fromDates!.to!)).toBe('2026-11-17');
  });

  it('rejects incomplete or invalid ranges', () => {
    expect(parseSavedDateRange(undefined)).toBeUndefined();
    expect(parseSavedDateRange({ from: '2026-11-10' })).toBeUndefined();
    expect(
      parseSavedDateRange({ from: 'nope', to: '2026-11-10' }),
    ).toBeUndefined();
  });

  it('labels defaults and All; merge prefers custom label', () => {
    expect(getDateRangePresetLabel('current-year')).toBe('Current Year');
    expect(getDateRangePresetLabel('all')).toBe('All');
    expect(getDateRangePresetLabel('')).toBeUndefined();
    const merged = mergeDateRangePresets([
      { label: 'Everything', value: 'all' },
    ]);
    expect(merged.find((p) => p.value === 'all')?.label).toBe('Everything');
  });
});

describe('hydrateSavedDateFilter', () => {
  const now = new Date(2026, 10, 24, 12, 0, 0);
  const staleWeekAgo = {
    from: new Date(2026, 10, 10).toISOString(),
    to: new Date(2026, 10, 10).toISOString(),
  };

  it.each(['all', '-7', 'current-month', 'current-year', 'last-2-years', '0'])(
    'recomputes rolling preset %s from now (ignores stale ISO)',
    (preset) => {
      const hydrated = hydrateSavedDateFilter(
        { dateRange: staleWeekAgo, presetValue: preset },
        { now },
      );
      expect(hydrated.presetValue).toBe(preset);
      expect(day(hydrated.dateRange!.to!)).toBe('2026-11-24');
      expect(day(hydrated.dateRange!.to!)).not.toBe('2026-11-10');
    },
  );

  it('week-later reopen simulation: All pick day vs reopen day', () => {
    const pickDay = new Date(2026, 10, 10, 12, 0, 0);
    const reopenDay = new Date(2026, 10, 24, 12, 0, 0);
    const savedAtPick = {
      dateRange: {
        from: resolveDateRangePreset('all', pickDay)!.from!.toISOString(),
        to: resolveDateRangePreset('all', pickDay)!.to!.toISOString(),
      },
      presetValue: 'all',
    };

    const hydrated = hydrateSavedDateFilter(savedAtPick, { now: reopenDay });
    expect(hydrated.presetValue).toBe('all');
    expect(day(hydrated.dateRange!.to!)).toBe('2026-11-24');
    expect(day(hydrated.dateRange!.from!)).toBe('1926-11-24');
  });

  it('keeps custom frozen dates when preset empty', () => {
    const hydrated = hydrateSavedDateFilter(
      { dateRange: staleWeekAgo, presetValue: '' },
      { now, defaultPreset: 'current-year' },
    );
    expect(hydrated.presetValue).toBe('');
    expect(day(hydrated.dateRange!.to!)).toBe('2026-11-10');
  });

  it('CollectionSheet custom marker keeps frozen dates', () => {
    const hydrated = hydrateSavedDateFilter(
      { dateRange: staleWeekAgo, presetValue: 'custom' },
      { now, defaultPreset: 'current-month' },
    );
    expect(hydrated.presetValue).toBe('');
    expect(day(hydrated.dateRange!.from!)).toBe('2026-11-10');
  });

  it('falls back to defaultPreset when nothing saved', () => {
    const hydrated = hydrateSavedDateFilter(
      {},
      { now, defaultPreset: 'current-month' },
    );
    expect(hydrated.presetValue).toBe('current-month');
    expect(day(hydrated.dateRange!.from!)).toBe('2026-11-01');
    expect(day(hydrated.dateRange!.to!)).toBe('2026-11-24');
  });

  it('trims whitespace on saved preset', () => {
    const hydrated = hydrateSavedDateFilter(
      { dateRange: staleWeekAgo, presetValue: '  all  ' },
      { now },
    );
    expect(hydrated.presetValue).toBe('all');
    expect(day(hydrated.dateRange!.to!)).toBe('2026-11-24');
  });

  it('parses Date objects from electron-store style payloads', () => {
    const hydrated = hydrateSavedDateFilter(
      {
        dateRange: {
          from: new Date(2026, 10, 1),
          to: new Date(2026, 10, 5),
        },
        presetValue: '',
      },
      { now },
    );
    expect(hydrated.presetValue).toBe('');
    expect(day(hydrated.dateRange!.from!)).toBe('2026-11-01');
    expect(day(hydrated.dateRange!.to!)).toBe('2026-11-05');
  });
});
