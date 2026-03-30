/* eslint-disable react/no-unstable-nested-components */
import { format } from 'date-fns';
import { get, isNil, toNumber, toString } from 'lodash';
import {
  Calendar as CalendarIcon,
  Plus,
  Printer,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import {
  cn,
  defaultSortingFunctions,
  getFormattedCurrency,
  raise,
} from 'renderer/lib/utils';
import { Button } from 'renderer/shad/ui/button';
import { Calendar } from 'renderer/shad/ui/calendar';
import { DataTable } from 'renderer/shad/ui/dataTable';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from 'renderer/shad/ui/form';
import { Input } from 'renderer/shad/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'renderer/shad/ui/popover';
import { toast } from 'renderer/shad/ui/use-toast';
import { type InventoryItem, InvoiceType } from 'types';
import { z } from 'zod';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Label } from '@/renderer/shad/ui/label';
import { computeInvoiceItemTotal } from '@/renderer/lib/invoiceUtils';
import { convertFileToJson } from '@/renderer/lib/lib';
import {
  checkParsedItemsAvailability,
  parseInvoiceItems,
} from '@/renderer/lib/parser';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { AddInvoiceNumber } from './components/addInvoiceNumber';
import { CustomerSectionsBlock } from './components/CustomerSectionsBlock';
import { DateConfirmationDialog } from './components/DateConfirmationDialog';
import { useNewInvoiceColumns } from './hooks/useNewInvoiceColumns';
import { useNewInvoiceDiscounts } from './hooks/useNewInvoiceDiscounts';
import { useNewInvoiceFormCore } from './hooks/useNewInvoiceFormCore';
import { useNewInvoiceInventory } from './hooks/useNewInvoiceInventory';
import { useNewInvoiceNextNumber } from './hooks/useNewInvoiceNextNumber';
import { useNewInvoiceParties } from './hooks/useNewInvoiceParties';
import { useNewInvoiceResolution } from './hooks/useNewInvoiceResolution';
import { useNewInvoiceSections } from './hooks/useNewInvoiceSections';
import { useNewInvoiceTableInfo } from './hooks/useNewInvoiceTableInfo';

interface NewInvoiceProps {
  invoiceType: InvoiceType;
}

// TODO: improve performance, check states: remove unnecessary data
const NewInvoicePage: React.FC<NewInvoiceProps> = ({
  invoiceType,
}: NewInvoiceProps) => {
  console.log('NewInvoicePage', invoiceType);
  const [inventory] = useNewInvoiceInventory();
  const [nextInvoiceNumber, setNextInvoiceNumber] =
    useNewInvoiceNextNumber(invoiceType);
  const {
    parties,
    requiredAccountsExist,
    isRefreshingParties,
    refreshParties,
  } = useNewInvoiceParties(invoiceType);

  const [useSingleAccount, setUseSingleAccount] = useState(true);
  const useSingleAccountRef = useRef(useSingleAccount);
  useSingleAccountRef.current = useSingleAccount;
  const [splitByItemType, setSplitByItemType] = useState(true);
  const splitByItemTypeRef = useRef(splitByItemType);
  splitByItemTypeRef.current = splitByItemType;

  const [isDateExplicitlySet, setIsDateExplicitlySet] = useState(false);
  const [showDateConfirmation, setShowDateConfirmation] = useState(false);
  const dateConfirmedInModalRef = useRef(false);
  const openPrintAfterSaveRef = useRef(false);

  const formCore = useNewInvoiceFormCore({
    invoiceType,
    inventory,
    useSingleAccountRef,
    splitByItemTypeRef,
  });
  const {
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
  } = formCore;

  const {
    sections,
    setSections,
    activeSectionId,
    setActiveSectionId,
    rowSectionMap,
    setRowSectionMap,
  } = useNewInvoiceSections({
    invoiceType,
    useSingleAccount,
    splitByItemType,
    form: form as unknown as UseFormReturn<Record<string, unknown>>,
    watchedInvoiceItems,
  });

  const discounts = useNewInvoiceDiscounts({
    invoiceType,
    form: form as unknown as UseFormReturn<Record<string, unknown>>,
    useSingleAccount,
    useSingleAccountRef,
    splitByItemTypeRef,
    parties,
    sections,
    rowSectionMap,
    watchedSingleAccountId,
  });
  const {
    applyAutoDiscountForRow,
    recalculateAutoDiscounts,
    recalculateAutoDiscountsRef,
    manualDiscountRows,
    setManualDiscountRows,
    enableCumulativeDiscount,
    setEnableCumulativeDiscount,
    cumulativeDiscount,
    setCumulativeDiscount,
    isDiscountEditEnabled,
    singleAccountAutoDiscountOff,
    sectionAutoDiscountOffCount,
    getSectionLabel,
  } = discounts;

  const onResolved = useCallback(() => {
    recalculateAutoDiscountsRef.current();
  }, [recalculateAutoDiscountsRef]);

  const { resolvedRowLabels, resolutionFallbacks } = useNewInvoiceResolution({
    invoiceType,
    useSingleAccount,
    splitByItemType,
    form: form as unknown as UseFormReturn<Record<string, unknown>>,
    parties,
    inventory,
    resolutionTrigger,
    watchedSingleAccountId,
    onResolved,
  });

  // derived layout flags
  const isSale = invoiceType === InvoiceType.Sale;
  const isPurchase = invoiceType === InvoiceType.Purchase;
  const isSingleAccountSale = useSingleAccount && isSale;
  const isSingleAccountOrPurchase = useSingleAccount || isPurchase;
  const isSectionsView = !isSingleAccountOrPurchase;

  const navigate = useNavigate();

  const getInitialEntry = useCallback(
    () => ({
      id: Date.now() + Math.floor(Math.random() * 1000),
      inventoryId: 0,
      quantity: 0,
      discount: 0,
      price: 0,
      discountedPrice: 0,
    }),
    [],
  );

  /** options for "Extra discount from account" when extra discount > 0 */
  const extraDiscountAccountOptions = useMemo(() => {
    if (!(toNumber(watchedExtraDiscount) > 0)) return [];
    const ids: number[] = [];
    if (useSingleAccount) {
      if (
        invoiceType === InvoiceType.Sale &&
        splitByItemType &&
        Array.isArray(watchedMultipleAccountIds) &&
        watchedMultipleAccountIds.length > 0
      ) {
        ids.push(
          ...new Set(
            watchedMultipleAccountIds.filter(
              (id): id is number => typeof id === 'number' && id > 0,
            ),
          ),
        );
      } else {
        const sid = toNumber(watchedSingleAccountId);
        if (sid > 0) ids.push(sid);
      }
    } else {
      (watchedMultipleAccountIds ?? []).forEach((id) => {
        if (typeof id === 'number' && id > 0) ids.push(id);
      });
    }
    const uniqueIds = [...new Set(ids)];
    return uniqueIds.map((id) => {
      const party = parties?.find((p) => p.id === id);
      const label =
        party?.name ??
        (Array.isArray(resolvedRowLabels) &&
        typeof watchedMultipleAccountIds?.indexOf === 'function'
          ? resolvedRowLabels[
              (watchedMultipleAccountIds as number[]).indexOf(id)
            ]
          : undefined) ??
        `Account ${id}`;
      return { id, name: label };
    });
  }, [
    invoiceType,
    parties,
    resolvedRowLabels,
    splitByItemType,
    useSingleAccount,
    watchedExtraDiscount,
    watchedMultipleAccountIds,
    watchedSingleAccountId,
  ]);

  // when extra discount is set, clear or default extraDiscountAccountId; when options change, select first if none selected
  useEffect(() => {
    if (!(toNumber(watchedExtraDiscount) > 0)) {
      form.setValue('extraDiscountAccountId', undefined, {
        shouldValidate: false,
        shouldDirty: true,
      });
      return;
    }
    const first = extraDiscountAccountOptions[0];
    const currentId = form.getValues('extraDiscountAccountId');
    if (first && (!currentId || toNumber(currentId) <= 0)) {
      form.setValue('extraDiscountAccountId', first.id, {
        shouldValidate: false,
        shouldDirty: true,
      });
    }
  }, [extraDiscountAccountOptions, form, watchedExtraDiscount]);

  const handleRemoveRow = useCallback(
    (rowIndex: number) => {
      const latestInvoice = form.getValues();
      const removedRow = latestInvoice.invoiceItems[rowIndex];

      if (fields.length > 0) {
        form.clearErrors(`invoiceItems.${rowIndex}` as const);
        form.setValue(
          'invoiceItems',
          latestInvoice.invoiceItems.filter((_, index) => index !== rowIndex),
        );
        if (removedRow?.id) {
          setRowSectionMap((prev) => {
            const next = { ...prev };
            delete next[removedRow.id];
            return next;
          });
          setManualDiscountRows((prev) => {
            const next = { ...prev };
            delete next[removedRow.id];
            return next;
          });
        }
      }
    },
    [fields.length, form, setManualDiscountRows, setRowSectionMap],
  );

  /** has item + its quantity selected */
  const hasActiveInvoiceItem = useMemo(
    () => !!watchedInvoiceItems.at(0)?.discountedPrice,
    [watchedInvoiceItems],
  );

  // recompute totalAmount as sum of rounded section totals (F/T/TT) minus extra discount.
  // each section total is rounded to nearest rupee first; grand total is not rounded again.
  useEffect(() => {
    if (!hasActiveInvoiceItem) {
      form.setValue('totalAmount', 0, {
        shouldValidate: false,
        shouldDirty: true,
      });
      return;
    }

    const sectionSums = watchedInvoiceItems.reduce(
      (acc, item) => {
        const key = rowSectionMap[item.id] || 'No Type';
        const amount =
          enableCumulativeDiscount && cumulativeDiscount
            ? computeInvoiceItemTotal(
                item.quantity,
                cumulativeDiscount,
                item.price,
              )
            : toNumber(item.discountedPrice);
        acc[key] = (acc[key] ?? 0) + toNumber(amount);
        return acc;
      },
      {} as Record<string, number>,
    );

    const grossRounded = Object.values(sectionSums).reduce((sumRupees, s) => {
      return sumRupees + Math.round(toNumber(s));
    }, 0);
    const total = grossRounded - toNumber(watchedExtraDiscount ?? 0);

    form.setValue('totalAmount', total, {
      shouldValidate: false,
      shouldDirty: true,
    });
  }, [
    cumulativeDiscount,
    enableCumulativeDiscount,
    form,
    hasActiveInvoiceItem,
    watchedExtraDiscount,
    watchedInvoiceItems,
    rowSectionMap,
  ]);

  const getSelectedItem = useCallback(
    (fieldValue: number) =>
      inventory?.find((item) => item.id === toNumber(fieldValue)),
    [inventory],
  );
  const onItemSelectionChange = useCallback(
    async (rowIndex: number, val: string, onChange: Function) => {
      onChange(val);
      const item = getSelectedItem(toNumber(val));
      form.setValue(`invoiceItems.${rowIndex}.price`, item?.price || 0);

      if (invoiceType === InvoiceType.Sale) {
        await applyAutoDiscountForRow(rowIndex, toNumber(val));
        return;
      }

      form.setValue(
        `invoiceItems.${rowIndex}.discountedPrice`,
        computeInvoiceItemTotal(
          form.getValues(`invoiceItems.${rowIndex}.quantity`),
          form.getValues(`invoiceItems.${rowIndex}.discount`),
          item?.price,
        ),
        {
          shouldValidate: false,
          shouldDirty: true,
        },
      );
    },
    [applyAutoDiscountForRow, form, getSelectedItem, invoiceType],
  );
  const getDiscountValue = useCallback(
    (fieldValue: number) =>
      enableCumulativeDiscount && cumulativeDiscount
        ? cumulativeDiscount
        : fieldValue,
    [cumulativeDiscount, enableCumulativeDiscount],
  );
  const onDiscountChange = useCallback(
    (rowIndex: number, value: string, onChange: Function) => {
      onChange(toNumber(value));
      const rowId = form.getValues(`invoiceItems.${rowIndex}.id`);
      if (isDiscountEditEnabled) {
        setManualDiscountRows((prev) => ({ ...prev, [rowId]: true }));
      }
      form.setValue(
        `invoiceItems.${rowIndex}.discountedPrice`,
        computeInvoiceItemTotal(
          form.getValues(`invoiceItems.${rowIndex}.quantity`),
          toNumber(value),
          form.getValues(`invoiceItems.${rowIndex}.price`),
        ),
        {
          shouldValidate: false,
          shouldDirty: true,
        },
      );
    },
    [form, isDiscountEditEnabled, setManualDiscountRows],
  );
  const onResetDiscountToAuto = useCallback(
    async (rowIndex: number) => {
      const rowId = form.getValues(`invoiceItems.${rowIndex}.id`);
      setManualDiscountRows((prev) => ({ ...prev, [rowId]: false }));
      await applyAutoDiscountForRow(rowIndex);
    },
    [applyAutoDiscountForRow, form, setManualDiscountRows],
  );
  const onQuantityChange = useCallback(
    (rowIndex: number, value: string, onChange: Function) => {
      onChange(toNumber(value));
      form.setValue(
        `invoiceItems.${rowIndex}.discountedPrice`,
        computeInvoiceItemTotal(
          toNumber(value),
          form.getValues(`invoiceItems.${rowIndex}.discount`),
          form.getValues(`invoiceItems.${rowIndex}.price`),
        ),
        {
          shouldValidate: false,
          shouldDirty: true,
        },
      );
    },
    [form],
  );
  const renderDiscountedPrice = useCallback(
    (rowIndex: number, fieldValue?: number) => {
      if (enableCumulativeDiscount && cumulativeDiscount) {
        return getFormattedCurrency(
          computeInvoiceItemTotal(
            form.getValues(`invoiceItems.${rowIndex}.quantity`),
            cumulativeDiscount,
            form.getValues(`invoiceItems.${rowIndex}.price`),
          ),
        );
      }

      return typeof fieldValue === 'number' && fieldValue >= 0
        ? getFormattedCurrency(fieldValue)
        : null;
    },
    [cumulativeDiscount, enableCumulativeDiscount, form],
  );

  const onAccountSelection = useCallback(
    async (accountId: string, onChange: Function) => {
      onChange(toNumber(accountId));
      if (invoiceType === InvoiceType.Sale && useSingleAccountRef.current) {
        await recalculateAutoDiscounts();
      }
    },
    [invoiceType, recalculateAutoDiscounts],
  );

  const columnsParams = useMemo(
    () => ({
      form: { control: form.control, getValues: form.getValues },
      inventory,
      invoiceType,
      resolvedRowLabels,
      splitByItemType,
      useSingleAccount,
      enableCumulativeDiscount,
      isDiscountEditEnabled,
      manualDiscountRows,
      sections,
      rowSectionMap,
      setRowSectionMap,
      onItemSelectionChange,
      onQuantityChange,
      handleRemoveRow,
      getDiscountValue,
      onDiscountChange,
      renderDiscountedPrice,
      onResetDiscountToAuto,
      applyAutoDiscountForRow,
      getSectionLabel,
    }),
    [
      form.control,
      form.getValues,
      inventory,
      invoiceType,
      resolvedRowLabels,
      splitByItemType,
      useSingleAccount,
      enableCumulativeDiscount,
      isDiscountEditEnabled,
      manualDiscountRows,
      sections,
      rowSectionMap,
      setRowSectionMap,
      onItemSelectionChange,
      onQuantityChange,
      handleRemoveRow,
      getDiscountValue,
      onDiscountChange,
      renderDiscountedPrice,
      onResetDiscountToAuto,
      applyAutoDiscountForRow,
      getSectionLabel,
    ],
  );
  const columns = useNewInvoiceColumns(columnsParams);

  const handleAddNewRow = useCallback(() => {
    const entry = getInitialEntry();
    append({ ...entry });
    if (
      invoiceType === InvoiceType.Sale &&
      !useSingleAccount &&
      activeSectionId
    ) {
      setRowSectionMap((prev) => ({
        ...prev,
        [entry.id]: activeSectionId,
      }));
    }
  }, [
    activeSectionId,
    append,
    getInitialEntry,
    invoiceType,
    setRowSectionMap,
    useSingleAccount,
  ]);

  const isSubmitDisabled = useMemo(() => {
    if (form.formState.isSubmitting) return true;
    const total = watchedTotalAmount;
    if (
      invoiceType === InvoiceType.Sale &&
      (typeof total !== 'number' || total <= 0)
    )
      return true;
    if (
      invoiceType === InvoiceType.Purchase &&
      typeof total === 'number' &&
      total < 0
    )
      return true;
    if (
      useSingleAccount &&
      (watchedSingleAccountId == null || watchedSingleAccountId <= 0)
    )
      return true;
    if (invoiceType === InvoiceType.Sale && !useSingleAccount) {
      const multipleAccountIds = watchedMultipleAccountIds || [];
      if (
        !multipleAccountIds.length ||
        multipleAccountIds.some((id) => id <= 0)
      )
        return true;
    }
    return false;
  }, [
    form,
    invoiceType,
    useSingleAccount,
    watchedMultipleAccountIds,
    watchedSingleAccountId,
    watchedTotalAmount,
  ]);

  const onCumulativeDiscountChange = useCallback(
    (value: string) => {
      if (!isDiscountEditEnabled) return;
      const discount = toNumber(value);
      setCumulativeDiscount(discount);

      const updatedInvoiceItems = form
        .getValues('invoiceItems')
        .map((item) => ({
          ...item,
          discount,
          discountedPrice: computeInvoiceItemTotal(
            item.quantity,
            discount,
            item.price,
          ),
        }));

      form.setValue('invoiceItems', updatedInvoiceItems, {
        shouldValidate: false,
        shouldDirty: true,
      });
    },
    [form, isDiscountEditEnabled, setCumulativeDiscount],
  );

  const tableInfoData = useNewInvoiceTableInfo({
    control: form.control,
    invoiceType,
    watchedExtraDiscount,
    watchedTotalAmount,
    extraDiscountAccountOptions,
    discountAccountExists,
    enableCumulativeDiscount,
    setEnableCumulativeDiscount,
    cumulativeDiscount,
    isDiscountEditEnabled,
    onCumulativeDiscountChange,
    useSingleAccount,
    splitByItemType,
  });

  const submitInvoice = async (
    values: z.infer<typeof formSchema>,
  ): Promise<number | undefined> => {
    try {
      const invoice = {
        ...values,
        invoiceNumber: nextInvoiceNumber,
      };
      const result = (await window.electron.insertInvoice(
        invoiceType,
        invoice,
      )) as { invoiceId: number; nextInvoiceNumber: number };

      if (result.nextInvoiceNumber > 0) {
        setNextInvoiceNumber(result.nextInvoiceNumber);
        form.reset(defaultFormValues);
        setIsDateExplicitlySet(false);
        setSections([]);
        setActiveSectionId(null);
        setRowSectionMap({});
        setManualDiscountRows({});
        toast({
          description: `${invoiceType} invoice saved successfully`,
          variant: 'success',
        });
        return result.invoiceId > 0 ? result.invoiceId : undefined;
      }
      raise(`Failed to save ${invoiceType} invoice`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      toast({
        description: toString(error),
        variant: 'destructive',
      });
    }
    return undefined;
  };

  const validateInvoiceDateAgainstParties = useCallback(
    async (values: z.infer<typeof formSchema>): Promise<string | null> => {
      const dateStr = values.date;
      if (!dateStr) return null;
      const invoiceDate = new Date(dateStr);
      invoiceDate.setHours(0, 0, 0, 0);

      let accountIds: number[];
      if (useSingleAccount) {
        if (
          invoiceType === InvoiceType.Sale &&
          splitByItemType &&
          Array.isArray(values.accountMapping.multipleAccountIds) &&
          values.accountMapping.multipleAccountIds.length > 0
        ) {
          accountIds = [
            ...new Set(
              (values.accountMapping.multipleAccountIds || []).filter(
                (id): id is number => typeof id === 'number' && id > 0,
              ),
            ),
          ];
        } else {
          const sid = values.accountMapping.singleAccountId;
          accountIds = typeof sid === 'number' && sid > 0 ? [sid] : [];
        }
      } else {
        accountIds = (values.accountMapping.multipleAccountIds || []).filter(
          (id): id is number => typeof id === 'number' && id > 0,
        );
      }
      if (accountIds.length === 0) return null;

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
      const partyLabel =
        invoiceType === InvoiceType.Sale ? 'customer' : 'vendor';
      return `Invoice date must be on or after ${format(
        minRequired,
        'PPP',
      )} for the selected ${partyLabel}${
        useSingleAccount && !splitByItemType ? '' : '(s)'
      } (last ledger date).`;
    },
    [invoiceType, splitByItemType, useSingleAccount],
  );

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    // eslint-disable-next-line no-console
    console.log('onSubmit invoice:', values);

    const dateError = await validateInvoiceDateAgainstParties(values);
    if (dateError) {
      form.setError('date', { type: 'manual', message: dateError });
      return;
    }

    // when user clicked "Use current date" in modal, state may not have updated yet
    if (dateConfirmedInModalRef.current) {
      dateConfirmedInModalRef.current = false;
      setIsDateExplicitlySet(true);
      const invoiceId = await submitInvoice(values);
      if (openPrintAfterSaveRef.current && invoiceId != null) {
        openPrintAfterSaveRef.current = false;
        navigate(`/invoices/${invoiceId}/print`);
      }
      return;
    }

    if (!isDateExplicitlySet) {
      setShowDateConfirmation(true);
      return;
    }

    const invoiceId = await submitInvoice(values);
    if (openPrintAfterSaveRef.current && invoiceId != null) {
      openPrintAfterSaveRef.current = false;
      navigate(`/invoices/${invoiceId}/print`);
    }
  };

  const uploadInvoiceItems = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    try {
      const json = await convertFileToJson(file);
      const parsedItems = parseInvoiceItems(json);
      const items = (await window.electron.getInventory()) as InventoryItem[];
      const areItemsAvailable = checkParsedItemsAvailability(
        parsedItems,
        items,
      );
      if (!areItemsAvailable) {
        toast({
          description:
            'Some items are not in inventory. Please recheck and try again.',
          variant: 'destructive',
        });
        return;
      }

      parsedItems.forEach((pItem) => {
        const inventoryItem = items.find((i) => i.name === pItem.name);
        const entry = {
          ...getInitialEntry(),
          inventoryId: inventoryItem?.id ?? 0,
          quantity: pItem.quantity,
          discount: 0,
          price: inventoryItem?.price ?? 0,
          discountedPrice: 0,
        };
        append(entry);
        if (
          invoiceType === InvoiceType.Sale &&
          !useSingleAccount &&
          activeSectionId
        ) {
          setRowSectionMap((prev) => ({
            ...prev,
            [entry.id]: activeSectionId,
          }));
        }
      });

      if (invoiceType === InvoiceType.Sale) {
        await recalculateAutoDiscounts();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      toast({
        description: toString(error),
        variant: 'destructive',
      });
    }
  };

  const checkKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLFormElement> | undefined) =>
      e?.key === 'Enter' && e.preventDefault(),
    [],
  );

  const onInvoiceNumberSet = (invoiceNumber: number) =>
    setNextInvoiceNumber(invoiceNumber);

  const onDateSelection = useCallback(
    (date?: Date) => {
      if (!date) return;
      form.setValue('date', date.toISOString());
      setIsDateExplicitlySet(true);
    },
    [form],
  );

  const onSingleAccountToggle = useCallback(
    (isChecked: boolean) => {
      setUseSingleAccount(isChecked);
      // clear the appropriate account mapping fields based on the toggle
      if (isChecked) {
        form.setValue('accountMapping.multipleAccountIds', [], {
          shouldValidate: false,
        });
        setSections([]);
        setActiveSectionId(null);
        setRowSectionMap({});
      } else {
        const selectedCustomerId = form.getValues(
          'accountMapping.singleAccountId',
        );
        const sectionId = `section-${Date.now()}`;
        setSections([
          {
            id: sectionId,
            accountId:
              typeof selectedCustomerId === 'number' && selectedCustomerId > 0
                ? selectedCustomerId
                : undefined,
          },
        ]);
        setActiveSectionId(sectionId);
        const invoiceItems = form.getValues('invoiceItems');
        setRowSectionMap(
          invoiceItems.reduce(
            (acc, item) => ({
              ...acc,
              [item.id]: sectionId,
            }),
            {},
          ),
        );
        form.setValue('accountMapping.singleAccountId', undefined, {
          shouldValidate: false,
        });
        form.setValue('extraDiscount', 0);
        if (invoiceType === InvoiceType.Sale) {
          const forcedAccountId = toNumber(selectedCustomerId);
          const currentInvoiceItems = form.getValues('invoiceItems');
          (async () => {
            for (
              let rowIndex = 0;
              rowIndex < currentInvoiceItems.length;
              rowIndex += 1
            ) {
              // eslint-disable-next-line no-await-in-loop
              await applyAutoDiscountForRow(
                rowIndex,
                toNumber(currentInvoiceItems[rowIndex].inventoryId),
                forcedAccountId,
              );
            }
          })().catch((error) => {
            console.error(
              'Error applying auto discount after account toggle',
              error,
            );
          });
        }
      }
    },
    [
      applyAutoDiscountForRow,
      form,
      invoiceType,
      setActiveSectionId,
      setRowSectionMap,
      setSections,
    ],
  );

  const addSection = useCallback(() => {
    const sectionId = `section-${Date.now()}`;
    setSections((prev) => [...prev, { id: sectionId }]);
    if (!activeSectionId) {
      setActiveSectionId(sectionId);
    }
  }, [activeSectionId, setActiveSectionId, setSections]);

  const removeSection = useCallback(
    (sectionId: string) => {
      if (sections.length <= 1) return;

      const nextSections = sections.filter(
        (section) => section.id !== sectionId,
      );
      const fallbackSectionId = nextSections[0]?.id;
      setSections(nextSections);

      if (activeSectionId === sectionId) {
        setActiveSectionId(fallbackSectionId ?? null);
      }

      if (fallbackSectionId) {
        setRowSectionMap((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([rowId, mappedSectionId]) => [
              rowId,
              mappedSectionId === sectionId
                ? fallbackSectionId
                : mappedSectionId,
            ]),
          ),
        );
      }
    },
    [
      activeSectionId,
      sections,
      setActiveSectionId,
      setRowSectionMap,
      setSections,
    ],
  );

  const setSectionCustomer = useCallback(
    async (sectionId: string, accountId: number) => {
      setSections((prev) =>
        prev.map((section) =>
          section.id === sectionId ? { ...section, accountId } : section,
        ),
      );

      if (invoiceType !== InvoiceType.Sale) return;

      const items = form.getValues('invoiceItems');
      for (let rowIndex = 0; rowIndex < items.length; rowIndex += 1) {
        const row = items[rowIndex];
        if (rowSectionMap[row.id] !== sectionId) {
          continue;
        }
        if (isDiscountEditEnabled && manualDiscountRows[row.id]) {
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await applyAutoDiscountForRow(rowIndex, row.inventoryId, accountId);
      }
    },
    [
      applyAutoDiscountForRow,
      form,
      isDiscountEditEnabled,
      invoiceType,
      manualDiscountRows,
      rowSectionMap,
      setSections,
    ],
  );

  if (isNil(inventory)) {
    return <>Loading...</>;
  }

  if (!inventory?.length) {
    return (
      <div className="block fixed z-10 bg-green-400 text-center text-xl bg-opacity-60 w-full left-0 top-[50%] py-4 px-8">
        Please add inventory before creating an invoice.
      </div>
    );
  }

  if (requiredAccountsExist.loading) {
    return <>Loading...</>;
  }

  if (!requiredAccountsExist.sale || !requiredAccountsExist.purchase) {
    return (
      <div className="block fixed z-10 bg-green-400 text-center text-xl bg-opacity-60 w-full left-0 top-[50%] py-4 px-8">
        Please add both Sale and Purchase accounts before creating an invoice.
      </div>
    );
  }

  return (
    <>
      <DateConfirmationDialog
        open={showDateConfirmation}
        onOpenChange={setShowDateConfirmation}
        onUseCurrentDate={() => {
          form.setValue('date', new Date().toISOString());
          dateConfirmedInModalRef.current = true;
          form.handleSubmit(onSubmit)();
        }}
      />

      <div className="py-1 flex flex-col gap-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="title-new">{`New ${invoiceType} Invoice`}</h1>
          <div className="flex flex-wrap items-center gap-3">
            {invoiceType === InvoiceType.Sale && !isNil(nextInvoiceNumber) && (
              <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-muted/30 px-3">
                <div className="flex items-center gap-2 min-h-[44px]">
                  <Checkbox
                    id="useSingleAccount"
                    checked={useSingleAccount}
                    onCheckedChange={onSingleAccountToggle}
                  />
                  <Label
                    htmlFor="useSingleAccount"
                    className="cursor-pointer select-none"
                  >
                    One customer for entire invoice
                  </Label>
                </div>
                {useSingleAccount && (
                  <div className="flex items-center gap-2 min-h-[44px]">
                    <Checkbox
                      id="splitByItemType"
                      checked={splitByItemType}
                      onCheckedChange={(checked) =>
                        setSplitByItemType(checked === true)
                      }
                    />
                    <Label
                      htmlFor="splitByItemType"
                      className="cursor-pointer select-none"
                    >
                      Split ledger by item type
                    </Label>
                  </div>
                )}
              </div>
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={refreshParties}
              title="Refresh accounts"
              disabled={isRefreshingParties}
            >
              <RefreshCw
                className={cn('h-4 w-4', isRefreshingParties && 'animate-spin')}
              />
            </Button>
          </div>
        </div>

        {isNil(nextInvoiceNumber) ? (
          <AddInvoiceNumber
            invoiceType={invoiceType}
            onInvoiceNumberSet={onInvoiceNumberSet}
          />
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit, (errors) =>
                console.log('onSubmit errors', errors),
              )}
              onReset={() => {
                form.reset(defaultFormValues);
                setIsDateExplicitlySet(false);
                setSections([]);
                setActiveSectionId(null);
                setRowSectionMap({});
                setManualDiscountRows({});
              }}
              onKeyDown={checkKeyDown}
              role="presentation"
            >
              <div className="flex flex-col gap-6">
                <section
                  className="flex flex-col gap-4"
                  aria-label="Invoice details"
                >
                  <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                    {isSingleAccountSale && (
                      <>
                        <div
                          className="grid gap-3 col-span-2"
                          style={{
                            gridTemplateColumns: '2fr 1.2fr 0.6fr 0.4fr',
                          }}
                        >
                          <FormField
                            control={form.control}
                            name="accountMapping.singleAccountId"
                            render={({ field }) => (
                              <FormItem labelPosition="top" className="min-w-0">
                                <FormLabel className="text-base">
                                  {isSale ? 'Customer' : 'Vendor'}
                                  <span className="text-destructive"> *</span>
                                </FormLabel>
                                <VirtualSelect
                                  options={parties || []}
                                  value={field.value}
                                  onChange={(val) =>
                                    onAccountSelection(
                                      toString(val),
                                      field.onChange,
                                    )
                                  }
                                  placeholder="Select a party"
                                  searchPlaceholder="Search parties..."
                                />
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="date"
                            render={({ field }) => (
                              <FormItem labelPosition="top" className="min-w-0">
                                <FormLabel className="text-base">
                                  Date
                                  <span className="text-destructive"> *</span>
                                </FormLabel>
                                <FormControl>
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button
                                        variant="outline"
                                        className={cn(
                                          'w-full justify-start text-left font-normal min-w-0',
                                          !field.value &&
                                            'text-muted-foreground',
                                        )}
                                      >
                                        <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                                        {field.value ? (
                                          format(field.value, 'PPP')
                                        ) : (
                                          <span>Pick a date</span>
                                        )}
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                      <Calendar
                                        {...field}
                                        mode="single"
                                        selected={
                                          field.value
                                            ? new Date(field.value)
                                            : undefined
                                        }
                                        onSelect={onDateSelection}
                                        initialFocus
                                      />
                                    </PopoverContent>
                                  </Popover>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="biltyNumber"
                            render={({ field }) => (
                              <FormItem
                                labelPosition="top"
                                className="min-w-0 space-y-1.5"
                              >
                                <FormLabel className="text-base">
                                  Bilty Number
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="Bilty"
                                    className="w-full"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="cartons"
                            render={({ field }) => (
                              <FormItem
                                labelPosition="top"
                                className="min-w-0 space-y-1.5"
                              >
                                <FormLabel className="text-base">
                                  Cartons
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type="number"
                                    step={1}
                                    min={0}
                                    placeholder="0"
                                    className="w-full"
                                    onBlur={(e) =>
                                      field.onChange(toNumber(e.target.value))
                                    }
                                    onChange={(e) =>
                                      field.onChange(toNumber(e.target.value))
                                    }
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        {singleAccountAutoDiscountOff && (
                          <div className="col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                            Auto discount off for selected customer.
                          </div>
                        )}
                      </>
                    )}
                    {isSingleAccountOrPurchase && !isSingleAccountSale && (
                      <>
                        <div
                          className="grid gap-3 col-span-2"
                          style={{
                            gridTemplateColumns: '2fr 1.2fr',
                          }}
                        >
                          <FormField
                            control={form.control}
                            name="accountMapping.singleAccountId"
                            render={({ field }) => (
                              <FormItem labelPosition="top" className="min-w-0">
                                <FormLabel className="text-base">
                                  {isSale ? 'Customer' : 'Vendor'}
                                  <span className="text-destructive"> *</span>
                                </FormLabel>
                                <VirtualSelect
                                  options={parties || []}
                                  value={field.value}
                                  onChange={(val) =>
                                    onAccountSelection(
                                      toString(val),
                                      field.onChange,
                                    )
                                  }
                                  placeholder="Select a party"
                                  searchPlaceholder="Search parties..."
                                />
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="date"
                            render={({ field }) => (
                              <FormItem labelPosition="top" className="min-w-0">
                                <FormLabel className="text-base">
                                  Date
                                  <span className="text-destructive"> *</span>
                                </FormLabel>
                                <FormControl>
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <Button
                                        variant="outline"
                                        className={cn(
                                          'w-full justify-start text-left font-normal min-w-0',
                                          !field.value &&
                                            'text-muted-foreground',
                                        )}
                                      >
                                        <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                                        {field.value ? (
                                          format(field.value, 'PPP')
                                        ) : (
                                          <span>Pick a date</span>
                                        )}
                                      </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                      <Calendar
                                        {...field}
                                        mode="single"
                                        selected={
                                          field.value
                                            ? new Date(field.value)
                                            : undefined
                                        }
                                        onSelect={onDateSelection}
                                        initialFocus
                                      />
                                    </PopoverContent>
                                  </Popover>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        {singleAccountAutoDiscountOff && (
                          <div className="col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                            Auto discount off for selected customer.
                          </div>
                        )}
                      </>
                    )}
                    {isSectionsView && (
                      <CustomerSectionsBlock
                        sections={sections}
                        activeSectionId={activeSectionId}
                        parties={parties || []}
                        getSectionLabel={getSectionLabel}
                        onAddSection={addSection}
                        onRemoveSection={removeSection}
                        onSetActiveSection={setActiveSectionId}
                        onSetSectionCustomer={setSectionCustomer}
                        sectionAutoDiscountOffCount={
                          sectionAutoDiscountOffCount
                        }
                      />
                    )}

                    {/* date, bilty, cartons row only for multi-account (sections) view */}
                    {isSectionsView && (
                      <div
                        className={cn(
                          'grid gap-4 col-span-2',
                          isSale ? 'grid-cols-3' : 'grid-cols-1',
                        )}
                      >
                        <FormField
                          control={form.control}
                          name="date"
                          render={({ field }) => (
                            <FormItem labelPosition="top">
                              <FormLabel className="text-base">
                                Date
                                <span className="text-destructive"> *</span>
                              </FormLabel>
                              <FormControl>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      className={cn(
                                        'w-full justify-start text-left font-normal',
                                        !field.value && 'text-muted-foreground',
                                      )}
                                    >
                                      <CalendarIcon className="mr-2 h-4 w-4" />
                                      {field.value ? (
                                        format(field.value, 'PPP')
                                      ) : (
                                        <span>Pick a date</span>
                                      )}
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0">
                                    <Calendar
                                      {...field}
                                      mode="single"
                                      selected={
                                        field.value
                                          ? new Date(field.value)
                                          : undefined
                                      }
                                      onSelect={onDateSelection}
                                      initialFocus
                                    />
                                  </PopoverContent>
                                </Popover>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {isSale && (
                          <>
                            <FormField
                              control={form.control}
                              name="biltyNumber"
                              render={({ field }) => (
                                <FormItem
                                  labelPosition="top"
                                  className="space-y-1"
                                >
                                  <FormLabel className="text-base">
                                    Bilty Number
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      placeholder="Enter bilty number"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="cartons"
                              render={({ field }) => (
                                <FormItem
                                  labelPosition="top"
                                  className="space-y-1"
                                >
                                  <FormLabel className="text-base">
                                    Cartons
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      type="number"
                                      step={1}
                                      min={0}
                                      placeholder="Number of cartons"
                                      onBlur={(e) =>
                                        field.onChange(toNumber(e.target.value))
                                      }
                                      onChange={(e) =>
                                        field.onChange(toNumber(e.target.value))
                                      }
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <div className="flex flex-col gap-4 mt-8">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Line items
                </h2>
                {invoiceType === InvoiceType.Sale &&
                  useSingleAccount &&
                  splitByItemType &&
                  resolutionFallbacks.length > 0 && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                      Account(s) not found:{' '}
                      {[
                        ...new Set(
                          resolutionFallbacks.map(
                            (f) => f.expectedSuffixedName,
                          ),
                        ),
                      ].join(', ')}
                      . These rows use the selected party. Create the account in
                      another window and click <strong>Refresh accounts</strong>{' '}
                      to link.
                    </div>
                  )}
                <DataTable
                  columns={columns}
                  data={fields}
                  sortingFns={defaultSortingFunctions}
                  infoData={tableInfoData}
                />
                {form.formState.errors.invoiceItems && (
                  <p className="text-sm font-medium text-destructive">
                    {get(form.formState.errors.invoiceItems, 'message', null)}
                  </p>
                )}
              </div>

              <div className="flex justify-between gap-6 pb-6">
                <Button
                  type="button"
                  variant="default"
                  className="gap-2 px-6 py-3 min-h-[44px] rounded-lg"
                  onClick={() => handleAddNewRow()}
                >
                  <Plus size={20} />
                  <span className="w-max">Add New Item</span>
                </Button>
                <div
                  className={`flex flex-row gap-4 ${
                    invoiceType === InvoiceType.Sale ? 'hidden' : ''
                  }`}
                >
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      document
                        .getElementById('uploadInvoiceItemsInput')
                        ?.click()
                    }
                  >
                    <Upload size={16} className="mr-2" />
                    Upload Invoice Items
                  </Button>
                  <Input
                    id="uploadInvoiceItemsInput"
                    type="file"
                    accept=".xlsx, .xls"
                    className="hidden"
                    onChange={uploadInvoiceItems}
                  />
                </div>
              </div>

              <div className="flex justify-between items-center gap-4 pt-6 mt-2 border-t border-border min-h-[44px]">
                <div className="flex gap-3 flex-wrap">
                  <Button
                    type="submit"
                    variant="default"
                    disabled={isSubmitDisabled}
                    className="min-h-[44px]"
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitDisabled}
                    className="min-h-[44px]"
                    onClick={() => {
                      openPrintAfterSaveRef.current = true;
                      form.handleSubmit(onSubmit)();
                    }}
                  >
                    <Printer size={16} className="mr-2" />
                    Save and Print
                  </Button>
                  <Button type="reset" variant="ghost" className="min-h-[44px]">
                    Clear
                  </Button>
                </div>

                <Button
                  variant="secondary"
                  className="min-h-[44px]"
                  onClick={() => {
                    form.reset(defaultFormValues);
                    setIsDateExplicitlySet(false);
                    setSections([]);
                    setActiveSectionId(null);
                    setRowSectionMap({});
                    navigate(-1);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        )}
      </div>
    </>
  );
};

export default NewInvoicePage;
