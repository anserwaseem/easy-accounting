import { useEffect, useState } from 'react';
import { InvoiceType } from 'types';

/** loads next invoice number for the given invoice type when not yet set */
export function useNewInvoiceNextNumber(
  invoiceType: InvoiceType,
  enabled = true,
): [
  number | undefined,
  React.Dispatch<React.SetStateAction<number | undefined>>,
] {
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

  return [nextInvoiceNumber, setNextInvoiceNumber];
}
