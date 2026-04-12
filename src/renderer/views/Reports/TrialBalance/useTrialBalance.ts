import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { sum, orderBy } from 'lodash';
import type { Account } from '@/types';
import { getFixedNumber } from '@/renderer/lib/utils';
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
      const rawAccounts = (await window.electron.getAccounts()) as Account[];

      const accounts = rawAccounts.map((account) => ({
        ...account,
        type: String(account.type || ''),
      })) as Account[];

      const accountIds = accounts.map((account) => account.id);
      const asOfDay = format(date, 'yyyy-MM-dd');

      const balanceByAccountId =
        await window.electron.getLedgerBalancesForAccountIdsAsOfDate(
          accountIds,
          asOfDay,
        );

      const trialBalanceItems: TrialBalanceItem[] = [];

      for (const account of accounts) {
        const row = balanceByAccountId[account.id];
        if (!row) continue;

        const { balance, balanceType } = row;

        if (getFixedNumber(balance) <= 0) continue;

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

      const sortedTrialBalanceItems = orderBy(
        trialBalanceItems,
        ['code'],
        ['asc'],
      );

      setTrialBalance({
        date,
        accounts: sortedTrialBalanceItems,
        totalDebit,
        totalCredit,
        isBalanced: getFixedNumber(totalDebit) === getFixedNumber(totalCredit),
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
