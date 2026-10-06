import { useCallback, useMemo, useRef, useState } from 'react';
import { format, startOfMonth, startOfYear, subYears } from 'date-fns';
import { orderBy } from 'lodash';
import type { DateRange } from '@/renderer/shad/ui/datePicker';
import { useMountEffect } from '@/renderer/hooks/useMountEffect';
import {
  loadSavedFilters,
  makeSavedState,
  saveSavedFilters,
} from '@/renderer/lib/reportFilters';
import type { Account, AgentTour, Chart, ItemType } from '@/types';
import { REPORT_FILTER_KEYS } from '@/types';
import { clipTourToRange, toursOverlap } from '@/core/utils/suggestAgentTours';
import {
  buildCollectionSheetRows,
  type CollectionSheetBill,
  type CollectionSheetLanguage,
  type CollectionSheetMoney,
  type CollectionSheetTourPaid,
} from './buildCollectionSheetRows';

interface CollectionSheetSnapshot {
  accounts: Account[];
  itemTypeNames: string[];
  money: Record<number, CollectionSheetMoney>;
  bills: Record<number, CollectionSheetBill[]>;
  /** normalized yyyy-MM-dd range the numbers were loaded for */
  range: { from: string; to: string };
  /** the head's tours overlapping the sheet range, clipped to it, oldest first */
  tours: (AgentTour & { clipped: boolean })[];
  tourPaid: CollectionSheetTourPaid;
  /** null when the agent has no tours at all, which hides the column */
  untoured: Record<number, number> | null;
}

const NO_TOURS: CollectionSheetSnapshot['tours'] = [];

/**
 * tours are clipped to the sheet range so a row's tour columns plus
 * "not in a tour" always equal Collected. "not in a tour" only means
 * something once the agent has tours.
 */
const loadTourColumns = async (
  chartId: number,
  accountIds: number[],
  from: string,
  to: string,
): Promise<
  Pick<CollectionSheetSnapshot, 'tours' | 'tourPaid' | 'untoured'>
> => {
  const all = await window.electron.getAgentTours(chartId);
  if (all.length === 0) return { tours: [], tourPaid: {}, untoured: null };
  const today = format(new Date(), 'yyyy-MM-dd');
  const tours = orderBy(
    all
      .filter((tour) => toursOverlap(tour, { startDate: from, endDate: to }))
      .map((tour) => clipTourToRange(tour, from, to, today)),
    ['startDate'],
    ['asc'],
  );
  const [tourPaid, untoured] = await Promise.all([
    tours.length === 0
      ? Promise.resolve({})
      : window.electron.getTourCollectionsForAccountIds(
          accountIds,
          tours.map((tour) => tour.id),
          from,
          to,
        ),
    window.electron.getUntouredCollectionsForAccountIds(
      accountIds,
      chartId,
      from,
      to,
    ),
  ]);
  return { tours, tourPaid, untoured };
};

/** rolling presets are recomputed from today. a saved range that does not match is a custom pick. */
const presetAgreesWithRange = (
  preset: string,
  fromIso: string,
  toIso: string,
): boolean => {
  const today = new Date();
  let from: Date;
  let to: Date;
  if (preset === 'current-month') {
    from = startOfMonth(today);
    to = today;
  } else if (preset === 'current-year') {
    from = startOfYear(today);
    to = today;
  } else if (preset === 'all') {
    from = subYears(today, 100);
    to = today;
  } else {
    return true;
  }
  const savedFrom = format(new Date(fromIso), 'yyyy-MM-dd');
  const savedTo = format(new Date(toIso), 'yyyy-MM-dd');
  return (
    savedFrom === format(from, 'yyyy-MM-dd') &&
    savedTo === format(to, 'yyyy-MM-dd')
  );
};

const loadParties = async (): Promise<{
  heads: Chart[];
  accounts: Account[];
  itemTypeNames: string[];
}> => {
  const [chartRows, accountRows, itemTypes] = await Promise.all([
    window.electron.getCharts() as Promise<Chart[]>,
    window.electron.getAccounts(),
    window.electron.getItemTypes() as Promise<ItemType[]>,
  ]);
  const heads = orderBy(
    chartRows.filter((chart) => chart.parentId != null),
    [(chart) => chart.name.toLowerCase()],
    ['asc'],
  );
  const itemTypeNames = itemTypes
    .filter((itemType) => itemType.isActive)
    .map((itemType) => itemType.name);
  return { heads, accounts: accountRows, itemTypeNames };
};

export const useCollectionSheet = () => {
  const saved = useMemo(
    () => loadSavedFilters(REPORT_FILTER_KEYS.collectionSheet),
    [],
  );
  const [charts, setCharts] = useState<Chart[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [itemTypeNames, setItemTypeNames] = useState<string[]>([]);
  const [selectedChartId, setSelectedChartId] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    if (saved.dateRange?.from && saved.dateRange?.to) {
      return {
        from: new Date(saved.dateRange.from),
        to: new Date(saved.dateRange.to),
      };
    }
    return { from: startOfMonth(new Date()), to: new Date() };
  });
  const [presetValue, setPresetValue] = useState(() => {
    const fromIso = saved.dateRange?.from;
    const toIso = saved.dateRange?.to;
    const savedPreset = saved.presetValue ?? '';
    // "this month" used to stick after a custom pick, so the button and the
    // sheet showed different ranges. trust the saved dates when they disagree.
    if (
      fromIso &&
      toIso &&
      (savedPreset === 'custom' ||
        savedPreset === '' ||
        !presetAgreesWithRange(savedPreset, fromIso, toIso))
    ) {
      return '';
    }
    return savedPreset || 'current-month';
  });
  const [language, setLanguage] = useState<CollectionSheetLanguage>('en');
  const [snapshot, setSnapshot] = useState<CollectionSheetSnapshot | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const requestId = useRef(0);

  const loadRows = useCallback(
    async (
      chartId: string,
      range: DateRange | undefined,
      allAccounts: Account[],
      typeNames: string[],
    ) => {
      const token = requestId.current + 1;
      requestId.current = token;
      const id = Number(chartId);
      if (!id || !range?.from || !range?.to) {
        setSnapshot(null);
        setIsLoading(false);
        return;
      }

      const start = format(range.from, 'yyyy-MM-dd');
      const end = format(range.to, 'yyyy-MM-dd');
      const from = start <= end ? start : end;
      const to = start <= end ? end : start;
      const partyAccounts = allAccounts.filter(
        (account) => account.chartId === id && account.isActive,
      );

      setIsLoading(true);
      try {
        if (partyAccounts.length === 0) {
          if (token === requestId.current) setSnapshot(null);
          return;
        }
        const ids = partyAccounts.map((account) => account.id);
        const [balances, collectedById, bills, tourColumns] = await Promise.all(
          [
            window.electron.getLedgerBalancesForAccountIdsAsOfDate(ids, to),
            window.electron.getReceiptSumsForAccountIdsInRange(ids, from, to),
            window.electron.getSaleBillsForAccountIdsInRange(ids, from, to),
            loadTourColumns(id, ids, from, to),
          ],
        );
        if (token !== requestId.current) return;

        const money: Record<number, CollectionSheetMoney> = {};
        for (const account of partyAccounts) {
          const balanceRow = balances[account.id];
          money[account.id] = {
            balance: balanceRow?.balance ?? 0,
            balanceType: balanceRow?.balanceType ?? '',
            collected: collectedById[account.id] ?? 0,
          };
        }
        setSnapshot({
          accounts: partyAccounts,
          itemTypeNames: typeNames,
          money,
          bills,
          range: { from, to },
          ...tourColumns,
        });
      } catch (error) {
        console.error('Error loading collection sheet:', error);
        if (token === requestId.current) setSnapshot(null);
      } finally {
        if (token === requestId.current) setIsLoading(false);
      }
    },
    [],
  );

  const persistFilters = (
    chartId: string,
    range: DateRange | undefined,
    preset: string,
  ) => {
    const id = Number(chartId);
    saveSavedFilters(
      REPORT_FILTER_KEYS.collectionSheet,
      makeSavedState(range, undefined, {
        // empty preset is a custom range. store a marker so reload does not
        // fall back to the "this month" label.
        presetValue: preset || 'custom',
        ...(id > 0 ? { chartId: id } : {}),
      }),
    );
  };

  useMountEffect(() => {
    loadParties()
      .then((loaded) => {
        setCharts(loaded.heads);
        setAccounts(loaded.accounts);
        setItemTypeNames(loaded.itemTypeNames);
        const savedId = saved.chartId;
        const chartId =
          savedId != null && loaded.heads.some((head) => head.id === savedId)
            ? String(savedId)
            : '';
        setSelectedChartId(chartId);
        setCatalogReady(true);
        if (!chartId) return undefined;
        return loadRows(
          chartId,
          dateRange,
          loaded.accounts,
          loaded.itemTypeNames,
        );
      })
      .catch((error) => {
        console.error('Error loading collection sheet parties:', error);
        setCatalogReady(true);
      });
  });

  const handleHeadChange = (chartId: string) => {
    setSelectedChartId(chartId);
    persistFilters(chartId, dateRange, presetValue);
    loadRows(chartId, dateRange, accounts, itemTypeNames).catch((error) => {
      console.error('Error loading collection sheet:', error);
    });
  };

  const handleDateChange = (range: DateRange | undefined, preset?: string) => {
    setDateRange(range);
    // '' is a custom calendar range. ?? would keep the old preset, and a
    // falsy check would refuse to clear "this month".
    const nextPreset = preset === undefined ? presetValue : preset;
    setPresetValue(nextPreset);
    // date picker fires once on mount, before the saved agent is restored
    if (!catalogReady) return;
    if (!range?.from || !range?.to) return;
    persistFilters(selectedChartId, range, nextPreset);
    if (!selectedChartId) return;
    loadRows(selectedChartId, range, accounts, itemTypeNames).catch((error) => {
      console.error('Error loading collection sheet:', error);
    });
  };

  const refreshData = () => {
    loadParties()
      .then((loaded) => {
        setCharts(loaded.heads);
        setAccounts(loaded.accounts);
        setItemTypeNames(loaded.itemTypeNames);
        if (!selectedChartId) return undefined;
        return loadRows(
          selectedChartId,
          dateRange,
          loaded.accounts,
          loaded.itemTypeNames,
        );
      })
      .catch((error) => {
        console.error('Error refreshing collection sheet:', error);
      });
  };

  const selectedHead =
    charts.find((chart) => String(chart.id) === selectedChartId) ?? null;

  const rows = useMemo(() => {
    if (!snapshot) return [];
    return buildCollectionSheetRows(
      snapshot.accounts,
      snapshot.itemTypeNames,
      snapshot.money,
      snapshot.bills,
      language,
      snapshot.tours.map((tour) => tour.id),
      snapshot.tourPaid,
      snapshot.untoured,
    );
  }, [snapshot, language]);

  const tours = snapshot?.tours ?? NO_TOURS;
  const showUntoured = snapshot?.untoured != null;
  // the review panel reads the same range the sheet shows
  const range = snapshot?.range ?? null;

  return {
    charts,
    selectedChartId,
    selectedHead,
    dateRange,
    presetValue,
    language,
    setLanguage,
    rows,
    tours,
    showUntoured,
    range,
    isLoading,
    handleHeadChange,
    handleDateChange,
    refreshData,
    catalogReady,
  };
};
