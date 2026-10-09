/** discount that turns a full unit price into a net unit price, to 2 decimals. 0 when the net is not below the full price. */
export const discountPercentForNet = (
  fullPrice: number,
  netPrice: number,
): number => {
  if (!(fullPrice > 0) || !(netPrice >= 0) || netPrice >= fullPrice) return 0;
  return Number((((fullPrice - netPrice) / fullPrice) * 100).toFixed(2));
};

/** line amount. a net rate charges qty × netPrice, so a rounded discount percent cannot drift the rupees. */
export const lineHasNetPrice = (
  netPrice: number | null | undefined,
): netPrice is number => netPrice != null && Number.isFinite(netPrice);

export const invoiceLineAmount = (item: {
  quantity: number;
  discount: number;
  price?: number;
  netPrice?: number | null;
}): number => {
  if (lineHasNetPrice(item.netPrice)) {
    return item.quantity * item.netPrice;
  }
  return (
    item.quantity * (item.price ?? 0) * (1 - (Number(item.discount) || 0) / 100)
  );
};

export interface NetRateDisplayLine {
  price?: number | null;
  netPrice?: number | null;
  discount?: number | null;
}

/** unit shown in the price column. a net rate shows the typed amount, not the catalog price. */
export const chargedUnitPrice = (item: NetRateDisplayLine): number => {
  if (lineHasNetPrice(item.netPrice)) return item.netPrice;
  return Number(item.price) || 0;
};

/** catalog price and the percent that produced the net. null when there is nothing extra to show. */
export const netRateOffer = (
  item: NetRateDisplayLine,
): { fullPrice: number; discount: number } | null => {
  if (!lineHasNetPrice(item.netPrice)) return null;
  const fullPrice = Number(item.price);
  if (!Number.isFinite(fullPrice) || fullPrice === item.netPrice) return null;
  return { fullPrice, discount: Number(item.discount) || 0 };
};
