import { trim } from 'lodash';
import { toLowerTrim } from '@/renderer/lib/utils';
import { BalanceType } from 'types';
import {
  buildPartyTypingContext,
  findBasePartyRowForSingleAccountId,
  isTypedPartyAccount,
  splitPartyCode,
  splitPartyName,
  type PartyLikeForTyping,
} from './partyAccountTyping';

export type LedgerBalanceLike = {
  balance: number;
  balanceType: BalanceType;
};

/**
 * account ids for the selected party “family”: base row + all item-type
 * typed/suffixed variants (e.g. Acme, Acme-T, Acme-TT). isolated accounts
 * that are not typed return just themselves.
 */
export function getPartyFamilyAccountIds(
  selectedId: number,
  accounts: PartyLikeForTyping[],
  itemTypeNames: string[],
): number[] {
  if (!(selectedId > 0) || !accounts.length) {
    return selectedId > 0 ? [selectedId] : [];
  }

  const ctx = buildPartyTypingContext(accounts, itemTypeNames);
  const baseParties = accounts.filter((a) => !isTypedPartyAccount(a, ctx));
  const selected = accounts.find((a) => a.id === selectedId);

  const base =
    findBasePartyRowForSingleAccountId(
      selectedId,
      baseParties,
      accounts,
      ctx,
    ) ??
    (selected && !isTypedPartyAccount(selected, ctx) ? selected : undefined);

  if (!base) {
    return [selectedId];
  }

  const baseNameLower = trim(base.name ?? '').toLowerCase();
  const baseCodeLower = toLowerTrim(String(base.code ?? ''));

  const familyIds = accounts
    .filter((account) => {
      if (account.id === base.id) return true;
      if (!isTypedPartyAccount(account, ctx)) return false;

      const { baseName } = splitPartyName(account.name ?? '');
      if (baseName.toLowerCase() === baseNameLower) return true;

      if (baseCodeLower.length > 0) {
        const { baseCode } = splitPartyCode(String(account.code ?? ''));
        if (toLowerTrim(baseCode) === baseCodeLower) return true;
      }
      return false;
    })
    .map((account) => account.id);

  // always include the selection even if it was missing from `accounts`
  if (!familyIds.includes(selectedId)) {
    familyIds.push(selectedId);
  }

  return familyIds;
}

/** Dr-positive signed amount for combining AR/AP-style running balances */
export function ledgerBalanceToSignedDrPositive(
  balance: LedgerBalanceLike,
): number {
  const amount = Number(balance.balance) || 0;
  return balance.balanceType === BalanceType.Cr ? -amount : amount;
}

/**
 * nets many ledger balances into one Dr/Cr figure (Dr positive). empty map → null.
 */
export function sumLedgerBalances(
  balances: Record<number, LedgerBalanceLike | undefined | null>,
): LedgerBalanceLike | null {
  const values = Object.values(balances).filter(
    (b): b is LedgerBalanceLike => b != null && Number.isFinite(Number(b.balance)),
  );
  if (!values.length) return null;

  const signed = values.reduce(
    (acc, b) => acc + ledgerBalanceToSignedDrPositive(b),
    0,
  );
  if (signed === 0) {
    return { balance: 0, balanceType: BalanceType.Dr };
  }
  if (signed > 0) {
    return { balance: signed, balanceType: BalanceType.Dr };
  }
  return { balance: Math.abs(signed), balanceType: BalanceType.Cr };
}
