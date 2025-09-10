import { useCallback, useEffect, useMemo, useState } from 'react';
import { isEmpty } from 'lodash';
import { AccountType, type Account, type LedgerView } from '@/types';
import type {
  AverageEquityBalanceItem,
  AverageEquityBalancesState,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

const toStartOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const toEndOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

// credit treated as positive, debit treated as negative
const getSignedBalance = (
  balance: number,
  balanceType: LedgerView['balanceType'],
): number => (balanceType === 'Cr' ? balance : -balance);

const computeTimeWeightedAverage = (
  ledger: LedgerView[],
  startDate: Date,
  endDate: Date,
): number => {
  if (!ledger || ledger.length === 0) return 0;

  const start = toStartOfDay(startDate).getTime();
  const end = toEndOfDay(endDate).getTime();
  if (end <= start) return 0;

  // only consider entries up to end date (inclusive)
  const entriesUpToEnd = ledger.filter(
    (e) => new Date(e.date).getTime() <= end,
  );
  if (entriesUpToEnd.length === 0) return 0;

  // find last entry strictly before the start
  let lastBeforeStart: LedgerView | undefined;
  for (let i = 0; i < entriesUpToEnd.length; i += 1) {
    const t = new Date(entriesUpToEnd[i].date).getTime();
    if (t < start) lastBeforeStart = entriesUpToEnd[i];
    else break;
  }

  const changePoints: Array<{ time: number; balance: number }> = [];
  const initialBalance = lastBeforeStart
    ? getSignedBalance(lastBeforeStart.balance, lastBeforeStart.balanceType)
    : 0;
  changePoints.push({ time: start, balance: initialBalance });

  // entries within [start, end]
  for (let i = 0; i < entriesUpToEnd.length; i += 1) {
    const entry = entriesUpToEnd[i];
    const t = new Date(entry.date).getTime();
    if (t >= start) {
      changePoints.push({
        time: t,
        balance: getSignedBalance(entry.balance, entry.balanceType),
      });
    }
  }

  if (changePoints.length === 0) return 0;

  // accumulate balance * days over intervals
  let weightedSum = 0;
  for (let i = 0; i < changePoints.length; i += 1) {
    const cur = changePoints[i];
    const nextTime =
      i + 1 < changePoints.length ? changePoints[i + 1].time : end;
    const t0 = Math.max(cur.time, start);
    const t1 = Math.min(nextTime, end);
    if (t1 <= t0) {
      // skip intervals with zero or negative duration (no time passes in this interval)
      continue;
    }
    const durationDays = (t1 - t0) / DAY_MS;
    weightedSum += cur.balance * durationDays;
  }

  const totalDays = (end - start) / DAY_MS;
  if (totalDays <= 0) return 0;
  return weightedSum / totalDays;
};

export const useAverageEquityBalances = () => {
  const now = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => {
    const d = new Date(now);
    d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [now]);
  const defaultState = useMemo(
    () => ({
      items: [],
      totalAverage: 0,
    }),
    [],
  );

  const [startDate, setStartDate] = useState<Date>(defaultStart);
  const [endDate, setEndDate] = useState<Date>(now);
  const [state, setState] = useState<AverageEquityBalancesState>(defaultState);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchData = useCallback(
    async (s: Date, e: Date) => {
      setIsLoading(true);
      try {
        const allAccounts = <Account[]>await window.electron.getAccounts();
        const equityAccounts = allAccounts.filter(
          (a) => a.type === AccountType.Equity,
        );
        if (isEmpty(equityAccounts)) {
          setState(defaultState);
          return;
        }

        const ledgerPromises = equityAccounts.map((acc) =>
          window.electron.getLedger(acc.id),
        );
        const ledgersResults = <LedgerView[][]>(
          await Promise.all(ledgerPromises)
        );

        const items: AverageEquityBalanceItem[] = equityAccounts.map(
          (acc, idx) => {
            const ledger = ledgersResults[idx] || [];
            const avg = computeTimeWeightedAverage(ledger, s, e);
            return {
              id: acc.id,
              name: acc.name,
              code: acc.code,
              averageBalance: avg,
            };
          },
        );

        const totalAverage = items.reduce(
          (sum, it) => sum + it.averageBalance,
          0,
        );
        setState({ items, totalAverage });
      } catch (error) {
        console.error('Error fetching average equity balances:', error);
        setState(defaultState);
      } finally {
        setIsLoading(false);
      }
    },
    [defaultState],
  );

  useEffect(() => {
    fetchData(startDate, endDate);
  }, [fetchData, startDate, endDate]);

  const handleStartDateChange = (date: Date | undefined) => {
    if (!date) return;
    setStartDate(date);
  };

  const handleEndDateChange = (date: Date | undefined) => {
    if (!date) return;
    setEndDate(date);
  };

  const handleRefresh = useCallback(() => {
    fetchData(startDate, endDate);
  }, [fetchData, startDate, endDate]);

  return {
    startDate,
    endDate,
    state,
    isLoading,
    handleStartDateChange,
    handleEndDateChange,
    handleRefresh,
  };
};
