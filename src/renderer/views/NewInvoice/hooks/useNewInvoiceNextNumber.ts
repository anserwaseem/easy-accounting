import { useCallback, useEffect, useState } from 'react';
import { InvoiceType } from 'types';

/** loads next invoice number for the given invoice type when not yet set */
export function useNewInvoiceNextNumber(
  invoiceType: InvoiceType,
  enabled = true,
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
          await window.electron.getNextInvoiceNumber(invoiceType),
        );
      }
    })();
  }, [enabled, invoiceType, nextInvoiceNumber]);

  const refreshNextInvoiceNumber = useCallback(async () => {
    if (!enabled) return undefined;
    const next = await window.electron.getNextInvoiceNumber(invoiceType);
    setNextInvoiceNumber(next);
    return next;
  }, [enabled, invoiceType]);

  return {
    nextInvoiceNumber,
    setNextInvoiceNumber,
    refreshNextInvoiceNumber,
  };
}
