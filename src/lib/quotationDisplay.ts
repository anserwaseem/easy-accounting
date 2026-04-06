import { toNumber } from 'lodash';

/** persisted quotations use negative placeholder invoice numbers; show abs as the human-facing ref */
export const getQuotationDisplayNumber = (invoiceNumber: number): number => {
  const n = toNumber(invoiceNumber);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return Math.abs(n);
  return n;
};
