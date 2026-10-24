import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_PREFIX = 'report-columns:';

interface ReportColumnVisibility {
  readonly included: ReadonlySet<string>;
  readonly isIncluded: (id: string) => boolean;
  readonly toggle: (id: string, next?: boolean) => void;
  readonly toggleAll: (next: boolean) => void;
  readonly allIncluded: boolean;
  readonly includedCount: number;
  readonly totalCount: number;
}

/**
 * persists which columns a user wants visible for a report's export/print.
 * keys are per-report so each report remembers its own selection.
 * defaults to every column included (opt-out model): new columns appear
 * automatically until the user explicitly hides them.
 */
export const useReportColumnVisibility = (
  reportKey: string,
  allColumnIds: readonly string[],
): ReportColumnVisibility => {
  const storageKey = `${STORAGE_PREFIX}${reportKey}`;
  const [included, setIncluded] = useState<ReadonlySet<string>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        const set = new Set(parsed);
        // keep only ids that still apply; add brand-new ids so they default visible
        const next = new Set<string>();
        for (const id of allColumnIds) {
          if (parsed.length === 0 || set.has(id)) next.add(id);
        }
        // migrate older saved sets by keeping unknown keys out
        return next.size > 0 ? next : new Set(allColumnIds);
      }
    } catch {
      // storage can throw in private mode; fall back to default below
    }
    return new Set(allColumnIds);
  });

  const allColumnSet = useMemo(() => new Set(allColumnIds), [allColumnIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...included]));
    } catch {
      // ignore persistence failures; in-memory state still works
    }
  }, [storageKey, included]);

  // remember the last id set actually seen so an unstable parent array (e.g.
  // headers rebuilt every render) does not re-add columns the user removed
  const previousIdsRef = useRef<string>('');

  // re-sync only when the actual set of column ids changes, e.g. a new
  // "adjusted" column is added or a tour/date range changes the list. a new
  // array with the same ids must not re-add columns the user hid.
  useEffect(() => {
    const sortedIds = [...allColumnIds].sort().join('\u0001');
    if (sortedIds === previousIdsRef.current) return;
    previousIdsRef.current = sortedIds;

    setIncluded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of allColumnIds) {
        if (!prev.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      for (const id of prev) {
        if (!allColumnSet.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allColumnIds, allColumnSet]);

  const isIncluded = useCallback((id: string) => included.has(id), [included]);

  const toggle = useCallback((id: string, next?: boolean) => {
    setIncluded((prev) => {
      const on = next ?? !prev.has(id);
      const nextSet = new Set(prev);
      if (on) nextSet.add(id);
      else nextSet.delete(id);
      return nextSet;
    });
  }, []);

  const toggleAll = useCallback(
    (next: boolean) => {
      setIncluded(next ? new Set(allColumnIds) : new Set());
    },
    [allColumnIds],
  );

  return {
    included,
    isIncluded,
    toggle,
    toggleAll,
    allIncluded: included.size === allColumnIds.length,
    includedCount: included.size,
    totalCount: allColumnIds.length,
  };
};
