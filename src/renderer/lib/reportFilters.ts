import { type DateRange } from '@/renderer/shad/ui/datePicker';
import type { ReportFilters, SavedFilterState } from 'types';
import { REPORT_FILTER_KEYS } from 'types';

type StoreKey = (typeof REPORT_FILTER_KEYS)[keyof typeof REPORT_FILTER_KEYS];

/** load persisted filter state from electron store */
export function loadSavedFilters(key: StoreKey): SavedFilterState {
  try {
    const raw = window.electron.store.get(key);
    if (raw && typeof raw === 'object') return raw as SavedFilterState;
  } catch {
    console.error(`Error loading saved filters for key: ${key}`);
  }
  return {};
}

/** save filter state to electron store */
export function saveSavedFilters(key: StoreKey, state: SavedFilterState): void {
  try {
    window.electron.store.set(key, state);
  } catch {
    console.warn(`Error saving filters for key: ${key}`, state);
  }
}

/** build ReportFilters from a saved state + default dates */
export function buildFilters(
  saved: SavedFilterState,
  defaults: { startDate: string; endDate: string },
  extra?: {
    itemTypeIds?: number[];
    accountIds?: number[];
    inventoryIds?: number[];
  },
): ReportFilters {
  return {
    startDate: saved.dateRange?.from ?? defaults.startDate,
    endDate: saved.dateRange?.to ?? defaults.endDate,
    groupBy: saved.groupBy ?? 'day',
    ...(saved.groupByPolicy !== undefined
      ? { groupByPolicy: saved.groupByPolicy }
      : {}),
    ...(saved.compareStartDate
      ? { compareStartDate: saved.compareStartDate }
      : {}),
    ...(saved.compareEndDate ? { compareEndDate: saved.compareEndDate } : {}),
    ...(saved.itemTypeIds ? { itemTypeIds: saved.itemTypeIds } : {}),
    ...(saved.accountIds ? { accountIds: saved.accountIds } : {}),
    ...(saved.inventoryIds ? { inventoryIds: saved.inventoryIds } : {}),
    ...extra,
  };
}

/** extract a SavedFilterState from the current report data */
export function makeSavedState(
  dateRange?: DateRange,
  groupBy?: 'day' | 'week' | 'month',
  extra?: {
    groupByPolicy?: boolean;
    compareStartDate?: string;
    compareEndDate?: string;
    comparisonMode?: string;
    itemTypeIds?: number[];
    accountIds?: number[];
    inventoryIds?: number[];
    presetValue?: string;
  },
): SavedFilterState {
  const state: SavedFilterState = {};
  if (dateRange?.from && dateRange?.to) {
    state.dateRange = {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
    };
  }
  if (groupBy) {
    state.groupBy = groupBy;
  }
  if (extra?.groupByPolicy !== undefined) {
    state.groupByPolicy = extra.groupByPolicy;
  }
  if (extra?.compareStartDate) {
    state.compareStartDate = extra.compareStartDate;
  }
  if (extra?.compareEndDate) {
    state.compareEndDate = extra.compareEndDate;
  }
  if (extra?.comparisonMode) {
    state.comparisonMode = extra.comparisonMode;
  }
  if (extra?.itemTypeIds) {
    state.itemTypeIds = extra.itemTypeIds;
  }
  if (extra?.accountIds) {
    state.accountIds = extra.accountIds;
  }
  if (extra?.inventoryIds) {
    state.inventoryIds = extra.inventoryIds;
  }
  if (extra?.presetValue) {
    state.presetValue = extra.presetValue;
  }
  return state;
}

/** default presets for reports that default to "Last 30 Days" */
export const LAST_30_DAYS_PRESETS: { label: string; value: string }[] = [
  { label: 'This Month', value: 'current-month' },
  { label: 'Last Month', value: 'last-month' },
  { label: 'This Year', value: 'current-year' },
];

/** default preset value for "Last 30 Days" */
export const LAST_30_DAYS_PRESET = '-30';
