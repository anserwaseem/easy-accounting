import { toNumber } from 'lodash';
import { InvoiceType } from 'types';
import type { Invoice } from 'types';

interface Params {
  invoiceType: InvoiceType;
  useSingleAccount: boolean;
  splitByItemType: boolean;
  values: Pick<Invoice, 'accountMapping' | 'invoiceItems'>;
}

export const getInvoiceAccountIdsFromForm = ({
  invoiceType,
  useSingleAccount,
  splitByItemType,
  values,
}: Params): number[] => {
  if (useSingleAccount) {
    if (
      invoiceType === InvoiceType.Sale &&
      splitByItemType &&
      Array.isArray(values.accountMapping.multipleAccountIds) &&
      values.accountMapping.multipleAccountIds.length > 0
    ) {
      return [
        ...new Set(
          (values.accountMapping.multipleAccountIds || []).filter(
            (id): id is number => typeof id === 'number' && id > 0,
          ),
        ),
      ];
    }

    const sid = toNumber(values.accountMapping.singleAccountId);
    return sid > 0 ? [sid] : [];
  }

  return (values.accountMapping.multipleAccountIds || []).filter(
    (id): id is number => typeof id === 'number' && id > 0,
  );
};
