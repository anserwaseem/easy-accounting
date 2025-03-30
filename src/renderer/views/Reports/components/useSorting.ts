import { useState } from 'react';
import { orderBy } from 'lodash';

export type SortDirection = 'asc' | 'desc';

export interface UseSortingOptions<T, K extends string> {
  initialSortField: K;
  initialSortDirection?: SortDirection;
  customSortFunctions?: Partial<
    Record<K, (items: T[], direction: SortDirection) => T[]>
  >;
}

export function useSorting<T, K extends string>(
  options: UseSortingOptions<T, K>,
) {
  const {
    initialSortField,
    initialSortDirection = 'asc',
    customSortFunctions = {} as Partial<
      Record<K, (items: T[], direction: SortDirection) => T[]>
    >,
  } = options;

  const [sortField, setSortField] = useState<K>(initialSortField);
  const [sortDirection, setSortDirection] =
    useState<SortDirection>(initialSortDirection);

  const handleSort = (field: K) => {
    if (field === sortField) {
      // Toggle sort direction if clicking the same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new field and default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortItems = (items: T[]): T[] => {
    // Use custom sort function if provided for this field
    if (customSortFunctions[sortField]) {
      const customSortFn = customSortFunctions[sortField];
      if (customSortFn) {
        return customSortFn(items, sortDirection);
      }
    }

    // Default to using lodash orderBy
    return orderBy(items, [sortField as string], [sortDirection]);
  };

  return {
    sortField,
    sortDirection,
    handleSort,
    sortItems,
  };
}
