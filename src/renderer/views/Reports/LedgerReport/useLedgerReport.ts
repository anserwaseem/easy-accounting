import { useState, useEffect, useCallback } from 'react';
import type { Account, LedgerView } from '@/types';

export const useLedgerReport = () => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedAccount, setSelectedAccount] = useState<number | null>(null);
  const [selectedAccountName, setSelectedAccountName] = useState<string>('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerView[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch all accounts
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

  // Update selected account name when account changes
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

  // Fetch ledger entries for the selected account
  const fetchLedgerEntries = useCallback(async () => {
    if (!selectedAccount) {
      setLedgerEntries([]);
      return;
    }

    setIsLoading(true);
    try {
      const ledger = await window.electron.getLedger(selectedAccount);

      // Filter ledger entries up to the selected date
      const selectedDateEnd = new Date(selectedDate);
      selectedDateEnd.setHours(23, 59, 59, 999); // set to end of day for comparison

      const filteredLedger = ledger.filter(
        (entry: LedgerView) => new Date(entry.date) <= selectedDateEnd,
      );

      // Sort by date (ascending)
      const sortedLedger = [...filteredLedger].sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateA - dateB; // Ascending order
      });

      setLedgerEntries(sortedLedger);
    } catch (error) {
      console.error('Error fetching ledger entries:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedAccount, selectedDate]);

  useEffect(() => {
    fetchLedgerEntries();
  }, [fetchLedgerEntries]);

  const handleDateChange = (date: Date | undefined) => {
    if (!date) return;
    setSelectedDate(date);
  };

  // Force refresh the data
  const refreshData = useCallback(() => {
    fetchAccounts();
    fetchLedgerEntries();
  }, [fetchAccounts, fetchLedgerEntries]);

  const handlePrint = useCallback(() => window.print(), []);

  return {
    accounts,
    selectedAccount,
    setSelectedAccount,
    selectedDate,
    handleDateChange,
    ledgerEntries,
    isLoading,
    selectedAccountName,
    refreshData,
    handlePrint,
  };
};
