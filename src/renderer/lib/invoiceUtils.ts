import { toNumber } from 'lodash';
import type { InvoiceItemView } from 'types';

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
