import { toNumber } from 'lodash';
import { useEffect, useState } from 'react';
import { cn, getFormattedCurrency } from 'renderer/lib/utils';
import { BalanceType } from 'types';

/** Dr balances at or above this are highlighted red (large outstanding receivable) */
export const LARGE_DR_BALANCE_THRESHOLD = 50_000;

interface PartyBalanceIndicatorProps {
  /** selected party account id; nothing renders until a valid id is set */
  accountId?: number;
}

type LedgerBalance = { balance: number; balanceType: BalanceType };

/**
 * compact outstanding-balance hint under the party select on New Invoice.
 * pulls the account's latest running ledger balance via the existing
 * ledger:getBalance IPC (same figure as the last row on the ledger screen).
 */
export const PartyBalanceIndicator: React.FC<PartyBalanceIndicatorProps> = ({
  accountId,
}: PartyBalanceIndicatorProps) => {
  // undefined = idle/loading (render nothing), null = no ledger history
  const [ledgerBalance, setLedgerBalance] = useState<
    LedgerBalance | null | undefined
  >(undefined);

  // fetch the latest balance whenever the selected account changes
  useEffect(() => {
    const id = toNumber(accountId);
    if (!(id > 0)) {
      setLedgerBalance(undefined);
      return undefined;
    }
    let cancelled = false;
    setLedgerBalance(undefined);
    // optional call: keeps older test harnesses without this IPC mock from crashing
    Promise.resolve(window.electron.getLedgerBalance?.(id))
      .then((res) => {
        if (!cancelled) setLedgerBalance(res ?? null);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setLedgerBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

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
    >
      Balance: {getFormattedCurrency(ledgerBalance.balance)}{' '}
      {ledgerBalance.balanceType}
    </p>
  );
};
