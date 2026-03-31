import { useEffect, useState } from 'react';
import { InvoiceType } from 'types';

/** loads next invoice number for the given invoice type when not yet set */
export function useNewInvoiceNextNumber(
  invoiceType: InvoiceType,
): [
  number | undefined,
  React.Dispatch<React.SetStateAction<number | undefined>>,
] {
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState<
    number | undefined
  >(-1);

  useEffect(() => {
    (async () => {
      if (nextInvoiceNumber === -1) {
        setNextInvoiceNumber(
          await window.electron.getNextInvoiceNumber(invoiceType),
        );
      }
    })();
  }, [invoiceType, nextInvoiceNumber]);

  return [nextInvoiceNumber, setNextInvoiceNumber];
}
