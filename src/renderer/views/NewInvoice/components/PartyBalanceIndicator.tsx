import { toNumber } from 'lodash';
import { useEffect, useState } from 'react';
import { cn, getFormattedCurrency } from 'renderer/lib/utils';
import { BalanceType } from 'types';
import type { PartyLikeForTyping } from '../lib/partyAccountTyping';
import {
  getPartyFamilyAccountIds,
  sumLedgerBalances,
  type LedgerBalanceLike,
} from '../lib/partyFamilyBalance';

/** Dr balances at or above this are highlighted red (large outstanding receivable) */
export const LARGE_DR_BALANCE_THRESHOLD = 50_000;

interface PartyBalanceIndicatorProps {
  /** selected party account id; nothing renders until a valid id is set */
  accountId?: number;
  /**
   * base + typed party rows for this invoice type (e.g. partiesIncludingTyped).
   * when provided, balance is the Dr-positive sum across the selected party family.
   */
  partyAccounts?: PartyLikeForTyping[];
  /** bump to force a ledger re-fetch without changing accountId (refresh btn) */
  refreshKey?: number;
}

/**
 * compact outstanding-balance hint under the party select on New Invoice.
 * sums latest running ledger balances for the selected party and its item-type
 * typed/suffixed accounts (Acme + Acme-T + Acme-TT), Dr-positive net.
 */
export const PartyBalanceIndicator: React.FC<PartyBalanceIndicatorProps> = ({
  accountId,
  partyAccounts,
  refreshKey = 0,
}: PartyBalanceIndicatorProps) => {
  // undefined = idle/loading (render nothing), null = no ledger history
  const [ledgerBalance, setLedgerBalance] = useState<
    LedgerBalanceLike | null | undefined
  >(undefined);
  const [familySize, setFamilySize] = useState(1);

  // fetch (and optionally sum) balances whenever selection, family list, or refresh key changes
  useEffect(() => {
    const id = toNumber(accountId);
    if (!(id > 0)) {
      setLedgerBalance(undefined);
      setFamilySize(1);
      return undefined;
    }
    let cancelled = false;
    setLedgerBalance(undefined);

    (async () => {
      try {
        const itemTypes = (await window.electron.getItemTypes?.()) ?? [];
        const itemTypeNames = itemTypes
          .map((it) => (typeof it?.name === 'string' ? it.name : ''))
          .filter((n) => n.length > 0);

        const familyIds = getPartyFamilyAccountIds(
          id,
          partyAccounts ?? [],
          itemTypeNames,
        );
        if (cancelled) return;
        setFamilySize(familyIds.length);

        if (familyIds.length <= 1) {
          const res = await window.electron.getLedgerBalance?.(familyIds[0] ?? id);
          if (!cancelled) setLedgerBalance(res ?? null);
          return;
        }

        const map =
          (await window.electron.getLedgerBalancesForAccountIds?.(familyIds)) ??
          {};
        if (cancelled) return;
        setLedgerBalance(sumLedgerBalances(map));
      } catch {
        if (!cancelled) setLedgerBalance(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, partyAccounts, refreshKey]);

  if (!(toNumber(accountId) > 0) || ledgerBalance === undefined) return null;

  if (ledgerBalance === null || toNumber(ledgerBalance.balance) === 0) {
    return <p className="text-xs text-muted-foreground">No balance</p>;
  }

  const isLargeDr =
    ledgerBalance.balanceType === BalanceType.Dr &&
    toNumber(ledgerBalance.balance) >= LARGE_DR_BALANCE_THRESHOLD;

  return (
    <p
      className={cn(
        'text-xs tabular-nums',
        isLargeDr ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
      )}
      title={
        familySize > 1
          ? `Combined balance across ${familySize} related accounts`
          : undefined
      }
    >
      Balance{familySize > 1 ? ' (all)' : ''}:{' '}
      {getFormattedCurrency(ledgerBalance.balance)} {ledgerBalance.balanceType}
    </p>
  );
};
