import { zodResolver } from '@hookform/resolvers/zod';
import { toNumber } from 'lodash';
import { useMemo, useEffect, useState } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { DISCOUNT_ACCOUNT_NAME } from 'renderer/lib/constants';
import type { InventoryItem } from 'types';
import { InvoiceType } from 'types';
import { z } from 'zod';
import { buildNewInvoiceFormSchema, getDefaultFormValues } from '../schema';

export interface UseNewInvoiceFormCoreParams {
  invoiceType: InvoiceType;
  inventory: InventoryItem[] | undefined;
  useSingleAccountRef: React.MutableRefObject<boolean>;
  splitByItemTypeRef: React.MutableRefObject<boolean>;
}

/** owns form instance, schema, default values, field array, watched values, and discount-account-exists check */
export function useNewInvoiceFormCore(params: UseNewInvoiceFormCoreParams) {
  const { invoiceType, inventory, useSingleAccountRef, splitByItemTypeRef } =
    params;

  const defaultFormValues = useMemo(
    () => getDefaultFormValues(invoiceType),
    [invoiceType],
  );

  const formSchema = useMemo(
    () =>
      buildNewInvoiceFormSchema({
        invoiceType,
        inventory: inventory ?? [],
        getUseSingleAccount: () => useSingleAccountRef.current,
        getSplitByItemType: () => splitByItemTypeRef.current,
      }),
    [invoiceType, inventory, useSingleAccountRef, splitByItemTypeRef],
  );

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultFormValues,
    mode: 'onSubmit',
  });

  const watchedInvoiceItems = useWatch({
    control: form.control,
    name: 'invoiceItems',
  });

  const resolutionTrigger = useMemo(() => {
    const items = Array.isArray(watchedInvoiceItems) ? watchedInvoiceItems : [];
    return `${items.length}-${items.map((i) => i?.inventoryId ?? 0).join(',')}`;
  }, [watchedInvoiceItems]);

  const watchedExtraDiscount = useWatch({
    control: form.control,
    name: 'extraDiscount',
  });
  const watchedTotalAmount = useWatch({
    control: form.control,
    name: 'totalAmount',
  });
  const watchedSingleAccountId = useWatch({
    control: form.control,
    name: 'accountMapping.singleAccountId',
  });
  const watchedMultipleAccountIds = useWatch({
    control: form.control,
    name: 'accountMapping.multipleAccountIds',
  });

  const [discountAccountExists, setDiscountAccountExists] = useState<
    boolean | null
  >(null);

  // clear form validation errors when invoice type changes
  useEffect(() => {
    form.clearErrors();
  }, [invoiceType, form]);

  // when extra discount > 0, check if the required discount account exists (for posting)
  useEffect(() => {
    if (!(toNumber(watchedExtraDiscount) > 0)) {
      setDiscountAccountExists(null);
      return;
    }
    window.electron
      .getAccountByName(DISCOUNT_ACCOUNT_NAME)
      .then((acc) => setDiscountAccountExists(!!acc?.id))
      .catch(() => setDiscountAccountExists(false));
  }, [watchedExtraDiscount]);

  const { fields, append } = useFieldArray({
    control: form.control,
    name: 'invoiceItems',
  });

  return {
    form,
    defaultFormValues,
    formSchema,
    fields,
    append,
    watchedInvoiceItems,
    watchedExtraDiscount,
    watchedTotalAmount,
    watchedSingleAccountId,
    watchedMultipleAccountIds,
    resolutionTrigger,
    discountAccountExists,
    setDiscountAccountExists,
  };
}
