import { isNil, pick, trim } from 'lodash';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'renderer/shad/ui/use-toast';
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
  setParties: React.Dispatch<React.SetStateAction<PartyAccount[] | undefined>>;
  requiredAccountsExist: RequiredAccountsExist;
  setRequiredAccountsExist: React.Dispatch<
    React.SetStateAction<RequiredAccountsExist>
  >;
  isRefreshingParties: boolean;
  refreshParties: () => Promise<void>;
} {
  const [parties, setParties] = useState<PartyAccount[] | undefined>();
  const [requiredAccountsExist, setRequiredAccountsExist] =
    useState<RequiredAccountsExist>({
      sale: false,
      purchase: false,
      loading: false,
    });
  const [isRefreshingParties, setIsRefreshingParties] = useState(false);

  const fetchPartiesAndRequiredAccounts = useCallback(async () => {
    const allAccounts: Account[] = await window.electron.getAccounts();
    const accounts = allAccounts.map((account) =>
      pick(account, [...PARTY_PICK]),
    );
    const saleAccount = accounts.find(
      (account) =>
        trim(account.name).toLowerCase() === InvoiceType.Sale.toLowerCase(),
    );
    const purchaseAccount = accounts.find(
      (account) =>
        trim(account.name).toLowerCase() === InvoiceType.Purchase.toLowerCase(),
    );
    const partyAccounts = accounts.filter(
      (account) =>
        account.type ===
          (invoiceType === InvoiceType.Sale
            ? AccountType.Asset
            : AccountType.Liability) && !/-\S+$/.test(trim(account.name ?? '')),
    ) as PartyAccount[];
    return {
      partyAccounts,
      sale: !!saleAccount,
      purchase: !!purchaseAccount,
    };
  }, [invoiceType]);

  useEffect(() => {
    if (isNil(parties)) {
      setRequiredAccountsExist({
        sale: false,
        purchase: false,
        loading: true,
      });
      fetchPartiesAndRequiredAccounts()
        .then(({ partyAccounts, sale, purchase }) => {
          setRequiredAccountsExist({
            sale,
            purchase,
            loading: false,
          });
          setParties(partyAccounts);
        })
        .catch((error) => {
          console.error('Error fetching accounts:', error);
          setRequiredAccountsExist((prev) => ({ ...prev, loading: false }));
        });
    }
  }, [invoiceType, parties, fetchPartiesAndRequiredAccounts]);

  const refreshParties = useCallback(async () => {
    setIsRefreshingParties(true);
    try {
      const { partyAccounts, sale, purchase } =
        await fetchPartiesAndRequiredAccounts();
      setRequiredAccountsExist((prev) => ({
        ...prev,
        sale,
        purchase,
      }));
      setParties(partyAccounts);
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
    setParties,
    requiredAccountsExist,
    setRequiredAccountsExist,
    isRefreshingParties,
    refreshParties,
  };
}
