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

const splitName = (rawName: string): { baseName: string; suffix: string } => {
  const name = trim(rawName);
  const lastDashIndex = name.lastIndexOf('-');
  if (lastDashIndex <= 0 || lastDashIndex >= name.length - 1) {
    return { baseName: name, suffix: '' };
  }
  return {
    baseName: trim(name.slice(0, lastDashIndex)),
    suffix: trim(name.slice(lastDashIndex + 1)),
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
    const allNamesLower = new Set<string>(
      accounts.map((a) => toLowerTrim(a.name)).filter((n) => n.length > 0),
    );
    const itemTypeSuffixesLower = new Set<string>(
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

    const isPartyAccountType = (a: PartyAccount): boolean => {
      if (invoiceType === InvoiceType.Sale) {
        return a.type === AccountType.Asset;
      }
      // purchase vendors may live under liability (creditors) or asset in some charts
      return a.type === AccountType.Liability || a.type === AccountType.Asset;
    };

    const isTypedPartyAccount = (account: PartyAccount): boolean => {
      const { baseName, suffix: nameSuffix } = splitName(account.name);
      if (nameSuffix) {
        const suffixLower = nameSuffix.toLowerCase();
        if (
          itemTypeSuffixesLower.has(suffixLower) &&
          allNamesLower.has(baseName.toLowerCase())
        ) {
          return true;
        }
      }

      const { baseCode, suffix } = splitCode(String(account.code ?? ''));
      if (!suffix) return false;

      const suffixLower = suffix.toLowerCase();
      if (!itemTypeSuffixesLower.has(suffixLower)) return false;

      return allCodesLower.has(baseCode.toLowerCase());
    };

    const partyAccounts = accounts.filter(
      (a) => isPartyAccountType(a) && !isTypedPartyAccount(a),
    );
    return {
      partyAccounts,
      sale: !!saleAccount,
      purchase: !!purchaseAccount,
    };
  }, [invoiceType]);

  // refetch when invoice type changes so sale vs purchase party filters don't reuse the wrong list
  useEffect(() => {
    setParties(undefined);
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
