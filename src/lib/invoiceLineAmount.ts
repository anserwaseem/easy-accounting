/** discount that turns a full unit price into a net unit price, to 2 decimals. 0 when the net is not below the full price. */
export const discountPercentForNet = (
  fullPrice: number,
  netPrice: number,
): number => {
  if (!(fullPrice > 0) || !(netPrice >= 0) || netPrice >= fullPrice) return 0;
  return Number((((fullPrice - netPrice) / fullPrice) * 100).toFixed(2));
};

/** line amount. a net rate charges qty × net, so a rounded discount percent cannot drift the rupees. */
export const invoiceLineAmount = (item: {
  quantity: number;
  discount: number;
  price?: number;
  isNetRate?: boolean;
  netPrice?: number | null;
}): number => {
  if (
    item.isNetRate &&
    item.netPrice != null &&
    Number.isFinite(item.netPrice)
  ) {
    return item.quantity * item.netPrice;
  }
  return (
    item.quantity * (item.price ?? 0) * (1 - (Number(item.discount) || 0) / 100)
  );
};
