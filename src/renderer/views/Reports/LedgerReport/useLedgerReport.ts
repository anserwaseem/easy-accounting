import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Account, LedgerRangeResponse, LedgerView } from '@/types';
import type { DateRange } from '@/renderer/shad/ui/datePicker';
import {
  loadSavedFilters,
  saveSavedFilters,
  makeSavedState,
} from '@/renderer/lib/reportFilters';
import { addDays, format } from 'date-fns';
import { BalanceType, REPORT_FILTER_KEYS } from 'types';
import { printLedgerReportIframe } from './printLedgerReport';

type LedgerReportTotals = {
  totalDebit: number;
  totalCredit: number;
  /** absolute difference (closing - opening) in signed-balance space */
  totalDifference: number;
  /** Cr/Dr for totalDifference */
  totalType: BalanceType | '';
};

export const useLedgerReport = () => {
  const saved = useMemo(() => loadSavedFilters(REPORT_FILTER_KEYS.ledger), []);

  const defaultDateRange: DateRange = useMemo(() => {
    if (saved.dateRange?.from && saved.dateRange?.to) {
      return {
        from: new Date(saved.dateRange.from),
        to: new Date(saved.dateRange.to),
      };
    }
    const now = new Date();
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
  }, [saved.dateRange]);

  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    defaultDateRange,
  );
  const [presetValue, setPresetValue] = useState<string>(
    saved.presetValue ?? 'current-year',
  );
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [selectedAccountName, setSelectedAccountName] = useState<string>('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [rangeResponse, setRangeResponse] =
    useState<LedgerRangeResponse | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const accountsData = await window.electron.getAccounts();
      setAccounts(accountsData || []);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const filterRef = useRef(0);

  useEffect(() => {
    if (selectedAccount && accounts.length > 0) {
      const account = accounts.find((a) => a.id === selectedAccount);
      if (account) {
        setSelectedAccountName(account.name || '');
      }
    } else {
      setSelectedAccountName('');
    }
  }, [selectedAccount, accounts]);

  const fetchLedgerRange = useCallback(async () => {
    if (!selectedAccount || !dateRange?.from || !dateRange?.to) {
      setRangeResponse(null);
      return;
    }

    setIsLoading(true);
    filterRef.current += 1;
    const thisFilter = filterRef.current;

    // use local calendar date (avoid UTC shifting via toISOString)
    const startDate = format(dateRange.from, 'yyyy-MM-dd');
    const endDate = format(dateRange.to, 'yyyy-MM-dd');

    try {
      const resp = await window.electron.reportGetLedgerRange({
        accountId: selectedAccount,
        startDate,
        endDate,
      });

      // only apply if filter hasn't changed
      if (thisFilter === filterRef.current) {
        setRangeResponse(resp);
      }
    } catch (error) {
      console.error('Error fetching ledger range:', error);
      if (thisFilter === filterRef.current) {
        setRangeResponse(null);
      }
    } finally {
      if (thisFilter === filterRef.current) {
        setIsLoading(false);
      }
    }
  }, [selectedAccount, dateRange]);

  useEffect(() => {
    fetchLedgerRange();
  }, [fetchLedgerRange]);

  const handleDateChange = useCallback(
    (range?: DateRange, selectValue?: string) => {
      if (!range) return;
      setDateRange(range);
      if (selectValue) setPresetValue(selectValue);

      // persist after debouncing
      setTimeout(() => {
        saveSavedFilters(
          REPORT_FILTER_KEYS.ledger,
          makeSavedState(range, undefined, {
            presetValue: selectValue ?? presetValue,
          }),
        );
      }, 300);
    },
    [presetValue],
  );

  const refreshData = useCallback(() => {
    fetchAccounts();
    fetchLedgerRange();
  }, [fetchAccounts, fetchLedgerRange]);

  const printDateSubtitle = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return '';
    return `${format(dateRange.from, 'PP')} – ${format(dateRange.to, 'PP')}`;
  }, [dateRange]);

  const totals = useMemo<LedgerReportTotals>(() => {
    if (!rangeResponse) {
      return {
        totalDebit: 0,
        totalCredit: 0,
        totalDifference: 0,
        totalType: '',
      };
    }

    const totalDebit = rangeResponse.entries.reduce(
      (acc, e) => acc + e.debit,
      0,
    );
    const totalCredit = rangeResponse.entries.reduce(
      (acc, e) => acc + e.credit,
      0,
    );

    const opening = rangeResponse.openingBalance;
    const closing = rangeResponse.closingBalance;

    const toSigned = (
      b: { balance: number; balanceType: BalanceType } | null,
    ): number => {
      if (!b) return 0;
      return b.balanceType === BalanceType.Cr ? b.balance : -b.balance;
    };

    const diffSigned = toSigned(closing) - toSigned(opening);
    let totalType: BalanceType | '' = '';
    if (diffSigned > 0) totalType = BalanceType.Cr;
    if (diffSigned < 0) totalType = BalanceType.Dr;

    return {
      totalDebit,
      totalCredit,
      totalDifference: Math.abs(diffSigned),
      totalType,
    };
  }, [rangeResponse]);

  // merged entries: opening balance row (synthetic) + in-range entries + closing summary
  const displayedEntries = useMemo<LedgerView[]>(() => {
    if (!rangeResponse) return [];
    const rows: LedgerView[] = [];

    if (rangeResponse.openingBalance) {
      rows.push({
        id: 0,
        // opening balance is "as of end of previous day" relative to the selected range
        date: dateRange?.from
          ? format(addDays(dateRange.from, -1), 'yyyy-MM-dd')
          : '',
        accountId: selectedAccount ?? 0,
        particulars: 'Opening Balance',
        debit: 0,
        credit: 0,
        balance: rangeResponse.openingBalance.balance,
        balanceType: rangeResponse.openingBalance.balanceType,
        linkedAccountId: undefined,
        linkedAccountName: undefined,
      });
    }

    for (const entry of rangeResponse.entries) {
      rows.push({
        id: entry.id,
        date: entry.date,
        accountId: entry.accountId,
        particulars: entry.particulars ?? '',
        debit: entry.debit,
        credit: entry.credit,
        balance: entry.balance,
        balanceType: entry.balanceType,
        linkedAccountId: entry.linkedAccountId,
        linkedAccountName: entry.linkedAccountName ?? undefined,
        journalSummary: entry.journalSummary,
      });
    }

    return rows;
  }, [rangeResponse, dateRange, selectedAccount]);

  const handlePrint = useCallback(() => {
    if (!displayedEntries.length) return;
    printLedgerReportIframe({
      rows: displayedEntries,
      accountName: selectedAccountName,
      dateSubtitle: printDateSubtitle,
      totals,
    });
  }, [displayedEntries, selectedAccountName, printDateSubtitle, totals]);

  return {
    accounts,
    selectedAccount,
    setSelectedAccount,
    dateRange,
    setDateRange,
    presetValue,
    handleDateChange,
    ledgerEntries: displayedEntries,
    isLoading,
    selectedAccountName,
    refreshData,
    handlePrint,
    rangeResponse,
    totals,
  };
};
