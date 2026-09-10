import { format, isValid } from 'date-fns';
import { InvoiceType } from 'types';
import {
  ledgerBalanceToSignedDrPositive,
  type LedgerBalanceLike,
} from '@/renderer/views/NewInvoice/lib/partyFamilyBalance';

export interface InvoicePrintRunningBalances {
  previousBalance: number;
  newBalance: number;
}

/** calendar day key for ledger as-of queries (local timezone) */
export const toInvoicePrintAsOfDate = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (!isValid(date)) {
    return '';
  }
  return format(date, 'yyyy-MM-dd');
};

/**
 * sabqa = family outstanding before this bill; naya = outstanding after it.
 * sale Dr-increases the family; purchase Cr-increases (signed negative).
 * `familyBalance` must already be as-of the invoice date (includes this bill).
 */
export const computeInvoicePrintRunningBalances = (
  invoiceType: InvoiceType,
  invoiceTotal: number,
  familyBalance: LedgerBalanceLike | null,
): InvoicePrintRunningBalances | null => {
  if (familyBalance == null) {
    return null;
  }
  const total = Math.abs(Number(invoiceTotal) || 0);
  const signedNaya = ledgerBalanceToSignedDrPositive(familyBalance);
  const signedInvoice = invoiceType === InvoiceType.Purchase ? -total : total;
  return {
    previousBalance: signedNaya - signedInvoice,
    newBalance: signedNaya,
  };
};
