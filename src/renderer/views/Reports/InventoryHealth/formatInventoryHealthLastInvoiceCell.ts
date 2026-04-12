import { format } from 'date-fns';

/** last sale / last purchase cell: date + invoice # for table, print, and excel */
export const formatInventoryHealthLastInvoiceCell = (
  isoDate: string | null,
  invoiceNumber: number | null,
): string => {
  if (!isoDate) return '';
  try {
    const d = format(new Date(isoDate), 'MM/dd/yyyy');
    if (invoiceNumber != null) {
      return `${d} | #${invoiceNumber}`;
    }
    return d;
  } catch {
    return '';
  }
};
