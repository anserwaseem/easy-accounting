import { toNumber, trim } from 'lodash';
import type { InventoryItem } from 'types';
import {
  type PartyTypingContext,
  buildPartyTypingContext,
  getHeaderTypedSuffixFromCode,
} from '@/renderer/views/NewInvoice/lib/partyAccountTyping';
import {
  buildItemTypeNameById,
  buildInventoryById,
  resolveInventoryLineItemType,
} from '@/renderer/views/NewInvoice/lib/splitInvoiceRowResolution';
import { toLowerTrim } from '@/renderer/lib/utils';
import type { PartyAccount } from '../hooks/useNewInvoiceParties';

export type SplitOffMismatchKind =
  | 'base_account_non_primary_line'
  | 'typed_account_primary_line'
  | 'typed_account_wrong_suffix';

export interface SplitOffAccountItemMismatch {
  rowIndex: number;
  kind: SplitOffMismatchKind;
}

/**
 * sale + single account + split-by-type off: flags lines where the header party account's
 * typing (base vs suffixed) doesn't match that line's inventory item type.
 * uses account code only for typed vs base; names are not authoritative.
 */
export function detectSplitOffAccountItemTypeMismatches(
  rows: Array<{ inventoryId?: number }>,
  invById: Map<number, InventoryItem>,
  itemTypeNameById: Map<number, string>,
  headerAccount: PartyAccount | undefined,
  typingCtx: PartyTypingContext,
  primaryId: number | undefined,
): SplitOffAccountItemMismatch[] {
  const out: SplitOffAccountItemMismatch[] = [];
  if (!headerAccount) return out;

  const primaryNum =
    primaryId != null && Number.isFinite(toNumber(primaryId))
      ? toNumber(primaryId)
      : null;
  const hasPrimary = primaryNum != null;

  const { headerIsTyped, headerSuffix } = getHeaderTypedSuffixFromCode(
    headerAccount,
    typingCtx,
  );

  rows.forEach((row, rowIndex) => {
    const invId = toNumber(row.inventoryId);
    if (invId <= 0) return;

    const invItem = invById.get(invId);
    const { itemTypeId, itemTypeName } = resolveInventoryLineItemType(
      invItem,
      itemTypeNameById,
    );

    if (
      itemTypeId == null ||
      itemTypeId <= 0 ||
      itemTypeName == null ||
      trim(itemTypeName) === ''
    ) {
      return;
    }

    const lineIsPrimary = hasPrimary && itemTypeId === primaryNum;

    if (!headerIsTyped) {
      if (hasPrimary && !lineIsPrimary) {
        out.push({ rowIndex, kind: 'base_account_non_primary_line' });
      }
      return;
    }

    if (trim(headerSuffix) === '') {
      return;
    }

    if (hasPrimary && lineIsPrimary) {
      out.push({ rowIndex, kind: 'typed_account_primary_line' });
      return;
    }

    if (toLowerTrim(itemTypeName) !== toLowerTrim(headerSuffix)) {
      out.push({ rowIndex, kind: 'typed_account_wrong_suffix' });
    }
  });

  return out;
}

/** composes maps + ctx for callers that already have raw lists */
export function buildTypingAndDetectSplitOffMismatches(
  rows: Array<{ inventoryId?: number }>,
  inventory: InventoryItem[] | undefined,
  itemTypes: Array<{ id: number | string; name?: string }> | undefined,
  headerAccount: PartyAccount | undefined,
  allAccountsForCtx: Array<{ name?: string; code?: string | number | null }>,
  primaryId: number | undefined,
): SplitOffAccountItemMismatch[] {
  const itemTypeNameList = (itemTypes ?? [])
    .map((it) => trim(it.name ?? ''))
    .filter((n) => n.length > 0);
  const itemTypeNameById = buildItemTypeNameById(itemTypes);
  const invById = buildInventoryById(inventory);
  const typingCtx = buildPartyTypingContext(
    allAccountsForCtx,
    itemTypeNameList,
  );
  return detectSplitOffAccountItemTypeMismatches(
    rows,
    invById,
    itemTypeNameById,
    headerAccount,
    typingCtx,
    primaryId,
  );
}

function describeSplitOffMismatchKind(kind: SplitOffMismatchKind): string {
  switch (kind) {
    case 'base_account_non_primary_line':
      return 'non-primary item on a base (unsuffixed) account';
    case 'typed_account_primary_line':
      return 'primary-type item on a typed suffixed account';
    case 'typed_account_wrong_suffix':
      return 'item type does not match the account code suffix';
    default:
      return 'mismatch';
  }
}

/** user-facing toast body for split-off account vs item type mismatches */
export function formatSplitOffMismatchToast(
  mismatches: SplitOffAccountItemMismatch[],
): string {
  const maxLines = 4;
  const lines = mismatches
    .slice(0, maxLines)
    .map(
      (m) => `Line ${m.rowIndex + 1}: ${describeSplitOffMismatchKind(m.kind)}`,
    );
  const more =
    mismatches.length > maxLines
      ? ` (+${mismatches.length - maxLines} more)`
      : '';
  return (
    `With split ledger off, the customer account does not match some item types (${
      mismatches.length
    } line${mismatches.length === 1 ? '' : 's'}). ` +
    `${lines.join('; ')}${more}. ` +
    'Turn on "Split ledger by item type" or choose a customer account that matches those lines.'
  );
}
