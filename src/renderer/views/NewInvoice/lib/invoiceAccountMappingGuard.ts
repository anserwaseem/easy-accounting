import { toNumber } from 'lodash';

/**
 * warn before collapsing per-row ledger resolution: unchecking split-by-type, or unchecking
 * "one customer" while split-by-type is on (same underlying mismatch rules).
 */
export function shouldWarnWhenTurningSplitLedgerOff(
  singleAccountId: unknown,
  multipleAccountIds: unknown,
): boolean {
  const singleId = toNumber(singleAccountId);
  const raw = Array.isArray(multipleAccountIds) ? multipleAccountIds : [];
  const ids = raw.filter(
    (id): id is number => typeof id === 'number' && id > 0,
  );
  if (new Set(ids).size >= 2) return true;
  return ids.some((id) => id !== singleId);
}

export interface SectionLike {
  id: string;
  accountId?: number;
}

/** when turning multi-customer mode off, restore header customer from the active section (or first) */
export function restoreSingleAccountIdFromSections(
  sections: SectionLike[],
  activeSectionId: string | null,
): number | undefined {
  const sid =
    sections.find((s) => s.id === activeSectionId)?.accountId ??
    sections[0]?.accountId;
  return typeof sid === 'number' && sid > 0 ? sid : undefined;
}
