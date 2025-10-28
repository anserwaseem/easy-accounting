import { useState, useEffect, useCallback } from 'react';
import { isEmpty, sumBy } from 'lodash';
import { format } from 'date-fns';
import { getFixedNumber } from 'renderer/lib/utils';
import type { Account, Chart, LedgerView, Journal } from '@/types';
import type {
  BillsAging,
  BillsAgingAccount,
  BillItem,
  BillReceipt,
  UnallocatedReceipt,
} from './types';

export const useBillsAging = () => {
  const [selectedHead, setSelectedHead] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setMonth(0, 1); // default to start of year
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [charts, setCharts] = useState<Chart[]>([]);
  const [billsAging, setBillsAging] = useState<BillsAging>({
    headName: '',
    asOfDate: '',
    accounts: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [infoMessage, setInfoMessage] = useState<string>('');

  // fetch available charts (heads)
  const fetchCharts = useCallback(async () => {
    try {
      const fetchedCharts = await window.electron.getCharts();
      const filteredCharts = fetchedCharts.filter(
        (chart: Chart) => !!chart.parentId,
      );
      setCharts(filteredCharts);

      // If there's no selected head yet but we have charts, select the last one
      if (!selectedHead && filteredCharts.length > 0) {
        setSelectedHead(filteredCharts?.at(0)?.name || '');
      }
    } catch (error) {
      console.error('Error fetching charts:', error);
    }
  }, [selectedHead]);

  // process bills aging for a specific head
  const fetchBillsAging = useCallback(
    async (headName: string, start: Date, end: Date) => {
      if (!headName) return;

      setIsLoading(true);
      try {
        // fetch all accounts for the selected head
        const rawAccounts: Account[] = await window.electron.getAccounts();
        const filteredAccounts = rawAccounts.filter(
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

        // get all account IDs
        const accountIds = filteredAccounts.map(
          (account: Account) => account.id,
        );

        // fetch all ledgers in a single batch operation
        const ledgersPromises = accountIds.map((id: number) =>
          window.electron.getLedger(id),
        );
        const ledgersResults = await Promise.all(ledgersPromises);

        // map accounts to ledgers
        const accountLedgers = filteredAccounts.reduce(
          (
            acc: Record<number, LedgerView[]>,
            account: Account,
            index: number,
          ) => {
            acc[account.id] = ledgersResults[index];
            return acc;
          },
          {} as Record<number, LedgerView[]>,
        );

        // normalize dates to start/end of day for consistent comparison
        const selectedDateEnd = new Date(end);
        selectedDateEnd.setHours(23, 59, 59, 999);
        const selectedDateStart = new Date(start);
        selectedDateStart.setHours(0, 0, 0, 0);

        // helper function to extract date components and compare by calendar date
        const isDateInRange = (dateStr: string): boolean => {
          const entryDate = new Date(dateStr);
          // normalize entry date to midnight for day-based comparison
          const normalizedEntry = new Date(entryDate);
          normalizedEntry.setHours(0, 0, 0, 0);
          const normalizedStart = new Date(selectedDateStart);
          const normalizedEnd = new Date(selectedDateEnd);
          normalizedEnd.setHours(0, 0, 0, 0); // compare at day level

          return (
            normalizedEntry.getTime() >= normalizedStart.getTime() &&
            normalizedEntry.getTime() <= normalizedEnd.getTime()
          );
        };

        // collect all journal IDs from all accounts first
        const allJournalIds = new Set<number>();
        const accountLedgersMap: Record<number, LedgerView[]> = {};

        for (const account of filteredAccounts) {
          const ledger = accountLedgers[account.id];
          if (isEmpty(ledger)) continue;

          // filter ledger entries within the selected date range
          const entriesInRange = ledger.filter((entry: LedgerView) =>
            isDateInRange(entry.date),
          );

          if (isEmpty(entriesInRange)) continue;

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
            `No entries found for ${headName} during period: ${format(
              selectedDateStart,
              'dd/MM/yyyy',
            )} to ${format(selectedDateEnd, 'dd/MM/yyyy')}`,
          );
          setBillsAging({
            headName,
            asOfDate: end.toISOString(),
            accounts: [],
          });
          return;
        }

        // fetch all journals at once (only if there are journal-referenced entries)
        const journals: Record<number, Journal> = {};
        const journalPromises = Array.from(allJournalIds).map(
          async (journalId) => {
            try {
              const journal = await window.electron.getJournal(journalId);
              return { journalId, journal };
            } catch (error) {
              console.error(`Error fetching journal ${journalId}:`, error);
              return { journalId, journal: null };
            }
          },
        );
        const journalResults = await Promise.all(journalPromises);
        journalResults.forEach(({ journalId, journal }) => {
          if (journal) {
            journals[journalId] = journal;
          }
        });

        const accounts: BillsAgingAccount[] = [];

        for (const account of filteredAccounts) {
          const entriesInRange = accountLedgersMap[account.id];
          if (!entriesInRange) continue;

          // treat opening balance as first bill (carry-forward) if start-date balance is Dr
          const fullLedger = accountLedgers[account.id] || [];
          const lastBeforeStart = fullLedger
            .filter(
              (l) => new Date(l.date).getTime() < selectedDateStart.getTime(),
            )
            .at(-1);

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

          // create opening balance bill from last balance before start (if Dr)
          if (
            lastBeforeStart &&
            lastBeforeStart.balanceType === 'Dr' &&
            lastBeforeStart.balance > 0
          ) {
            const openingAmount = lastBeforeStart.balance;
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
            const journal = journals[parseInt(journalId, 10)];
            const billNumber = journal?.billNumber
              ? journal.billNumber.toString()
              : '-';
            const billPercentage = journal?.discountPercentage ?? '-';
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

            let days: number;
            if (isFullyPaid && bill.receipts.length > 0) {
              // calculate days from bill date to last payment date
              const lastPaymentDate = new Date(
                bill.receipts[bill.receipts.length - 1].receivedDate,
              );
              days = Math.ceil(
                (lastPaymentDate.getTime() - billDate.getTime()) /
                  (1000 * 60 * 60 * 24),
              );
            } else {
              // calculate days from bill date to selected date (pending days)
              const reportDate = new Date(end);
              days = Math.ceil(
                (reportDate.getTime() - billDate.getTime()) /
                  (1000 * 60 * 60 * 24),
              );
            }

            bill.daysStatus = {
              isFullyPaid,
              days: Math.max(0, days), // ensure non-negative
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
  }, [fetchCharts]);

  useEffect(() => {
    if (selectedHead) {
      fetchBillsAging(selectedHead, startDate, selectedDate);
    }
  }, [selectedHead, startDate, selectedDate, fetchBillsAging]);

  const handleHeadChange = (headName: string) => {
    setSelectedHead(headName);
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
    if (selectedHead) {
      fetchBillsAging(selectedHead, startDate, selectedDate);
    }
  }, [fetchCharts, selectedHead, startDate, selectedDate, fetchBillsAging]);

  return {
    selectedHead,
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
  };
};
