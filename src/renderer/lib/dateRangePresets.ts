import {
  addDays,
  addMonths,
  addYears,
  endOfMonth,
  endOfYear,
  startOfMonth,
  startOfYear,
  subMonths,
  subYears,
} from 'date-fns';
import { isNaN, toNumber } from 'lodash';
import type { DateRange } from 'react-day-picker';

export type DateRangePresetOption = { label: string; value: string };

/** built-in presets shared by DateRangePickerWithPresets */
export const DEFAULT_DATE_RANGE_PRESETS: DateRangePresetOption[] = [
  { label: 'Today', value: '0' },
  { label: 'Yesterday', value: '-1' },
  { label: 'Last 7 Days', value: '-7' },
  { label: 'Last 30 Days', value: '-30' },
  { label: 'Last 365 Days', value: '-365' },
  { label: 'Last 2 Years', value: 'last-2-years' },
  { label: 'Current Month', value: 'current-month' },
  { label: 'Current Year', value: 'current-year' },
  { label: 'Last Month', value: 'last-month' },
  { label: 'Last Year', value: 'last-year' },
];

/** optional extras (callers pass these into the picker when needed) */
export const ALL_DATE_RANGE_PRESET: DateRangePresetOption = {
  label: 'All',
  value: 'all',
};

/** merge defaults + extras; later entries win on duplicate values */
export const mergeDateRangePresets = (
  customPresets: DateRangePresetOption[] = [],
): DateRangePresetOption[] => {
  const map = new Map<string, DateRangePresetOption>();
  for (const preset of DEFAULT_DATE_RANGE_PRESETS) {
    map.set(preset.value, preset);
  }
  for (const preset of customPresets) {
    map.set(preset.value, preset);
  }
  return Array.from(map.values());
};

/**
 * resolve a preset id to a concrete range relative to `now`.
 * unknown / empty → undefined (caller keeps custom dates).
 */
export const resolveDateRangePreset = (
  preset: string,
  now: Date = new Date(),
): DateRange | undefined => {
  if (!preset) return undefined;

  if (preset === 'all') {
    return { from: subYears(now, 100), to: now };
  }
  if (preset === 'current-month') {
    return { from: startOfMonth(now), to: now };
  }
  if (preset === 'current-year') {
    return { from: startOfYear(now), to: now };
  }
  if (preset === 'last-year') {
    const lastYear = subYears(now, 1);
    return { from: startOfYear(lastYear), to: endOfYear(lastYear) };
  }
  if (preset === 'last-month') {
    const lastMonth = subMonths(now, 1);
    return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
  }
  if (preset === 'last-2-years') {
    // rolling window: two whole years back from today up to today
    return { from: subYears(now, 2), to: now };
  }

  const numberVal = toNumber(preset);
  if (isNaN(numberVal)) return undefined;

  if (numberVal === 0) {
    return { from: now, to: now };
  }

  if (numberVal < 0) {
    let fromDate: Date;
    switch (numberVal) {
      case -30:
        fromDate = addMonths(now, -1);
        break;
      case -365:
        fromDate = addYears(now, -1);
        break;
      default:
        fromDate = addDays(now, numberVal);
        break;
    }
    return { from: fromDate, to: now };
  }

  let toDate: Date;
  switch (numberVal) {
    case 30:
      toDate = addMonths(now, 1);
      break;
    case 365:
      toDate = addYears(now, 1);
      break;
    default:
      toDate = addDays(now, numberVal);
      break;
  }
  return { from: now, to: toDate };
};

export const isKnownDateRangePreset = (
  preset: string | undefined | null,
): boolean => {
  if (!preset) return false;
  return resolveDateRangePreset(preset) !== undefined;
};

export const getDateRangePresetLabel = (
  preset: string | undefined | null,
  customPresets: DateRangePresetOption[] = [],
): string | undefined => {
  if (!preset) return undefined;
  // include All so a restored 'all' still labels correctly even if the
  // caller forgot to pass the extra preset into this lookup
  return mergeDateRangePresets([ALL_DATE_RANGE_PRESET, ...customPresets]).find(
    (p) => p.value === preset,
  )?.label;
};

const toValidDate = (value: unknown): Date | undefined => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
};

/** coerce store / saved ISO (or Date) pair into a DateRange */
export const parseSavedDateRange = (
  dateRange: { from?: unknown; to?: unknown } | DateRange | undefined | null,
): DateRange | undefined => {
  if (!dateRange) return undefined;
  const from = toValidDate(dateRange.from);
  const to = toValidDate(dateRange.to);
  if (!from || !to) return undefined;
  return { from, to };
};

export interface HydratedDateFilter {
  dateRange: DateRange | undefined;
  presetValue: string;
}

/**
 * restore a saved filter: known presets recompute from `now` (intent wins);
 * custom / unknown keep frozen ISO dates.
 */
export const hydrateSavedDateFilter = (
  saved: {
    dateRange?: { from?: unknown; to?: unknown } | DateRange | null;
    presetValue?: string | null;
  },
  options?: {
    defaultPreset?: string;
    defaultRange?: DateRange;
    now?: Date;
  },
): HydratedDateFilter => {
  const now = options?.now ?? new Date();
  const savedPreset = saved.presetValue?.trim() ?? '';

  if (isKnownDateRangePreset(savedPreset)) {
    return {
      dateRange: resolveDateRangePreset(savedPreset, now),
      presetValue: savedPreset,
    };
  }

  const parsed = parseSavedDateRange(saved.dateRange ?? undefined);
  if (parsed) {
    return { dateRange: parsed, presetValue: '' };
  }

  const defaultPreset = options?.defaultPreset ?? '';
  if (isKnownDateRangePreset(defaultPreset)) {
    return {
      dateRange: resolveDateRangePreset(defaultPreset, now),
      presetValue: defaultPreset,
    };
  }

  return {
    dateRange: options?.defaultRange,
    presetValue: defaultPreset,
  };
};
