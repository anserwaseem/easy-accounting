import { format } from 'date-fns';
import {
  hydrateSavedDateFilter,
  isKnownDateRangePreset,
  resolveDateRangePreset,
} from '../dateRangePresets';

const day = (d: Date) => format(d, 'yyyy-MM-dd');

describe('resolveDateRangePreset', () => {
  const now = new Date('2026-11-24T12:00:00');

  it('resolves all to ~100y back through today', () => {
    const range = resolveDateRangePreset('all', now);
    expect(day(range!.from!)).toBe('1926-11-24');
    expect(day(range!.to!)).toBe('2026-11-24');
  });

  it('resolves rolling windows against now', () => {
    expect(day(resolveDateRangePreset('-7', now)!.from!)).toBe('2026-11-17');
    expect(day(resolveDateRangePreset('current-year', now)!.from!)).toBe(
      '2026-01-01',
    );
    expect(day(resolveDateRangePreset('current-month', now)!.from!)).toBe(
      '2026-11-01',
    );
    expect(day(resolveDateRangePreset('0', now)!.from!)).toBe('2026-11-24');
  });

  it('returns undefined for unknown / empty', () => {
    expect(resolveDateRangePreset('')).toBeUndefined();
    expect(resolveDateRangePreset('custom')).toBeUndefined();
    expect(isKnownDateRangePreset('all')).toBe(true);
    expect(isKnownDateRangePreset('')).toBe(false);
  });
});

describe('hydrateSavedDateFilter', () => {
  const now = new Date('2026-11-24T12:00:00');
  const staleAll = {
    from: '2026-11-10T00:00:00.000Z',
    to: '2026-11-10T00:00:00.000Z',
  };

  it('recomputes known presets from now (ignores stale ISO)', () => {
    const hydrated = hydrateSavedDateFilter(
      { dateRange: staleAll, presetValue: 'all' },
      { now },
    );
    expect(hydrated.presetValue).toBe('all');
    expect(day(hydrated.dateRange!.to!)).toBe('2026-11-24');
  });

  it('keeps custom frozen dates when preset empty', () => {
    const hydrated = hydrateSavedDateFilter(
      { dateRange: staleAll, presetValue: '' },
      { now, defaultPreset: 'current-year' },
    );
    expect(hydrated.presetValue).toBe('');
    expect(day(hydrated.dateRange!.to!)).toBe('2026-11-10');
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

  it('treats unknown preset + dates as custom', () => {
    const hydrated = hydrateSavedDateFilter(
      { dateRange: staleAll, presetValue: 'custom' },
      { now },
    );
    expect(hydrated.presetValue).toBe('');
    expect(day(hydrated.dateRange!.from!)).toBe('2026-11-10');
  });
});
