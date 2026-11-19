import {
  buildPartyTypingContext,
  isTypedPartyAccount,
  splitPartyCode,
  type PartyTypingContext,
} from '@/renderer/views/NewInvoice/lib/partyAccountTyping';
import { toLowerTrim } from '@/renderer/lib/utils';

export type AccountLikeForFamilySort = {
  name?: string;
  code?: string | number | null;
};

export const compareAccountCode = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** base code for family grouping; typed tiers collapse to their parent code */
export function getAccountFamilyBaseCode(
  account: AccountLikeForFamilySort,
  ctx: PartyTypingContext,
): string {
  const raw = String(account.code ?? '').trim();
  if (!raw) return '';
  const asParty = { name: account.name ?? '', code: account.code };
  if (isTypedPartyAccount(asParty, ctx)) {
    return splitPartyCode(raw).baseCode;
  }
  return raw;
}

export function compareAccountFamilyOrder(
  a: AccountLikeForFamilySort,
  b: AccountLikeForFamilySort,
  ctx: PartyTypingContext,
): number {
  const familyDiff = compareAccountCode(
    getAccountFamilyBaseCode(a, ctx),
    getAccountFamilyBaseCode(b, ctx),
  );
  if (familyDiff !== 0) return familyDiff;

  const typedA = isTypedPartyAccount({ name: a.name ?? '', code: a.code }, ctx);
  const typedB = isTypedPartyAccount({ name: b.name ?? '', code: b.code }, ctx);
  // base row before typed siblings
  if (typedA !== typedB) return typedA ? 1 : -1;

  return compareAccountCode(
    String(a.code ?? '').trim(),
    String(b.code ?? '').trim(),
  );
}

/**
 * sort accounts so base + item-type tiers stay contiguous
 * (e.g. MRD-A, MRD-A-T, MRD-A-TT). empty itemTypeNames → plain code sort.
 */
export function clusterAccountsByFamily<T extends AccountLikeForFamilySort>(
  accounts: readonly T[],
  itemTypeNames: string[],
): T[] {
  if (accounts.length < 2) return [...accounts];
  const mutable = [...accounts];
  const ctx = buildPartyTypingContext(mutable, itemTypeNames);
  return mutable.sort((a, b) => compareAccountFamilyOrder(a, b, ctx));
}

export type FamilyMetricCompareMode = 'max' | 'min' | 'sum';

const familyMetricScore = (
  metrics: number[],
  mode: FamilyMetricCompareMode,
): number => {
  if (metrics.length === 0) return 0;
  if (mode === 'min') return Math.min(...metrics);
  if (mode === 'sum') return metrics.reduce((sum, value) => sum + value, 0);
  return Math.max(...metrics);
};

/**
 * keep each account family as one contiguous block while ordering families by
 * a numeric metric (e.g. outstanding). within a family: base then tiers.
 */
export function sortAccountsKeepingFamiliesTogether<
  T extends AccountLikeForFamilySort,
>(
  accounts: readonly T[],
  itemTypeNames: string[],
  getMetric: (account: T) => number,
  options?: {
    /** how to derive the family sort key from member metrics */
    familyMetric?: FamilyMetricCompareMode;
    direction?: 'asc' | 'desc';
  },
): T[] {
  if (accounts.length < 2) return [...accounts];

  const familyMetric = options?.familyMetric ?? 'max';
  const direction = options?.direction ?? 'desc';
  const mutable = [...accounts];
  const ctx = buildPartyTypingContext(mutable, itemTypeNames);

  return sortFamilyGroups(
    mutable,
    ctx,
    (members) =>
      familyMetricScore(
        members.map((member) => getMetric(member)),
        familyMetric,
      ),
    (scoreA, scoreB) =>
      scoreA === scoreB
        ? 0
        : direction === 'desc'
        ? scoreB - scoreA
        : scoreA - scoreB,
  );
}

/**
 * keep families contiguous; order families by a string label (e.g. base name).
 */
export function sortAccountFamiliesByLabel<T extends AccountLikeForFamilySort>(
  accounts: readonly T[],
  itemTypeNames: string[],
  getFamilyLabel: (members: T[]) => string,
  direction: 'asc' | 'desc' = 'asc',
): T[] {
  if (accounts.length < 2) return [...accounts];
  const mutable = [...accounts];
  const ctx = buildPartyTypingContext(mutable, itemTypeNames);

  return sortFamilyGroups(mutable, ctx, getFamilyLabel, (labelA, labelB) => {
    const diff = labelA.localeCompare(labelB, undefined, {
      sensitivity: 'base',
    });
    return direction === 'desc' ? -diff : diff;
  });
}

function sortFamilyGroups<T extends AccountLikeForFamilySort, TKey>(
  accounts: readonly T[],
  ctx: PartyTypingContext,
  getFamilyKey: (members: T[]) => TKey,
  compareKeys: (a: TKey, b: TKey) => number,
): T[] {
  const groups = new Map<string, T[]>();
  accounts.forEach((account, index) => {
    const base = getAccountFamilyBaseCode(account, ctx);
    const key = toLowerTrim(base) || `__singleton_${index}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(account);
    } else {
      groups.set(key, [account]);
    }
  });

  const familyRows = Array.from(groups.entries()).map(([groupKey, members]) => {
    const orderedMembers = [...members].sort((a, b) =>
      compareAccountFamilyOrder(a, b, ctx),
    );
    return {
      groupKey,
      sortKey: getFamilyKey(orderedMembers),
      members: orderedMembers,
    };
  });

  familyRows.sort((a, b) => {
    const keyDiff = compareKeys(a.sortKey, b.sortKey);
    if (keyDiff !== 0) return keyDiff;
    return compareAccountCode(a.groupKey, b.groupKey);
  });

  return familyRows.flatMap((row) => row.members);
}

/** true when the option list looks like accounts (has at least one code) */
export function optionsLookLikeAccounts(
  options: ReadonlyArray<{ code?: string | number | null }>,
): boolean {
  return options.some(
    (opt) => opt.code != null && String(opt.code).trim().length > 0,
  );
}
