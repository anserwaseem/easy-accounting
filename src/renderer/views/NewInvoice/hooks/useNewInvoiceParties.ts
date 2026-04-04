import { isNil, pick, trim } from 'lodash';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'renderer/shad/ui/use-toast';
import { toLowerTrim } from 'renderer/lib/utils';
import {
  buildPartyTypingContext,
  isTypedPartyAccount,
} from '@/renderer/lib/partyAccountTyping';
import type { Account } from 'types';
import { AccountType, InvoiceType } from 'types';

const PARTY_PICK = [
  'id',
  'name',
  'type',
  'code',
  'chartId',
  'discountProfileId',
  'discountProfileIsActive',
] as const;

export type PartyAccount = Pick<Account, (typeof PARTY_PICK)[number]>;

export interface RequiredAccountsExist {
  sale: boolean;
  purchase: boolean;
  loading: boolean;
}

/** loads parties (customers/vendors) for the invoice type and checks that required sale/purchase accounts exist */
export function useNewInvoiceParties(invoiceType: InvoiceType): {
  parties: PartyAccount[] | undefined;
  partiesIncludingTyped: PartyAccount[] | undefined;
  setParties: React.Dispatch<React.SetStateAction<PartyAccount[] | undefined>>;
  setPartiesIncludingTyped: React.Dispatch<
    React.SetStateAction<PartyAccount[] | undefined>
  >;
  requiredAccountsExist: RequiredAccountsExist;
  setRequiredAccountsExist: React.Dispatch<
    React.SetStateAction<RequiredAccountsExist>
  >;
  isRefreshingParties: boolean;
  refreshParties: () => Promise<void>;
} {
  const [parties, setParties] = useState<PartyAccount[] | undefined>();
  const [partiesIncludingTyped, setPartiesIncludingTyped] = useState<
    PartyAccount[] | undefined
  >();
  const [requiredAccountsExist, setRequiredAccountsExist] =
    useState<RequiredAccountsExist>({
      sale: false,
      purchase: false,
      loading: false,
    });
  const [isRefreshingParties, setIsRefreshingParties] = useState(false);

  const fetchPartiesAndRequiredAccounts = useCallback(async () => {
    const allAccounts: Account[] = await window.electron.getAccounts();
    const itemTypes = await window.electron.getItemTypes?.();
    const accounts = allAccounts.map((account) =>
      pick(account, [...PARTY_PICK]),
    );

    const itemTypeNameList = (itemTypes ?? [])
      .map((it) => trim(it.name ?? ''))
      .filter((n) => n.length > 0);
    const typingCtx = buildPartyTypingContext(accounts, itemTypeNameList);

    const saleAccount = accounts.find(
      (a) => toLowerTrim(a.name) === InvoiceType.Sale.toLowerCase(),
    );
    const purchaseAccount = accounts.find(
      (a) => toLowerTrim(a.name) === InvoiceType.Purchase.toLowerCase(),
    );

    const isPartyAccountType = (a: PartyAccount): boolean => {
      if (invoiceType === InvoiceType.Sale) {
        return a.type === AccountType.Asset;
      }
      // purchase vendors may live under liability (creditors) or asset in some charts
      return a.type === AccountType.Liability || a.type === AccountType.Asset;
    };

    const partyAccountsAll = accounts.filter((a) => isPartyAccountType(a));
    const partyAccounts = partyAccountsAll.filter(
      (a) => !isTypedPartyAccount(a, typingCtx),
    );
    return {
      partyAccounts,
      partyAccountsIncludingTyped: partyAccountsAll,
      sale: !!saleAccount,
      purchase: !!purchaseAccount,
    };
  }, [invoiceType]);

  // refetch when invoice type changes so sale vs purchase party filters don't reuse the wrong list
  useEffect(() => {
    setParties(undefined);
    setPartiesIncludingTyped(undefined);
  }, [invoiceType]);

  useEffect(() => {
    if (isNil(parties)) {
      setRequiredAccountsExist({
        sale: false,
        purchase: false,
        loading: true,
      });
      fetchPartiesAndRequiredAccounts()
        .then(
          ({ partyAccounts, partyAccountsIncludingTyped, sale, purchase }) => {
            setRequiredAccountsExist({
              sale,
              purchase,
              loading: false,
            });
            setParties(partyAccounts);
            setPartiesIncludingTyped(partyAccountsIncludingTyped);
          },
        )
        .catch((error) => {
          console.error('Error fetching accounts:', error);
          setRequiredAccountsExist((prev) => ({ ...prev, loading: false }));
        });
    }
  }, [invoiceType, parties, fetchPartiesAndRequiredAccounts]);

  const refreshParties = useCallback(async () => {
    setIsRefreshingParties(true);
    try {
      const { partyAccounts, partyAccountsIncludingTyped, sale, purchase } =
        await fetchPartiesAndRequiredAccounts();
      setRequiredAccountsExist((prev) => ({
        ...prev,
        sale,
        purchase,
      }));
      setParties(partyAccounts);
      setPartiesIncludingTyped(partyAccountsIncludingTyped);
      toast({
        description: 'Accounts refreshed successfully',
        variant: 'success',
      });
    } catch (error) {
      toast({
        description: 'Failed to refresh accounts',
        variant: 'destructive',
      });
      console.error('Error refreshing accounts:', error);
    } finally {
      setIsRefreshingParties(false);
    }
  }, [fetchPartiesAndRequiredAccounts]);

  return {
    parties,
    partiesIncludingTyped,
    setParties,
    setPartiesIncludingTyped,
    requiredAccountsExist,
    setRequiredAccountsExist,
    isRefreshingParties,
    refreshParties,
  };
}
