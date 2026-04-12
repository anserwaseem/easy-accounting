import { useState, useEffect, useCallback } from 'react';
import { get, includes, some, toLower } from 'lodash';
import { type Account, type InventoryItem, AccountType } from '@/types';
import type { FinancialOverview } from './types';

export const useFinancialOverview = () => {
  const [overview, setOverview] = useState<FinancialOverview>({
    totalAssets: 0,
    totalLiabilities: 0,
    netWorth: 0,
    currentRatio: 0,
    quickRatio: 0,
    currentAssets: 0,
    currentLiabilities: 0,
    inventory: 0,
    cashAndBank: 0,
    accountsReceivable: 0,
    accountsPayable: 0,
    lastUpdated: new Date(),
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchFinancialOverview = useCallback(async () => {
    setIsLoading(true);
    try {
      const accounts: Account[] = await window.electron.getAccounts();
      const accountIds = accounts.map((account: Account) => account.id);

      const balanceByAccountId =
        await window.electron.getLedgerBalancesForAccountIds(accountIds);

      // calculate totals by account type
      let totalAssets = 0;
      let totalLiabilities = 0;
      let currentAssets = 0;
      let currentLiabilities = 0;
      let cashAndBank = 0;
      let accountsReceivable = 0;
      let accountsPayable = 0;

      for (const account of accounts) {
        const latest = balanceByAccountId[account.id];
        if (!latest) continue;

        const { balance, balanceType } = latest;
        const amount = balanceType === 'Dr' ? balance : -balance;

        const { headName } = account;
        const parentHeadName = get(account, 'parentHeadName');
        const heads = [headName, parentHeadName];

        switch (account.type) {
          case AccountType.Asset:
            totalAssets += amount;
            if (heads.includes('Current Asset')) {
              currentAssets += amount;
              const isCashOrBank = some(['cash', 'bank'], (term) =>
                some(['name', 'code', 'headName'], (key) =>
                  includes(toLower(get(account, key, '')), term),
                ),
              );

              if (isCashOrBank) {
                cashAndBank += amount;
              }
              // if customer
              else if (
                account.name.toLowerCase().includes('customer') ||
                account.name.toLowerCase().includes('receivable') ||
                account.address ||
                account.phone1 ||
                account.phone2 ||
                account.goodsName
              ) {
                accountsReceivable += amount;
              }
            }
            break;
          case AccountType.Liability:
            totalLiabilities += amount;
            if (heads.includes('Current Liability')) {
              currentLiabilities += amount;
              if (account.name.toLowerCase().includes('payable')) {
                accountsPayable += amount;
              }
            }
            break;
          default:
            break;
        }
      }

      // fetch actual inventory data
      const inventoryItems = await window.electron.getInventory();
      const inventory = inventoryItems.reduce(
        (total: number, item: InventoryItem) => {
          return total + item.quantity * item.price;
        },
        0,
      );

      // update current assets with actual inventory value
      currentAssets += inventory;

      // calculate ratios
      const currentRatio =
        currentLiabilities !== 0 ? currentAssets / currentLiabilities : 0;
      const quickRatio =
        currentLiabilities !== 0
          ? (currentAssets - inventory) / currentLiabilities
          : 0;

      setOverview({
        totalAssets,
        totalLiabilities: Math.abs(totalLiabilities),
        netWorth: totalAssets - totalLiabilities,
        currentRatio,
        quickRatio,
        currentAssets,
        currentLiabilities,
        inventory,
        cashAndBank,
        accountsReceivable,
        accountsPayable: Math.abs(accountsPayable),
        lastUpdated: new Date(),
      });
    } catch (error) {
      console.error('Error fetching financial overview:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFinancialOverview();
  }, [fetchFinancialOverview]);

  return {
    overview,
    isLoading,
    refetch: fetchFinancialOverview,
  };
};
