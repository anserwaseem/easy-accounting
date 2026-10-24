import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_PREFIX = 'report-columns-v2:';

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
 * persists which columns a user wants hidden for a report's export/print.
 * stores the hidden set (opt-out) so a column the user hid stays hidden across
 * reloads while brand-new columns still default to visible.
 * keys are per-report so each report remembers its own selection.
 */
export const useReportColumnVisibility = (
  reportKey: string,
  allColumnIds: readonly string[],
): ReportColumnVisibility => {
  const storageKey = `${STORAGE_PREFIX}${reportKey}`;

  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        const idSet = new Set(allColumnIds);
        // keep only ids that still apply for this report
        return new Set(parsed.filter((id) => idSet.has(id)));
      }
    } catch {
      // storage can throw in private mode; fall back to default below
    }
    return new Set();
  });

  const allColumnSet = useMemo(() => new Set(allColumnIds), [allColumnIds]);

  // drop stale excluded ids when a report's column list changes
  useEffect(() => {
    setExcluded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        if (!allColumnSet.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allColumnSet]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...excluded]));
    } catch {
      // ignore persistence failures; in-memory state still works
    }
  }, [storageKey, excluded]);

  const included = useMemo(() => {
    const next = new Set<string>();
    for (const id of allColumnIds) {
      if (!excluded.has(id)) next.add(id);
    }
    return next;
  }, [allColumnIds, excluded]);

  const isIncluded = useCallback((id: string) => !excluded.has(id), [excluded]);

  const toggle = useCallback((id: string, next?: boolean) => {
    setExcluded((prev) => {
      const nextSet = new Set(prev);
      const visible = next ?? prev.has(id); // next = visible? see ReportColumnsMenu passes checked
      // ReportColumnsMenu.onToggle(id, checked) where checked=visible
      if (visible) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  }, []);

  const toggleAll = useCallback(
    (next: boolean) => {
      setExcluded(next ? new Set() : new Set(allColumnIds));
    },
    [allColumnIds],
  );

  return {
    included,
    isIncluded,
    toggle,
    toggleAll,
    allIncluded: excluded.size === 0,
    includedCount: allColumnIds.length - excluded.size,
    totalCount: allColumnIds.length,
  };
};
