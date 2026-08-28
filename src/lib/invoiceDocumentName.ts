import { isNil, toNumber, toString } from 'lodash';
import { InvoiceType } from '../types';
import { getQuotationDisplayNumber } from './quotationDisplay';

interface InvoiceDocumentNameInput {
  invoiceType: InvoiceType | string | null | undefined;
  invoiceNumber: number | string | null | undefined;
  isQuotation: boolean;
}

/**
 * filename stem for a printed / saved invoice document (batch PDF name and the
 * print dialog's suggested name must agree, so both go through this).
 *
 * purchase rows are prefixed because invoice numbers restart per type: sale #12 and
 * purchase #12 would otherwise both write `12.pdf` into the one flat output folder
 * (same for `quotation-5`). sale names stay bare so files saved before purchase
 * printing existed keep their established naming.
 */
export const getInvoiceDocumentBaseName = ({
  invoiceType,
  invoiceNumber,
  isQuotation,
}: InvoiceDocumentNameInput): string => {
  const prefix = invoiceType === InvoiceType.Purchase ? 'purchase-' : '';

  if (isQuotation) {
    return `${prefix}quotation-${getQuotationDisplayNumber(
      toNumber(invoiceNumber),
    )}`;
  }

  // posted rows always carry a number; guard so a missing one yields no name at all
  // rather than a bare prefix that would collide across invoices
  if (isNil(invoiceNumber) || toString(invoiceNumber).trim() === '') {
    return '';
  }

  return `${prefix}${toString(invoiceNumber)}`;
};
