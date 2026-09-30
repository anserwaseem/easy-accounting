import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useEffect, useRef } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import type { InventoryItem } from 'types';
import { InvoiceType } from 'types';
import { z } from 'zod';
import { buildNewInvoiceFormSchema, getDefaultFormValues } from '../schema';

export interface UseNewInvoiceFormCoreParams {
  invoiceType: InvoiceType;
  inventory: InventoryItem[] | undefined;
  useSingleAccountRef: React.MutableRefObject<boolean>;
  splitByItemTypeRef: React.MutableRefObject<boolean>;
  /** drives resolutionTrigger when split toggles without line-item identity changes */
  splitByItemType: boolean;
  /** sale edit: bonus quantities per inventory id for max-stock validation */
  saleStockValidationBonusRef?: React.MutableRefObject<Record<number, number>>;
  /** when true, invoiceNumber may be a negative quotation placeholder */
  isQuotationFlowRef?: React.MutableRefObject<boolean>;
}

/** owns form instance, schema, default values, field array, and watched values */
export function useNewInvoiceFormCore(params: UseNewInvoiceFormCoreParams) {
  const {
    invoiceType,
    inventory,
    useSingleAccountRef,
    splitByItemTypeRef,
    saleStockValidationBonusRef,
    isQuotationFlowRef,
  } = params;

  const internalBonusRef = useRef<Record<number, number>>({});
  const bonusRef = saleStockValidationBonusRef ?? internalBonusRef;
  const internalQuotationRef = useRef(false);
  const quotationFlowRef = isQuotationFlowRef ?? internalQuotationRef;

  const defaultFormValues = useMemo(
    () => getDefaultFormValues(invoiceType),
    [invoiceType],
  );

  // rebuilds zod schema when invoice type or inventory changes; uses getter refs for
  // runtime-only flags (single account, split-by-type, quotation) so schema doesn't
  // recompute on every checkbox toggle — only on submit when the getter is called
  const formSchema = useMemo(
    () =>
      buildNewInvoiceFormSchema({
        invoiceType,
        inventory: inventory ?? [],
        getUseSingleAccount: () => useSingleAccountRef.current,
        getSplitByItemType: () => splitByItemTypeRef.current,
        getSaleStockValidationBonus: () => ({ ...bonusRef.current }),
        getIsQuotationFlow: () => quotationFlowRef.current,
      }),
    [
      invoiceType,
      inventory,
      useSingleAccountRef,
      splitByItemTypeRef,
      bonusRef,
      quotationFlowRef,
    ],
  );

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultFormValues,
    mode: 'onSubmit',
  });

  const watchedExtraDiscount = useWatch({
    control: form.control,
    name: 'extraDiscount',
  });
  const watchedSingleAccountId = useWatch({
    control: form.control,
    name: 'accountMapping.singleAccountId',
  });
  const watchedMultipleAccountIds = useWatch({
    control: form.control,
    name: 'accountMapping.multipleAccountIds',
  });

  // clear form validation errors when invoice type changes
  useEffect(() => {
    form.clearErrors();
  }, [invoiceType, form]);

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: 'invoiceItems',
    keyName: 'fieldKey',
  });

  return {
    form,
    defaultFormValues,
    formSchema,
    fields,
    append,
    remove,
    replace,
    watchedExtraDiscount,
    watchedSingleAccountId,
    watchedMultipleAccountIds,
  };
}
