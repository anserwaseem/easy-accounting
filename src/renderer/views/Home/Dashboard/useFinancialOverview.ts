import { useState, useEffect, useCallback } from 'react';
import { get, includes, isEmpty, some, toLower } from 'lodash';
import {
  type Account,
  type LedgerView,
  type InventoryItem,
  AccountType,
} from '@/types';
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

      // calculate totals by account type
      let totalAssets = 0;
      let totalLiabilities = 0;
      let currentAssets = 0;
      let currentLiabilities = 0;
      let cashAndBank = 0;
      let accountsReceivable = 0;
      let accountsPayable = 0;

      for (const account of accounts) {
        const ledger = accountLedgers[account.id];
        if (isEmpty(ledger)) continue;

        const latestEntry = ledger[ledger.length - 1];
        const { balance, balanceType } = latestEntry;
        const amount = balanceType === 'Dr' ? balance : -balance;

        const { headName } = account;
        const parentHeadName = get(account, 'parentHeadName');
        const heads = [headName, parentHeadName];

        switch (account.type) {
          case AccountType.Asset:
            totalAssets += amount;
            console.log('totalAssets account', account);
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
