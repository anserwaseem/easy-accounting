import { useState, useEffect, useCallback } from 'react';
import { isEmpty, sum } from 'lodash';
import type { Account, LedgerView } from '@/types';
import type { TrialBalance, TrialBalanceItem } from './types';

export const useTrialBalance = () => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [trialBalance, setTrialBalance] = useState<TrialBalance>({
    date: new Date(),
    accounts: [],
    totalDebit: 0,
    totalCredit: 0,
    isBalanced: true,
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchTrialBalance = useCallback(async (date: Date) => {
    setIsLoading(true);
    try {
      // fetch all accounts with their balances
      const rawAccounts = (await window.electron.getAccounts()) as Account[];

      // convert raw accounts to our expected type with string type
      const accounts = rawAccounts.map((account) => ({
        ...account,
        type: String(account.type || ''),
      })) as Account[];

      // get all account IDs
      const accountIds = accounts.map((account) => account.id);

      // fetch all ledgers in a single batch operation
      const ledgersPromises = accountIds.map((id: number) =>
        window.electron.getLedger(id),
      );
      const ledgersResults = await Promise.all(ledgersPromises);

      // map accounts to ledgers
      const accountLedgers = accounts.reduce(
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

      // transform accounts into trial balance format
      const trialBalanceItems: TrialBalanceItem[] = [];
      const selectedDateEnd = new Date(date);
      selectedDateEnd.setHours(23, 59, 59, 999); // set to end of day for comparison

      for (const account of accounts) {
        const ledger = accountLedgers[account.id];

        if (isEmpty(ledger)) continue;

        // filter ledger entries up to the selected date
        const entriesUpToSelectedDate = ledger.filter(
          (entry) => new Date(entry.date) <= selectedDateEnd,
        );

        if (isEmpty(entriesUpToSelectedDate)) continue;

        const latestEntry =
          entriesUpToSelectedDate[entriesUpToSelectedDate.length - 1];
        const { balance, balanceType } = latestEntry;

        if (balance === 0) continue; // skip accounts with zero balance

        trialBalanceItems.push({
          id: account.id,
          name: account.name,
          code: account.code,
          type: account.type,
          debit: balanceType === 'Dr' ? balance : 0,
          credit: balanceType === 'Cr' ? balance : 0,
        });
      }

      const totalDebit = sum(trialBalanceItems.map((item) => item.debit));
      const totalCredit = sum(trialBalanceItems.map((item) => item.credit));

      setTrialBalance({
        date,
        accounts: trialBalanceItems,
        totalDebit,
        totalCredit,
        isBalanced: totalDebit === totalCredit,
      });
    } catch (error) {
      console.error('Error fetching trial balance:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrialBalance(selectedDate);
  }, [selectedDate, fetchTrialBalance]);

  const handleDateChange = (date: Date | undefined) => {
    if (!date) return;
    setSelectedDate(date);
  };

  return {
    selectedDate,
    trialBalance,
    isLoading,
    handleDateChange,
  };
};
