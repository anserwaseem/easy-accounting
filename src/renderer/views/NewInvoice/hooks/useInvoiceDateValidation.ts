import { format } from 'date-fns';
import { toNumber } from 'lodash';
import { InvoiceType } from 'types';
import type { Invoice } from 'types';
import type { z } from 'zod';

import { formatDisplayDate } from '@/lib/displayDate';
import { getInvoiceAccountIdsFromForm } from './getInvoiceAccountIdsFromForm';

interface UseInvoiceDateValidationParams {
  invoiceType: InvoiceType;
  editInvoiceId: number | undefined;
  useSingleAccount: boolean;
  splitByItemType: boolean;
  formSchema: z.ZodType<Invoice>;
  /** sale returns are not ordered among sale numbers, so the neighbor-date rule does not apply */
  isSaleReturn?: boolean;
}

export const useInvoiceDateValidation = ({
  invoiceType,
  editInvoiceId,
  useSingleAccount,
  splitByItemType,
  formSchema,
  isSaleReturn = false,
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

    const partyLabel = invoiceType === InvoiceType.Sale ? 'customer' : 'vendor';

    // edit: keep date between this party's previous and next invoice of the same type.
    // last-ledger min-date is a create-time rule and would block saving older bills.
    // a sale return's number is not in the sale sequence, so that neighbor is a
    // different sale and would reject a later return date. the server still
    // refuses a return dated before its own sale.
    if (editInvoiceId != null) {
      if (isSaleReturn) return null;
      const headerAccountId = toNumber(values.accountMapping.singleAccountId);
      const accountId = headerAccountId > 0 ? headerAccountId : accountIds[0];
      const invoiceNumber = toNumber(values.invoiceNumber);
      if (!(accountId > 0 && invoiceNumber > 0)) return null;

      const bounds = await window.electron.getInvoiceEditDateBounds(
        editInvoiceId,
        accountId,
        invoiceNumber,
        invoiceType,
      );
      if (bounds == null) return null;
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
        )} for this ${partyLabel} (previous invoice date).`;
      }
      if (nextTime != null && invoiceDate.getTime() > nextTime) {
        return `Invoice date must be on or before ${format(
          new Date(nextTime),
          'PPP',
        )} for this ${partyLabel} (next invoice date).`;
      }
      return null;
    }

    const lastDates: Date[] = window.electron.getLatestLedgerDatesForAccountIds
      ? Object.values(
          await window.electron.getLatestLedgerDatesForAccountIds(accountIds),
        )
          .filter(Boolean)
          .map((d) => new Date(d))
      : (
          await Promise.all(
            accountIds.map((accountId) =>
              window.electron.getLedger(accountId).then((ledger) => {
                const latest = ledger.at(-1)?.date;
                return latest ? new Date(latest) : null;
              }),
            ),
          )
        ).filter((d): d is Date => d != null);
    if (lastDates.length === 0) return null;

    const minRequired = new Date(
      Math.max(...lastDates.map((d) => d.getTime())),
    );
    minRequired.setHours(0, 0, 0, 0);
    if (invoiceDate >= minRequired) return null;

    return `Invoice date must be on or after ${formatDisplayDate(
      minRequired,
    )} for the selected ${partyLabel}${
      useSingleAccount && !splitByItemType ? '' : '(s)'
    } (last ledger date).`;
  };

  return { validateInvoiceDateAgainstParties };
};
