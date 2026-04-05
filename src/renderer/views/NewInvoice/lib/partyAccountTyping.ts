import { trim } from 'lodash';
import { toLowerTrim } from '@/renderer/lib/utils';

export interface PartyTypingContext {
  itemTypeSuffixesLower: Set<string>;
  allCodesLower: Set<string>;
  allNamesLower: Set<string>;
}

export interface PartyLikeForTyping {
  id: number;
  name: string;
  code?: string | number | null;
  chartId?: number | null;
  /** not used by typing helpers; widened so PartyAccount assigns */
  type?: unknown;
}

export const splitPartyCode = (
  rawCode: string,
): { baseCode: string; suffix: string } => {
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

export const splitPartyName = (
  rawName: string,
): { baseName: string; suffix: string } => {
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

/** builds suffix sets used to detect item-type suffixed party rows (name or code) */
export function buildPartyTypingContext(
  accounts: Array<{ name?: string; code?: string | number | null }>,
  itemTypeNames: string[],
): PartyTypingContext {
  const allCodesLower = new Set<string>(
    accounts
      .map((a) => toLowerTrim(String(a.code ?? '')))
      .filter((c) => c.length > 0),
  );
  const allNamesLower = new Set<string>(
    accounts.map((a) => toLowerTrim(a.name ?? '')).filter((n) => n.length > 0),
  );
  const itemTypeSuffixesLower = new Set<string>(
    itemTypeNames.map((n) => toLowerTrim(n)).filter((n) => n.length > 0),
  );
  return { itemTypeSuffixesLower, allCodesLower, allNamesLower };
}

/** true when this row is a typed/suffixed variant of another party (same rules as invoice party list filter) */
export function isTypedPartyAccount(
  account: { name: string; code?: string | number | null },
  ctx: PartyTypingContext,
): boolean {
  const { baseName, suffix: nameSuffix } = splitPartyName(account.name ?? '');
  if (nameSuffix) {
    const suffixLower = nameSuffix.toLowerCase();
    if (
      ctx.itemTypeSuffixesLower.has(suffixLower) &&
      ctx.allNamesLower.has(baseName.toLowerCase())
    ) {
      return true;
    }
  }

  const { baseCode, suffix } = splitPartyCode(String(account.code ?? ''));
  if (!suffix) return false;

  const suffixLower = suffix.toLowerCase();
  if (!ctx.itemTypeSuffixesLower.has(suffixLower)) return false;

  return ctx.allCodesLower.has(baseCode.toLowerCase());
}

/** maps a header account id to the base party row used for split-by-type resolution (name/code lookups) */
export function findBasePartyRowForSingleAccountId<
  T extends PartyLikeForTyping,
>(
  singleId: number,
  baseParties: T[],
  allAccounts: T[],
  ctx: PartyTypingContext,
): T | undefined {
  const direct = baseParties.find((p) => p.id === singleId);
  if (direct) return direct;

  const acc = allAccounts.find((a) => a.id === singleId);
  if (!acc || !isTypedPartyAccount(acc, ctx)) return undefined;

  const { baseName } = splitPartyName(acc.name ?? '');
  const { baseCode } = splitPartyCode(String(acc.code ?? ''));
  const baseNameLower = baseName.toLowerCase();
  const baseCodeLower = baseCode.toLowerCase();

  const byName = baseParties.find(
    (p) => trim(p.name ?? '').toLowerCase() === baseNameLower,
  );
  if (byName) return byName;

  if (baseCodeLower.length > 0) {
    return baseParties.find(
      (p) => toLowerTrim(String(p.code ?? '')) === baseCodeLower,
    );
  }

  return undefined;
}

/**
 * party row used for suffixed account resolution: base customer when header is base id,
 * or matched base row when header is a typed id; synthetic base fields when typed but no base row.
 */
export function resolvePartyRowForSplitByType<T extends PartyLikeForTyping>(
  singleId: number,
  baseParties: T[],
  allAccounts: T[],
  ctx: PartyTypingContext,
): T | undefined {
  const direct = baseParties.find((p) => p.id === singleId);
  if (direct?.chartId) return direct;

  const acc = allAccounts.find((a) => a.id === singleId);
  const base = findBasePartyRowForSingleAccountId(
    singleId,
    baseParties,
    allAccounts,
    ctx,
  );
  if (base?.chartId) return base;

  if (
    acc?.chartId != null &&
    acc.chartId > 0 &&
    isTypedPartyAccount(acc, ctx)
  ) {
    const { baseName } = splitPartyName(acc.name ?? '');
    const { baseCode } = splitPartyCode(String(acc.code ?? ''));
    return {
      ...acc,
      name: baseName,
      code: baseCode || acc.code,
    };
  }

  if (acc?.chartId != null && acc.chartId > 0) {
    return acc;
  }

  return direct;
}
