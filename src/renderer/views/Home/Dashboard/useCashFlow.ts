import { useState, useEffect, useCallback, useRef } from 'react';
import { get } from 'lodash';
import { AccountType, type Account } from '@/types';
import { toLowerString } from '@/renderer/lib/utils';
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
  const isMountedRef = useRef(true);
  const fetchGenerationRef = useRef(0);

  // track component mount status to avoid updates after unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      fetchGenerationRef.current += 1;
    };
  }, []);

  const fetchCashFlow = useCallback(async () => {
    const generation = ++fetchGenerationRef.current;
    setIsLoading(true);
    try {
      const accounts: Account[] = await window.electron.getAccounts();
      if (!isMountedRef.current || generation !== fetchGenerationRef.current)
        return;
      const accountIds = accounts.map((account: Account) => account.id);

      const balanceByAccountId =
        await window.electron.getLedgerBalancesForAccountIds(accountIds);
      if (!isMountedRef.current || generation !== fetchGenerationRef.current)
        return;

      let operatingCashFlow = 0;
      let investingCashFlow = 0;
      let financingCashFlow = 0;
      let cashFlowFromSales = 0;
      let cashFlowFromPurchases = 0;
      let cashFlowFromExpenses = 0;

      for (const account of accounts) {
        const latest = balanceByAccountId[account.id];
        if (!latest) continue;

        const { balance, balanceType } = latest;
        const { headName } = account;
        const parentHeadName = get(account, 'parentHeadName');
        const heads = [headName, parentHeadName];

        // calculate cash flow from sales
        if (
          toLowerString(account.name).includes('sale') &&
          heads.includes(AccountType.Revenue)
        ) {
          cashFlowFromSales += balanceType === 'Cr' ? balance : -balance;
        }

        // calculate cash flow from purchases
        if (toLowerString(account.name).includes('purchase')) {
          cashFlowFromPurchases += balanceType === 'Dr' ? balance : -balance;
        }

        // calculate cash flow from expenses
        if (heads.includes(AccountType.Expense)) {
          cashFlowFromExpenses += balanceType === 'Dr' ? balance : -balance;
        }

        // calculate operating cash flow
        if (
          heads.includes('Current Asset') ||
          heads.includes('Current Liability')
        ) {
          const amount = balanceType === 'Dr' ? balance : -balance;

          if (heads.includes('Current Asset')) {
            operatingCashFlow += amount;
          } else {
            operatingCashFlow -= amount;
          }
        }

        // calculate investing cash flow
        if (heads.includes('Fixed Asset')) {
          investingCashFlow += balanceType === 'Dr' ? balance : -balance;
        }

        // calculate financing cash flow
        if (heads.includes(AccountType.Equity) || heads.includes('Loan')) {
          financingCashFlow += balanceType === 'Cr' ? balance : -balance;
        }
      }

      const netCashFlow =
        operatingCashFlow + investingCashFlow + financingCashFlow;

      if (!isMountedRef.current || generation !== fetchGenerationRef.current)
        return;

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
      if (isMountedRef.current && generation === fetchGenerationRef.current) {
        console.error('Error fetching cash flow:', error);
      }
    } finally {
      if (isMountedRef.current && generation === fetchGenerationRef.current) {
        setIsLoading(false);
      }
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
