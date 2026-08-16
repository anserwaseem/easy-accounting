import type { SortingFn } from '@tanstack/react-table';
import type { AttributeDefinition, InventoryItem } from 'types';

/**
 * Sorting and filtering for the inventory grid's open-ended columns.
 *
 * Attributes and price lists share a problem the base columns do not have: an
 * empty cell is ordinary rather than missing data, so the comparators here sort
 * empties last in both directions instead of letting them lead a descending
 * sort. Display title and publish state are filtered rather than sorted; see
 * the filter model at the bottom of this file for why.
 *
 * Attributes are stored as JSON on the item, so one column can hold numbers,
 * booleans or text depending on its definition. Comparing them as strings puts
 * "12" after "9" and "Yes" beside "7.5 x 10", so each type needs its own
 * comparator, keyed off the definition rather than guessed per value.
 *
 * The question this exists to answer is "which 16-line items have no binding
 * set", which no amount of searching can express: it is a conjunction of one
 * attribute equalling a value and another being absent. Hence a filter model
 * where **unset is a first-class choice** rather than the absence of one.
 */

/** an attribute is unset when it is missing, null, or an empty string */
export const isAttributeUnset = (value: unknown): boolean =>
  value === null || value === undefined || value === '';

/** the display form, shared by the grid cell, the detail panel and the filters */
export const formatAttributeValue = (value: unknown): string => {
  if (isAttributeUnset(value)) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};

/**
 * Compares two raw attribute values of a known type.
 * Unset always sorts last, in both directions, matching the nulls-last
 * convention the List # column already uses.
 */
export const compareAttributeValues = (
  a: unknown,
  b: unknown,
  valueType: AttributeDefinition['valueType'],
): number => {
  const aUnset = isAttributeUnset(a);
  const bUnset = isAttributeUnset(b);
  if (aUnset && bUnset) return 0;
  if (aUnset) return 1;
  if (bUnset) return -1;

  if (valueType === 'number') {
    const na = Number(a);
    const nb = Number(b);
    // a number attribute holding non-numeric text should not silently become
    // NaN and compare equal to everything, so fall back to text for those
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      return String(a).localeCompare(String(b));
    }
    return na - nb;
  }

  if (valueType === 'bool') {
    const ba = a === true || a === 1 || a === 'Yes';
    const bb = b === true || b === 1 || b === 'Yes';
    if (ba === bb) return 0;
    return ba ? 1 : -1;
  }

  return String(a).localeCompare(String(b), undefined, { numeric: true });
};

/** tanstack comparator for one attribute column */
export const createAttributeSortingFn =
  (def: AttributeDefinition): SortingFn<InventoryItem> =>
  (rowA, rowB) =>
    compareAttributeValues(
      rowA.original.attributes?.[def.key],
      rowB.original.attributes?.[def.key],
      def.valueType,
    );

/** tanstack comparator for one price-list column; unpriced items sort last */
export const createPriceListSortingFn =
  (
    getPrice: (item: InventoryItem) => number | null | undefined,
  ): SortingFn<InventoryItem> =>
  (rowA, rowB) => {
    const a = getPrice(rowA.original);
    const b = getPrice(rowB.original);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a - b;
  };

/** "any" means no constraint; "unset" matches only items missing the value */
export type AttributeFilter =
  | { mode: 'any' }
  | { mode: 'unset' }
  | { mode: 'value'; value: string };

export type AttributeFilters = Record<string, AttributeFilter>;

/** the distinct values present in the data, for the filter dropdown */
export const distinctAttributeValues = (
  items: InventoryItem[],
  def: AttributeDefinition,
): string[] => {
  const seen = new Set<string>();
  items.forEach((item) => {
    const text = formatAttributeValue(item.attributes?.[def.key]);
    if (text !== '') seen.add(text);
  });
  return [...seen].sort((a, b) =>
    compareAttributeValues(
      a,
      b,
      def.valueType === 'bool' ? 'text' : def.valueType,
    ),
  );
};

/** every active filter must match, so filters narrow rather than widen */
export const matchesAttributeFilters = (
  item: InventoryItem,
  filters: AttributeFilters,
): boolean =>
  Object.entries(filters).every(([key, filter]) => {
    if (filter.mode === 'any') return true;
    const raw = item.attributes?.[key];
    if (filter.mode === 'unset') return isAttributeUnset(raw);
    return formatAttributeValue(raw) === filter.value;
  });

/** how many attribute filters are actually constraining the view */
export const countActiveFilters = (filters: AttributeFilters): number =>
  Object.values(filters).filter((f) => f.mode !== 'any').length;

/**
 * Publish state and display title are filtered rather than sorted.
 *
 * Both have a handful of states rather than an order, and the question is
 * always "show me the ones that are X" rather than "rank these". A filter
 * answers that directly; sorting only floats them to the top and leaves the
 * user counting rows.
 */
export type PublishFilter =
  | 'any'
  | 'ready'
  | 'held back'
  | 'not ready'
  | 'not a candidate';

/** an item with no title publishes under its item name, which is the default */
export type DisplayTitleFilter = 'any' | 'set' | 'unset';

export interface InventoryFilters {
  attributes: AttributeFilters;
  publish: PublishFilter;
  displayTitle: DisplayTitleFilter;
}

export const emptyInventoryFilters: InventoryFilters = {
  attributes: {},
  publish: 'any',
  displayTitle: 'any',
};

export const matchesInventoryFilters = (
  item: InventoryItem,
  filters: InventoryFilters,
  getPublishState: (item: InventoryItem) => string | undefined,
): boolean => {
  if (!matchesAttributeFilters(item, filters.attributes)) return false;

  if (filters.displayTitle !== 'any') {
    const hasTitle = !isAttributeUnset(item.title);
    if (filters.displayTitle === 'set' && !hasTitle) return false;
    if (filters.displayTitle === 'unset' && hasTitle) return false;
  }

  if (filters.publish !== 'any') {
    const state = getPublishState(item);
    // an item with no state is not a catalog candidate, which is itself a
    // choice a user can filter for
    if (filters.publish === 'not a candidate') return state === undefined;
    if (state !== filters.publish) return false;
  }

  return true;
};

export const countActiveInventoryFilters = (
  filters: InventoryFilters,
): number =>
  countActiveFilters(filters.attributes) +
  (filters.publish === 'any' ? 0 : 1) +
  (filters.displayTitle === 'any' ? 0 : 1);

/**
 * The table's resting order.
 *
 * `defaultSortField` only seeds the initial sort. Clicking a column through to
 * its unsorted state drops the table back to whatever order the query returned,
 * which is not List # and looks arbitrary. Ordering the data itself means
 * removing a sort returns to List #, which is what the column is for.
 */
export const byListPosition = (items: InventoryItem[]): InventoryItem[] =>
  [...items].sort((a, b) => {
    const av = a.listPosition;
    const bv = b.listPosition;
    if (av == null && bv == null) return a.id - b.id;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av !== bv) return av - bv;
    return a.id - b.id;
  });
