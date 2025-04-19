import { useState, useEffect, useCallback } from 'react';
import { get, isEmpty } from 'lodash';
import { AccountType, type Account, type LedgerView } from '@/types';
import type { CashFlow } from './types';

export const useCashFlow = () => {
  const [cashFlow, setCashFlow] = useState<CashFlow>({
    operatingCashFlow: 0,
    investingCashFlow: 0,
    financingCashFlow: 0,
    netCashFlow: 0,
    cashFlowFromSales: 0,
    cashFlowFromPurchases: 0,
    cashFlowFromExpenses: 0,
    lastUpdated: new Date(),
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchCashFlow = useCallback(async () => {
    setIsLoading(true);
    try {
      // fetch all accounts
      const accounts: Account[] = await window.electron.getAccounts();

      // get all account IDs
      const accountIds = accounts.map((account: Account) => account.id);

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

      // initialize cash flow metrics
      let operatingCashFlow = 0;
      let investingCashFlow = 0;
      let financingCashFlow = 0;
      let cashFlowFromSales = 0;
      let cashFlowFromPurchases = 0;
      let cashFlowFromExpenses = 0;

      for (const account of accounts) {
        const ledger = accountLedgers[account.id];
        if (isEmpty(ledger)) continue;

        const { headName } = account;
        const parentHeadName = get(account, 'parentHeadName');
        const heads = [headName, parentHeadName];
        // calculate cash flow from sales
        if (
          account.name.toLowerCase().includes('sale') &&
          heads.includes(AccountType.Revenue)
        ) {
          const latestEntry = ledger[ledger.length - 1];
          const { balance, balanceType } = latestEntry;
          cashFlowFromSales += balanceType === 'Cr' ? balance : -balance;
        }

        // calculate cash flow from purchases
        if (account.name.toLowerCase().includes('purchase')) {
          const latestEntry = ledger[ledger.length - 1];
          const { balance, balanceType } = latestEntry;
          cashFlowFromPurchases += balanceType === 'Dr' ? balance : -balance;
        }

        // calculate cash flow from expenses
        if (heads.includes(AccountType.Expense)) {
          const latestEntry = ledger[ledger.length - 1];
          const { balance, balanceType } = latestEntry;
          cashFlowFromExpenses += balanceType === 'Dr' ? balance : -balance;
        }

        // calculate operating cash flow
        if (
          heads.includes('Current Asset') ||
          heads.includes('Current Liability')
        ) {
          const latestEntry = ledger[ledger.length - 1];
          const { balance, balanceType } = latestEntry;
          const amount = balanceType === 'Dr' ? balance : -balance;

          if (heads.includes('Current Asset')) {
            operatingCashFlow += amount;
          } else {
            operatingCashFlow -= amount;
          }
        }

        // calculate investing cash flow
        if (heads.includes('Fixed Asset')) {
          const latestEntry = ledger[ledger.length - 1];
          const { balance, balanceType } = latestEntry;
          investingCashFlow += balanceType === 'Dr' ? balance : -balance;
        }

        // calculate financing cash flow
        if (heads.includes(AccountType.Equity) || heads.includes('Loan')) {
          const latestEntry = ledger[ledger.length - 1];
          const { balance, balanceType } = latestEntry;
          financingCashFlow += balanceType === 'Cr' ? balance : -balance;
        }
      }

      // calculate net cash flow
      const netCashFlow =
        operatingCashFlow + investingCashFlow + financingCashFlow;

      setCashFlow({
        operatingCashFlow,
        investingCashFlow,
        financingCashFlow,
        netCashFlow,
        cashFlowFromSales,
        cashFlowFromPurchases,
        cashFlowFromExpenses,
        lastUpdated: new Date(),
      });
    } catch (error) {
      console.error('Error fetching cash flow:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCashFlow();
  }, [fetchCashFlow]);

  return {
    cashFlow,
    isLoading,
    refetch: fetchCashFlow,
  };
};
