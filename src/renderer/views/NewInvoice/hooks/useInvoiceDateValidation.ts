import { format } from 'date-fns';
import { toNumber } from 'lodash';
import { InvoiceType } from 'types';
import type { Invoice } from 'types';
import type { z } from 'zod';

import { getInvoiceAccountIdsFromForm } from './getInvoiceAccountIdsFromForm';

interface UseInvoiceDateValidationParams {
  invoiceType: InvoiceType;
  editInvoiceId: number | undefined;
  useSingleAccount: boolean;
  splitByItemType: boolean;
  formSchema: z.ZodType<Invoice>;
}

export const useInvoiceDateValidation = ({
  invoiceType,
  editInvoiceId,
  useSingleAccount,
  splitByItemType,
  formSchema,
}: UseInvoiceDateValidationParams) => {
  const validateInvoiceDateAgainstParties = async (
    values: z.infer<typeof formSchema>,
  ): Promise<string | null> => {
    const dateStr = values.date;
    if (!dateStr) return null;
    const invoiceDate = new Date(dateStr);
    invoiceDate.setHours(0, 0, 0, 0);

    const accountIds = getInvoiceAccountIdsFromForm({
      invoiceType,
      useSingleAccount,
      splitByItemType,
      values,
    });
    if (accountIds.length === 0) return null;

    // sale edit: allow changing date only within adjacent invoice dates for this customer
    if (
      invoiceType === InvoiceType.Sale &&
      editInvoiceId != null &&
      useSingleAccount &&
      !splitByItemType
    ) {
      const accountId = accountIds[0];
      const invoiceNumber = toNumber(values.invoiceNumber);
      if (accountId > 0 && invoiceNumber > 0) {
        const bounds = await window.electron.getSaleInvoiceEditDateBounds(
          editInvoiceId,
          accountId,
          invoiceNumber,
        );
        const prevTime =
          bounds.prevDate != null
            ? new Date(bounds.prevDate).setHours(0, 0, 0, 0)
            : null;
        const nextTime =
          bounds.nextDate != null
            ? new Date(bounds.nextDate).setHours(0, 0, 0, 0)
            : null;

        if (prevTime != null && invoiceDate.getTime() < prevTime) {
          return `Invoice date must be on or after ${format(
            new Date(prevTime),
            'PPP',
          )} for this customer (previous invoice date).`;
        }
        if (nextTime != null && invoiceDate.getTime() > nextTime) {
          return `Invoice date must be on or before ${format(
            new Date(nextTime),
            'PPP',
          )} for this customer (next invoice date).`;
        }
        return null;
      }
    }

    const lastDatesResults = await Promise.all(
      accountIds.map((accountId) =>
        window.electron.getLedger(accountId).then((ledger) => {
          const latest = ledger.at(-1)?.date;
          return latest ? new Date(latest) : null;
        }),
      ),
    );
    const lastDates = lastDatesResults.filter((d): d is Date => d != null);
    if (lastDates.length === 0) return null;

    const minRequired = new Date(
      Math.max(...lastDates.map((d) => d.getTime())),
    );
    minRequired.setHours(0, 0, 0, 0);
    if (invoiceDate >= minRequired) return null;

    const partyLabel = invoiceType === InvoiceType.Sale ? 'customer' : 'vendor';
    return `Invoice date must be on or after ${format(
      minRequired,
      'PPP',
    )} for the selected ${partyLabel}${
      useSingleAccount && !splitByItemType ? '' : '(s)'
    } (last ledger date).`;
  };

  return { validateInvoiceDateAgainstParties };
};
