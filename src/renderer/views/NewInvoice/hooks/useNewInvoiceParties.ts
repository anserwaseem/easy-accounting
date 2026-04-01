import { isNil, pick, trim } from 'lodash';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'renderer/shad/ui/use-toast';
import { toLowerTrim } from 'renderer/lib/utils';
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

const splitCode = (rawCode: string): { baseCode: string; suffix: string } => {
  const code = trim(rawCode);
  const lastDashIndex = code.lastIndexOf('-');
  if (lastDashIndex <= 0 || lastDashIndex >= code.length - 1) {
    return { baseCode: code, suffix: '' };
  }
  return {
    baseCode: code.slice(0, lastDashIndex),
    suffix: code.slice(lastDashIndex + 1),
  };
};

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
    const itemTypes = await window.electron.getItemTypes?.();
    const accounts = allAccounts.map((account) =>
      pick(account, [...PARTY_PICK]),
    );

    const allCodesLower = new Set(
      accounts.map((a) => toLowerTrim(a.code)).filter((c) => c.length > 0),
    );
    const itemTypeSuffixesLower = new Set(
      (itemTypes ?? [])
        .map((it) => toLowerTrim(it.name))
        .filter((n) => n.length > 0),
    );

    const saleAccount = accounts.find(
      (a) => toLowerTrim(a.name) === InvoiceType.Sale.toLowerCase(),
    );
    const purchaseAccount = accounts.find(
      (a) => toLowerTrim(a.name) === InvoiceType.Purchase.toLowerCase(),
    );
    const requiredPartyType =
      invoiceType === InvoiceType.Sale
        ? AccountType.Asset
        : AccountType.Liability;

    const isTypedPartyAccount = (account: PartyAccount): boolean => {
      const name = trim(String(account.name ?? ''));
      if (/-\S+$/.test(name)) return true;

      const { baseCode, suffix } = splitCode(String(account.code ?? ''));
      if (!suffix) return false;

      const suffixLower = suffix.toLowerCase();
      if (!itemTypeSuffixesLower.has(suffixLower)) return false;

      return allCodesLower.has(baseCode.toLowerCase());
    };

    const partyAccounts = accounts.filter(
      (a) => a.type === requiredPartyType && !isTypedPartyAccount(a),
    );
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
