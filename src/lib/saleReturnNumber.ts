/**
 * sale returns are `invoiceType = 'Sale'` so they share the table unique
 * key `(invoiceNumber, invoiceType)` with sales and quotations.
 * quotations already occupy small negatives. returns are stored below
 * `-SALE_RETURN_NUMBER_BASE` and shown as 1, 2, 3.
 */
export const SALE_RETURN_NUMBER_BASE = 1_000_000;

export const toStoredSaleReturnNumber = (displayNumber: number): number =>
  -(SALE_RETURN_NUMBER_BASE + displayNumber);

export const toDisplaySaleReturnNumber = (storedNumber: number): number =>
  -storedNumber - SALE_RETURN_NUMBER_BASE;

/** sql expression. `storedExpr` is the raw invoices.invoiceNumber column. */
export const saleReturnDisplayNumberSql = (storedExpr: string): string =>
  `CASE WHEN COALESCE(isSaleReturn, 0) = 1 THEN (-${storedExpr} - ${SALE_RETURN_NUMBER_BASE}) ELSE ${storedExpr} END`;
