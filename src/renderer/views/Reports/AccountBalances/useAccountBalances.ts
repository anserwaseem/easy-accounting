import { useState, useEffect, useCallback } from 'react';
import { isEmpty, sumBy } from 'lodash';
import type { Account, Chart, LedgerView } from '@/types';
import type { AccountBalances, AccountBalanceItem } from './types';

export const useAccountBalances = () => {
  const [selectedHead, setSelectedHead] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [charts, setCharts] = useState<Chart[]>([]);
  const [accountBalances, setAccountBalances] = useState<AccountBalances>({
    headName: '',
    accounts: [],
    totalDebit: 0,
    totalCredit: 0,
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

  // fetch account balances for a specific head
  const fetchAccountBalances = useCallback(
    async (headName: string, date: Date) => {
      if (!headName) return;

      setIsLoading(true);
      try {
        // fetch all accounts for the selected head
        const rawAccounts = await window.electron.getAccounts();

        // filter accounts by the selected head
        const filteredAccounts = rawAccounts.filter(
          (account: Account) => account.headName === headName,
        );

        if (isEmpty(filteredAccounts)) {
          setAccountBalances({
            headName,
            accounts: [],
            totalDebit: 0,
            totalCredit: 0,
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

        // transform accounts into balance items format
        const balanceItems: AccountBalanceItem[] = [];
        const selectedDateEnd = new Date(date);
        selectedDateEnd.setHours(23, 59, 59, 999);

        for (const account of filteredAccounts) {
          const ledger = accountLedgers[account.id];

          if (isEmpty(ledger)) continue;

          // filter ledger entries up to the selected date
          const entriesUpToSelectedDate = ledger.filter(
            (entry: LedgerView) => new Date(entry.date) <= selectedDateEnd,
          );

          if (isEmpty(entriesUpToSelectedDate)) continue;

          // get the latest entry up to selected date
          const latestEntry =
            entriesUpToSelectedDate[entriesUpToSelectedDate.length - 1];
          const { balance, balanceType } = latestEntry;

          balanceItems.push({
            id: account.id,
            name: account.name,
            code: account.code,
            balance,
            balanceType,
            address: account.address,
            phone1: account.phone1,
            phone2: account.phone2,
            goodsName: account.goodsName,
          });
        }

        // Calculate totals - sum all debit and credit balances
        const totalDebit = sumBy(
          balanceItems.filter((item) => item.balanceType === 'Dr'),
          'balance',
        );
        const totalCredit = sumBy(
          balanceItems.filter((item) => item.balanceType === 'Cr'),
          'balance',
        );

        setAccountBalances({
          headName,
          accounts: balanceItems,
          totalDebit,
          totalCredit,
        });
      } catch (error) {
        console.error('Error fetching account balances:', error);
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
      fetchAccountBalances(selectedHead, selectedDate);
    }
  }, [selectedHead, selectedDate, fetchAccountBalances]);

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
    accountBalances,
    isLoading,
    handleHeadChange,
    handleDateChange,
  };
};
