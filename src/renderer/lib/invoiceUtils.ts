import { toNumber } from 'lodash';
import type { InvoiceItemView } from 'types';

const missingPartyLabel = '—';

/** "ABC-TT" -> "ABC" when TT matches a configured item type name (party display). */
export const stripItemTypeSuffixFromAccountName = (
  accountName: string | undefined | null,
  itemTypeNames: string[],
): string => {
  const name = accountName?.trim();
  if (!name) return missingPartyLabel;
  for (const typeName of itemTypeNames) {
    if (!typeName) continue;
    const suffix = `-${typeName.trim()}`;
    if (name.endsWith(suffix)) {
      return name.slice(0, name.length - suffix.length).trim();
    }
  }
  return name;
};

/** one bill-to label: per-line names if any (avoids splitting commas in legal names), else header string as a whole */
export const getPrintBillToPartyName = (
  headerAccountName: string | undefined | null,
  itemTypeNames: string[],
  invoiceItems?: ReadonlyArray<{ accountName?: string }>,
): string => {
  const lines = (invoiceItems ?? [])
    .map((row) => row.accountName?.trim())
    .filter((n): n is string => Boolean(n));

  let rawSegments: string[];
  if (lines.length > 0) {
    rawSegments = [...new Set(lines)];
  } else if (headerAccountName?.trim()) {
    rawSegments = [headerAccountName.trim()];
  } else {
    rawSegments = [];
  }

  const bases = rawSegments
    .map((s) => stripItemTypeSuffixFromAccountName(s, itemTypeNames))
    .filter((b) => b && b !== missingPartyLabel);

  if (bases.length === 0) return missingPartyLabel;

  const unique = [...new Set(bases)];
  if (unique.length === 1) return unique[0];

  unique.sort((a, b) => a.length - b.length);
  for (const c of unique) {
    if (bases.every((n) => n === c || n.startsWith(`${c}-`))) {
      return c;
    }
  }
  return bases[0];
};

interface GroupedInvoiceSection {
  sectionName: string;
  items: InvoiceItemView[];
}

export const computeInvoiceItemTotal = (
  quantity: number,
  discount: number,
  price?: number,
): number => quantity * (price ?? 0) * (1 - toNumber(discount) / 100);

export const getInvoiceItemDiscountedAmount = (
  item: InvoiceItemView,
): number => {
  const amount =
    item.discountedPrice ??
    toNumber(item.quantity) *
      toNumber(item.price) *
      (1 - toNumber(item.discount) / 100);
  return toNumber(amount);
};

export const computeSectionTotals = (
  items: InvoiceItemView[],
): { totalQuantity: number; totalAmount: number } => {
  const totalQuantity = items.reduce(
    (sum, item) => sum + toNumber(item.quantity),
    0,
  );
  const rawTotalAmount = items.reduce(
    (sum, item) => sum + getInvoiceItemDiscountedAmount(item),
    0,
  );
  // section total is rounded to nearest rupee before contributing to grand totals.
  return { totalQuantity, totalAmount: Math.round(toNumber(rawTotalAmount)) };
};

/** groups invoice items by itemTypeName, sorted with primary type first then alphabetically. */
export const groupInvoiceItemsByType = (
  items: InvoiceItemView[],
  primaryItemTypeName: string | null,
): GroupedInvoiceSection[] => {
  const grouped = new Map<string, InvoiceItemView[]>();
  items.forEach((item) => {
    const sectionName = item.itemTypeName?.trim() || 'No Type';
    const existingItems = grouped.get(sectionName) ?? [];
    grouped.set(sectionName, [...existingItems, item]);
  });
  const sections: GroupedInvoiceSection[] = Array.from(grouped.entries()).map(
    ([sectionName, sectionItems]) => ({ sectionName, items: sectionItems }),
  );
  sections.sort((a, b) => {
    const nameA = a.sectionName;
    const nameB = b.sectionName;
    if (primaryItemTypeName) {
      if (nameA === primaryItemTypeName && nameB !== primaryItemTypeName)
        return -1;
      if (nameB === primaryItemTypeName && nameA !== primaryItemTypeName)
        return 1;
    }
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  });
  return sections;
};

/** true when persisted row was modified after creation (list + details edited indicator). */
const isInvoiceEditedSnapshot = (inv: {
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
}): boolean => {
  const c = inv.createdAt;
  const u = inv.updatedAt;
  if (c == null || u == null) return false;
  const ct = new Date(c).getTime();
  const ut = new Date(u).getTime();
  return Number.isFinite(ct) && Number.isFinite(ut) && ut > ct;
};

/**
 * use for "Edited" / "Last edited" UI: returned invoices get updatedAt from the return action,
 * not from editing lines — hide edited affordances so "Returned" stays the single status signal.
 */
export const showInvoiceEditedIndicator = (inv: {
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  isReturned?: boolean;
}): boolean => {
  if (inv.isReturned) return false;
  return isInvoiceEditedSnapshot(inv);
};
