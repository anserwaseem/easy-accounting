import { useState, useEffect, useCallback } from 'react';
import { isEmpty, sumBy } from 'lodash';
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
  const [charts, setCharts] = useState<Chart[]>([]);
  const [billsAging, setBillsAging] = useState<BillsAging>({
    headName: '',
    asOfDate: '',
    accounts: [],
  });
  const [isLoading, setIsLoading] = useState(true);

  // fetch available charts (heads)
  const fetchCharts = useCallback(async () => {
    try {
      const fetchedCharts = await window.electron.getCharts();
      setCharts(fetchedCharts);

      // If there's no selected head yet but we have charts, select the last one
      if (!selectedHead && fetchedCharts.length > 0) {
        setSelectedHead(fetchedCharts?.at(-1)?.name || '');
      }
    } catch (error) {
      console.error('Error fetching charts:', error);
    }
  }, [selectedHead]);

  // process bills aging for a specific head
  const fetchBillsAging = useCallback(async (headName: string, date: Date) => {
    if (!headName) return;

    setIsLoading(true);
    try {
      // fetch all accounts for the selected head
      const rawAccounts = await window.electron.getAccounts();
      const filteredAccounts = rawAccounts.filter(
        (account: Account) => account.headName === headName,
      );

      if (isEmpty(filteredAccounts)) {
        setBillsAging({
          headName,
          asOfDate: date.toISOString(),
          accounts: [],
        });
        return;
      }

      // get all account IDs
      const accountIds = filteredAccounts.map((account: Account) => account.id);

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

      const selectedDateEnd = new Date(date);
      selectedDateEnd.setHours(23, 59, 59, 999);

      // collect all journal IDs from all accounts first
      const allJournalIds = new Set<number>();
      const accountLedgersMap: Record<number, LedgerView[]> = {};

      for (const account of filteredAccounts) {
        const ledger = accountLedgers[account.id];
        if (isEmpty(ledger)) continue;

        // filter ledger entries up to the selected date
        const entriesUpToSelectedDate = ledger.filter(
          (entry: LedgerView) => new Date(entry.date) <= selectedDateEnd,
        );

        if (isEmpty(entriesUpToSelectedDate)) continue;

        accountLedgersMap[account.id] = entriesUpToSelectedDate;

        // collect journal IDs from debit entries
        const debitEntries = entriesUpToSelectedDate.filter(
          (entry: LedgerView) => entry.debit > 0,
        );

        debitEntries.forEach((entry: LedgerView) => {
          const match = entry.particulars.match(/Journal #(\d+)/);
          if (match) {
            allJournalIds.add(parseInt(match[1], 10));
          }
        });
      }

      // fetch all journals at once
      const journals: Record<number, Journal> = {};
      if (allJournalIds.size > 0) {
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
      }

      const accounts: BillsAgingAccount[] = [];

      for (const account of filteredAccounts) {
        const entriesUpToSelectedDate = accountLedgersMap[account.id];
        if (!entriesUpToSelectedDate) continue;

        // skip first entry (opening balance) and find first debit entry
        const entriesWithoutOpening = entriesUpToSelectedDate.slice(1);
        const firstDebitIndex = entriesWithoutOpening.findIndex(
          (entry: LedgerView) => entry.debit > 0,
        );

        if (firstDebitIndex === -1) {
          // no debit entries found, skip this account
          continue;
        }

        // separate entries: before first debit vs after first debit
        const entriesBeforeFirstDebit = entriesWithoutOpening.slice(
          0,
          firstDebitIndex,
        );
        const entriesFromFirstDebit =
          entriesWithoutOpening.slice(firstDebitIndex);

        // separate debit and credit entries from the remaining entries
        const debitEntries = entriesFromFirstDebit.filter(
          (entry: LedgerView) => entry.debit > 0,
        );
        const creditEntries = entriesFromFirstDebit.filter(
          (entry: LedgerView) => entry.credit > 0,
        );

        // process bills (debit entries)
        const bills: BillItem[] = [];
        const unallocatedReceipts: UnallocatedReceipt[] = [];

        // add credits before first debit to unallocated receipts
        const creditsBeforeFirstDebit = entriesBeforeFirstDebit.filter(
          (entry: LedgerView) => entry.credit > 0,
        );
        creditsBeforeFirstDebit.forEach((entry: LedgerView) => {
          unallocatedReceipts.push({
            receivedDate: entry.date,
            receivedAmount: entry.credit,
          });
        });

        // group debit entries by journal
        const debitByJournal = debitEntries.reduce(
          (acc: Record<number, LedgerView[]>, entry: LedgerView) => {
            const match = entry.particulars.match(/Journal #(\d+)/);
            if (match) {
              const journalId = parseInt(match[1], 10);
              if (!acc[journalId]) acc[journalId] = [];
              acc[journalId].push(entry);
            }
            return acc;
          },
          {} as Record<number, LedgerView[]>,
        );

        // create bills from debit entries
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
          });
        }

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
                balance: billBalance,
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
          bill.finalBalance = billBalance;
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

        // calculate totals
        const totalBillAmount = sumBy(bills, 'billAmount');
        const totalReceived = sumBy(bills, (bill) =>
          sumBy(bill.receipts, 'receivedAmount'),
        );
        const totalOutstanding = sumBy(bills, 'finalBalance');

        accounts.push({
          accountId: account.id,
          accountName: account.name,
          accountCode: account.code,
          bills,
          unallocatedReceipts,
          totalBillAmount,
          totalReceived,
          totalOutstanding,
        });
      }

      setBillsAging({
        headName,
        asOfDate: date.toISOString(),
        accounts,
      });
    } catch (error) {
      console.error('Error fetching bills aging:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCharts();
  }, [fetchCharts]);

  useEffect(() => {
    if (selectedHead) {
      fetchBillsAging(selectedHead, selectedDate);
    }
  }, [selectedHead, selectedDate, fetchBillsAging]);

  const handleHeadChange = (headName: string) => {
    setSelectedHead(headName);
  };

  const handleDateChange = (date: Date | undefined) => {
    if (!date) return;
    setSelectedDate(date);
  };

  return {
    selectedHead,
    selectedDate,
    charts,
    billsAging,
    isLoading,
    handleHeadChange,
    handleDateChange,
  };
};
