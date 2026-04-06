import { toNumber, trim } from 'lodash';
import type { InventoryItem } from 'types';
import { toLowerTrim } from '@/renderer/lib/utils';
import type { PartyAccount } from '../hooks/useNewInvoiceParties';

/** how a single invoice line maps to an account when split-by-item-type is on */
export type SplitRowResolutionKind =
  | { kind: 'header' }
  | { kind: 'base' }
  | { kind: 'suffixed'; suffixedName: string };

export function buildItemTypeNameById(
  itemTypes: Array<{ id: number | string; name?: string }> | undefined,
): Map<number, string> {
  const map = new Map<number, string>();
  (itemTypes ?? []).forEach((it) => {
    const id = toNumber(it.id);
    if (id > 0) {
      map.set(id, trim(it.name ?? ''));
    }
  });
  return map;
}

/** inventory id -> row for O(1) lookups during resolution */
export function buildInventoryById(
  inventory: InventoryItem[] | undefined,
): Map<number, InventoryItem> {
  const map = new Map<number, InventoryItem>();
  (inventory ?? []).forEach((row) => {
    map.set(toNumber(row.id), row);
  });
  return map;
}

export function resolveInventoryLineItemType(
  invItem: InventoryItem | undefined,
  itemTypeNameById: Map<number, string>,
): { itemTypeId: number | null; itemTypeName: string | null } {
  const rawTypeId = invItem?.itemTypeId;
  const itemTypeIdNum = rawTypeId != null ? toNumber(rawTypeId) : Number.NaN;
  const itemTypeId =
    Number.isFinite(itemTypeIdNum) && itemTypeIdNum > 0 ? itemTypeIdNum : null;

  const nameFromInv = trim(invItem?.itemTypeName ?? '');
  const nameFromCatalog =
    itemTypeId != null && itemTypeId > 0
      ? trim(itemTypeNameById.get(itemTypeId) ?? '')
      : '';
  const label = nameFromInv || nameFromCatalog;
  const itemTypeName = label.length > 0 ? label : null;

  return { itemTypeId, itemTypeName };
}

export function findBasePartyRowInPicked(
  picked: PartyAccount[],
  partyName: string,
  partyCode: string,
): PartyAccount | undefined {
  return picked.find(
    (a) =>
      toLowerTrim(a.name ?? '') === toLowerTrim(partyName) &&
      toLowerTrim(String(a.code ?? '')) === toLowerTrim(partyCode),
  );
}

export interface ClassifySplitRowInput {
  partyName: string;
  itemTypeId: number | null;
  itemTypeName: string | null;
  primaryId: number | undefined;
  primaryNum: number;
  headerIsTyped: boolean;
  headerSuffix: string;
}

/** pure: maps one line's item type + header context to resolution kind */
export function classifySplitRowResolution(
  input: ClassifySplitRowInput,
): SplitRowResolutionKind {
  const {
    partyName,
    itemTypeId,
    itemTypeName,
    primaryId,
    primaryNum,
    headerIsTyped,
    headerSuffix,
  } = input;

  if (itemTypeId == null || itemTypeId <= 0 || itemTypeName == null) {
    return { kind: 'header' };
  }

  const primaryEligible =
    primaryId != null &&
    Number.isFinite(primaryNum) &&
    itemTypeId === primaryNum;

  const headerSuffixMatchesLine =
    headerSuffix.length > 0 &&
    toLowerTrim(itemTypeName) === toLowerTrim(headerSuffix);

  if (primaryEligible && headerIsTyped && !headerSuffixMatchesLine) {
    return { kind: 'base' };
  }

  const routeThroughHeader =
    (primaryEligible && (!headerIsTyped || headerSuffixMatchesLine)) ||
    (!primaryEligible && headerIsTyped && headerSuffixMatchesLine);

  if (routeThroughHeader) {
    return { kind: 'header' };
  }

  return { kind: 'suffixed', suffixedName: `${partyName}-${itemTypeName}` };
}

export function buildSplitRowPlans(
  rows: Array<{ inventoryId?: number }>,
  invById: Map<number, InventoryItem>,
  itemTypeNameById: Map<number, string>,
  partyName: string,
  primaryId: number | undefined,
  primaryNum: number,
  headerIsTyped: boolean,
  headerSuffix: string,
): SplitRowResolutionKind[] {
  return rows.map((row) => {
    const invItem = invById.get(toNumber(row.inventoryId));
    const { itemTypeId, itemTypeName } = resolveInventoryLineItemType(
      invItem,
      itemTypeNameById,
    );
    return classifySplitRowResolution({
      partyName,
      itemTypeId,
      itemTypeName,
      primaryId,
      primaryNum,
      headerIsTyped,
      headerSuffix,
    });
  });
}
