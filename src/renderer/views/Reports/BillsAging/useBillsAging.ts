import { useState, useEffect, useCallback, useMemo } from 'react';
import { isEmpty, sumBy } from 'lodash';
import { format, subDays } from 'date-fns';
import { getFixedNumber, getMonthsAndDaysBetween } from 'renderer/lib/utils';
import type { Account, Chart, LedgerView } from '@/types';
import type {
  BillsAging,
  BillsAgingAccount,
  BillItem,
  BillReceipt,
  UnallocatedReceipt,
} from './types';

/** sentinel head meaning "accounts under every agent head" — the default scope */
export const ALL_PARTIES_HEAD = 'All parties';

/** shown while the all-parties scope has no customers selected */
export const ALL_PARTIES_EMPTY_SELECTION_MESSAGE =
  'Search and select customers to see their combined aging.';

/** joins head names into a stable effect dependency; NUL never appears in a head name */
const HEAD_NAME_SEPARATOR = '\u0000';

/** a selectable customer account within the active scope */
export interface PartyOption {
  id: number;
  name: string;
  code?: number | string;
  headName?: string;
}

/** account scoping instructions for one report computation */
interface BillsAgingScope {
  /** names of every agent head (charts with a parentId) */
  agentHeadNames: string[];
  /** account ids to compute in all-parties mode; ignored for a specific head */
  selectedIds: number[];
}

export const useBillsAging = () => {
  const [selectedHead, setSelectedHead] = useState<string>(ALL_PARTIES_HEAD);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setFullYear(2025);
    d.setMonth(0, 1); // default to start of year
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [charts, setCharts] = useState<Chart[]>([]);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [billsAging, setBillsAging] = useState<BillsAging>({
    headName: '',
    asOfDate: '',
    accounts: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [infoMessage, setInfoMessage] = useState<string>('');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<number[]>([]);

  // fetch available charts (heads)
  const fetchCharts = useCallback(async () => {
    try {
      const fetchedCharts = await window.electron.getCharts();
      const filteredCharts = fetchedCharts.filter(
        (chart: Chart) => !!chart.parentId,
      );
      setCharts(filteredCharts);
    } catch (error) {
      console.error('Error fetching charts:', error);
    }
  }, []);

  // fetch every account once so the customer selector can search the whole
  // scope before any report is computed (all-parties mode needs the full pool)
  const fetchAllAccounts = useCallback(async () => {
    try {
      const fetchedAccounts: Account[] = await window.electron.getAccounts();
      setAllAccounts(fetchedAccounts);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  }, []);

  // process bills aging for the active scope: a specific head, or the
  // selected customers across every agent head (all-parties mode)
  const fetchBillsAging = useCallback(
    async (
      headName: string,
      start: Date,
      end: Date,
      scope: BillsAgingScope,
    ) => {
      if (!headName) return;

      const isAllPartiesScope = headName === ALL_PARTIES_HEAD;

      // guard: never compute the full ~all-accounts report; all-parties needs
      // an explicit customer selection before anything is fetched or rendered
      if (isAllPartiesScope && scope.selectedIds.length === 0) {
        setInfoMessage(ALL_PARTIES_EMPTY_SELECTION_MESSAGE);
        setBillsAging({
          headName,
          asOfDate: end.toISOString(),
          accounts: [],
        });
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        setInfoMessage('');

        // fetch all accounts for the active scope
        const rawAccounts: Account[] = await window.electron.getAccounts();
        const filteredAccounts = isAllPartiesScope
          ? rawAccounts.filter(
              (account: Account) =>
                !!account.headName &&
                scope.agentHeadNames.includes(account.headName) &&
                scope.selectedIds.includes(account.id),
            )
          : rawAccounts.filter(
              (account: Account) => account.headName === headName,
            );

        if (isEmpty(filteredAccounts)) {
          setBillsAging({
            headName,
            asOfDate: end.toISOString(),
            accounts: [],
          });
          return;
        }

        const accountIds = filteredAccounts.map(
          (account: Account) => account.id,
        );

        const selectedDateStart = new Date(start);
        selectedDateStart.setHours(0, 0, 0, 0);
        const selectedDateEnd = new Date(end);
        selectedDateEnd.setHours(0, 0, 0, 0);

        const startStr = format(selectedDateStart, 'yyyy-MM-dd');
        const endStr = format(selectedDateEnd, 'yyyy-MM-dd');
        const asOfBeforeStartStr = format(
          subDays(selectedDateStart, 1),
          'yyyy-MM-dd',
        );

        const [openingByAccountId, rangeByAccountId] = await Promise.all([
          window.electron.getLedgerBalancesForAccountIdsAsOfDate(
            accountIds,
            asOfBeforeStartStr,
          ),
          window.electron.getLedgerRangeForAccountIds(
            accountIds,
            startStr,
            endStr,
          ),
        ]);

        // an account that owes money at the start of the period is still owing it when nothing
        // moved during the period, so it must stay in the report as a carry-forward-only row
        const hasOpeningDue = (accountId: number) => {
          const opening = openingByAccountId[accountId];
          return (
            !!opening && opening.balanceType === 'Dr' && opening.balance > 0
          );
        };

        // collect all journal IDs from all accounts first
        const allJournalIds = new Set<number>();
        const accountLedgersMap: Record<number, LedgerView[]> = {};

        for (const account of filteredAccounts) {
          const entriesInRange = rangeByAccountId[account.id] ?? [];

          if (isEmpty(entriesInRange) && !hasOpeningDue(account.id)) continue;

          accountLedgersMap[account.id] = entriesInRange;

          // collect journal IDs from debit entries in range
          const debitEntries = entriesInRange.filter(
            (entry: LedgerView) => entry.debit > 0,
          );

          debitEntries.forEach((entry: LedgerView) => {
            const match = entry.particulars.match(/Journal #(\d+)/);
            if (match) {
              allJournalIds.add(parseInt(match[1], 10));
            }
          });
        }

        // check if there are any entries to process at all
        if (Object.keys(accountLedgersMap).length === 0) {
          setInfoMessage(
            `No entries found for ${
              isAllPartiesScope ? 'the selected customers' : headName
            } during period: ${format(
              selectedDateStart,
              'dd/MM/yyyy',
            )} to ${format(end, 'dd/MM/yyyy')}`,
          );
          setBillsAging({
            headName,
            asOfDate: end.toISOString(),
            accounts: [],
          });
          return;
        }

        const journalIdList = Array.from(allJournalIds);
        const journalSummariesById =
          journalIdList.length > 0
            ? await window.electron.getJournalNarrationSummariesByIds(
                journalIdList,
              )
            : {};

        const accounts: BillsAgingAccount[] = [];

        for (const account of filteredAccounts) {
          // carry-forward-only accounts are kept with an empty list of entries; a missing entry
          // means the account has neither activity in the period nor an opening balance due
          const entriesInRange = accountLedgersMap[account.id];
          if (!entriesInRange) continue;

          // separate debit and credit entries
          const debitEntries = entriesInRange.filter(
            (entry: LedgerView) => entry.debit > 0,
          );
          const creditEntries = entriesInRange.filter(
            (entry: LedgerView) => entry.credit > 0,
          );

          // process bills (debit entries)
          const bills: BillItem[] = [];
          const unallocatedReceipts: UnallocatedReceipt[] = [];

          // treat opening balance as first bill (carry-forward) if balance before period start is Dr
          if (hasOpeningDue(account.id)) {
            const openingAmount = openingByAccountId[account.id].balance;
            bills.push({
              billNumber: 'Opening Balance',
              billPercentage: '-',
              billDate: selectedDateStart.toISOString(),
              billAmount: openingAmount,
              receipts: [],
              finalBalance: openingAmount,
              daysStatus: {
                isFullyPaid: false,
                days: 0,
                months: 0,
                remainingDays: 0,
              },
            });
          }

          // separate debit entries with and without journal references
          const debitByJournal: Record<number, LedgerView[]> = {};
          const debitWithoutJournal: LedgerView[] = [];

          debitEntries.forEach((entry: LedgerView) => {
            const match = entry.particulars.match(/Journal #(\d+)/);
            if (match) {
              const journalId = parseInt(match[1], 10);
              if (!debitByJournal[journalId]) debitByJournal[journalId] = [];
              debitByJournal[journalId].push(entry);
            } else {
              // entries without journal reference (opening balance, manual adjustments, etc.)
              debitWithoutJournal.push(entry);
            }
          });

          // create bills from debit entries with journal references
          for (const [journalId, entries] of Object.entries(debitByJournal)) {
            const summary = journalSummariesById[parseInt(journalId, 10)];
            const billNumber =
              summary?.billNumber != null ? String(summary.billNumber) : '-';
            const billPercentage = summary?.discountPercentage ?? '-';
            const billDate = (entries as LedgerView[])[0].date; // use first entry date
            const billAmount = sumBy(entries as LedgerView[], 'debit');

            bills.push({
              billNumber,
              billPercentage,
              billDate,
              billAmount,
              receipts: [],
              finalBalance: billAmount,
              daysStatus: {
                isFullyPaid: false,
                days: 0,
                months: 0,
                remainingDays: 0,
              },
            });
          }

          // create bills from debit entries without journal references
          debitWithoutJournal.forEach((entry: LedgerView) => {
            bills.push({
              billNumber: entry.particulars, // use particulars as bill identifier
              billPercentage: '-',
              billDate: entry.date,
              billAmount: entry.debit,
              receipts: [],
              finalBalance: entry.debit,
              daysStatus: {
                isFullyPaid: false,
                days: 0,
                months: 0,
                remainingDays: 0,
              },
            });
          });

          // sort bills by date
          bills.sort(
            (a, b) =>
              new Date(a.billDate).getTime() - new Date(b.billDate).getTime(),
          );

          // allocate credit entries to bills using FIFO
          const remainingCredits = [...creditEntries];
          let creditIndex = 0;

          for (const bill of bills) {
            let billBalance = bill.billAmount;
            const receipts: BillReceipt[] = [];

            // process credits until this bill is fully paid or we run out of credits
            while (billBalance > 0 && creditIndex < remainingCredits.length) {
              const credit = remainingCredits[creditIndex];

              if (credit.credit <= billBalance) {
                // full credit can be applied to this bill
                billBalance -= credit.credit;
                receipts.push({
                  receivedDate: credit.date,
                  receivedAmount: credit.credit,
                  balance: getFixedNumber(billBalance, 2),
                });
                creditIndex++; // move to next credit
              } else {
                // partial credit application
                const appliedAmount = billBalance;
                billBalance = 0;
                receipts.push({
                  receivedDate: credit.date,
                  receivedAmount: appliedAmount,
                  balance: 0,
                });

                // reduce the credit amount and continue with same credit for next bill
                remainingCredits[creditIndex] = {
                  ...credit,
                  credit: credit.credit - appliedAmount,
                };
              }
            }

            bill.receipts = receipts;
            bill.finalBalance = getFixedNumber(billBalance, 2);
          }

          // add any remaining credits to unallocated
          for (let i = creditIndex; i < remainingCredits.length; i++) {
            const credit = remainingCredits[i];
            if (credit.credit > 0) {
              unallocatedReceipts.push({
                receivedDate: credit.date,
                receivedAmount: credit.credit,
              });
            }
          }

          // calculate days status for each bill
          bills.forEach((bill) => {
            const billDate = new Date(bill.billDate);
            const isFullyPaid = bill.finalBalance === 0;

            // reference date is the last payment date (if fully paid) or the
            // report date (if still pending)
            const referenceDate =
              isFullyPaid && bill.receipts.length > 0
                ? new Date(bill.receipts[bill.receipts.length - 1].receivedDate)
                : new Date(end);

            const days = Math.max(
              0,
              Math.ceil(
                (referenceDate.getTime() - billDate.getTime()) /
                  (1000 * 60 * 60 * 24),
              ),
            );

            const { months, remainingDays } = getMonthsAndDaysBetween(
              billDate,
              referenceDate,
            );

            bill.daysStatus = {
              isFullyPaid,
              days,
              months,
              remainingDays,
            };
          });

          // calculate totals
          const totalBillAmount = sumBy(bills, 'billAmount');
          const totalReceived = sumBy(bills, (bill) =>
            sumBy(bill.receipts, 'receivedAmount'),
          );
          const totalOutstanding = sumBy(bills, 'finalBalance');
          const totalUnallocated = sumBy(unallocatedReceipts, 'receivedAmount');

          accounts.push({
            accountId: account.id,
            accountName: account.name,
            accountCode: account.code,
            headName: account.headName,
            bills,
            unallocatedReceipts,
            totalBillAmount,
            totalReceived,
            totalOutstanding,
            totalUnallocated,
          });
        }

        setBillsAging({
          headName,
          asOfDate: end.toISOString(),
          accounts,
        });
      } catch (error) {
        console.error('Error fetching bills aging:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchCharts();
    fetchAllAccounts();
  }, [fetchCharts, fetchAllAccounts]);

  const isAllParties = selectedHead === ALL_PARTIES_HEAD;

  // string keys keep the report effect stable: identical content never refires it.
  // the selection key stays '' for a specific head, where the customer filter is
  // applied client-side (today's behavior) instead of recomputing the report
  const agentHeadNamesKey = useMemo(
    () => charts.map((chart) => chart.name).join(HEAD_NAME_SEPARATOR),
    [charts],
  );
  const allPartiesSelectionKey = isAllParties
    ? selectedCustomerIds.join(',')
    : '';

  // recompute the report whenever the scope, period, or all-parties selection changes
  const runReport = useCallback(() => {
    if (!selectedHead) return;
    const agentHeadNames = agentHeadNamesKey
      ? agentHeadNamesKey.split(HEAD_NAME_SEPARATOR)
      : [];
    const selectedIds = allPartiesSelectionKey
      ? allPartiesSelectionKey.split(',').map(Number)
      : [];
    fetchBillsAging(selectedHead, startDate, selectedDate, {
      agentHeadNames,
      selectedIds,
    });
  }, [
    selectedHead,
    startDate,
    selectedDate,
    agentHeadNamesKey,
    allPartiesSelectionKey,
    fetchBillsAging,
  ]);

  useEffect(() => {
    runReport();
  }, [runReport]);

  // selectable customers across every agent head, tagged with their head so the
  // page can disambiguate same-name shops that recur under different agents
  const allPartiesOptions = useMemo<PartyOption[]>(() => {
    const agentHeadNames = new Set(charts.map((chart) => chart.name));
    return allAccounts
      .filter(
        (account) => !!account.headName && agentHeadNames.has(account.headName),
      )
      .map((account) => ({
        id: account.id,
        name: account.name,
        code: account.code,
        headName: account.headName,
      }));
  }, [allAccounts, charts]);

  const handleHeadChange = (headName: string) => {
    setSelectedHead(headName);
    // reset customer filter when head changes
    setSelectedCustomerIds([]);
  };

  const handleCustomerFilterChange = (ids: number[]) => {
    setSelectedCustomerIds(ids);
  };

  const handleDateChange = (date: Date | undefined) => {
    if (!date) return;
    setSelectedDate(date);
  };

  const handleStartDateChange = (date: Date | undefined) => {
    if (!date) return;
    setStartDate(date);
  };

  const refreshData = useCallback(() => {
    fetchCharts();
    fetchAllAccounts();
    runReport();
  }, [fetchCharts, fetchAllAccounts, runReport]);

  return {
    selectedHead,
    isAllParties,
    startDate,
    selectedDate,
    charts,
    billsAging,
    isLoading,
    handleHeadChange,
    handleStartDateChange,
    handleDateChange,
    refreshData,
    infoMessage,
    selectedCustomerIds,
    handleCustomerFilterChange,
    allPartiesOptions,
  };
};
