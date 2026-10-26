import { useCallback, useEffect, useState } from 'react';
import { InvoiceType } from 'types';

/** loads next invoice number for the given invoice type when not yet set */
export function useNewInvoiceNextNumber(
  invoiceType: InvoiceType,
  enabled = true,
  saleReturn = false,
): {
  nextInvoiceNumber: number | undefined;
  setNextInvoiceNumber: React.Dispatch<
    React.SetStateAction<number | undefined>
  >;
  /** re-fetch from IPC; no-op when disabled (edit mode) */
  refreshNextInvoiceNumber: () => Promise<number | undefined>;
} {
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState<
    number | undefined
  >(enabled ? -1 : undefined);

  useEffect(() => {
    if (!enabled) return;
    (async () => {
      if (nextInvoiceNumber === -1) {
        setNextInvoiceNumber(
          saleReturn
            ? await window.electron.getNextSaleReturnNumber()
            : await window.electron.getNextInvoiceNumber(invoiceType),
        );
      }
    })();
  }, [enabled, invoiceType, nextInvoiceNumber, saleReturn]);

  const refreshNextInvoiceNumber = useCallback(async () => {
    if (!enabled) return undefined;
    const next = saleReturn
      ? await window.electron.getNextSaleReturnNumber()
      : await window.electron.getNextInvoiceNumber(invoiceType);
    setNextInvoiceNumber(next);
    return next;
  }, [enabled, invoiceType, saleReturn]);

  return {
    nextInvoiceNumber,
    setNextInvoiceNumber,
    refreshNextInvoiceNumber,
  };
}
