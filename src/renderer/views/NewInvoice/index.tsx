/* eslint-disable react/no-unstable-nested-components */
import { get, isNil, pick, toNumber, toString } from 'lodash';
import { Plus, Printer, RefreshCw, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useFormState, useWatch } from 'react-hook-form';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  cn,
  defaultSortingFunctions,
  getFormattedCurrency,
  raise,
} from 'renderer/lib/utils';
import { Button } from 'renderer/shad/ui/button';
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
import { toast } from 'renderer/shad/ui/use-toast';
import { type Account, type InventoryItem, InvoiceType } from 'types';
import { z } from 'zod';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Label } from '@/renderer/shad/ui/label';
import { computeInvoiceItemTotal } from '@/renderer/lib/invoiceUtils';
import { toastContentFromInvoiceSaveError } from '@/renderer/lib/ipcUserMessage';
import { convertFileToJson } from '@/renderer/lib/lib';
import {
  checkParsedItemsAvailability,
  parseInvoiceItems,
} from '@/renderer/lib/parser';
import {
  ConfirmDialog,
  type ConfirmDialogConfig,
} from '@/renderer/components/ConfirmDialog';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { toLocalNoonIsoString } from '@/renderer/lib/localDate';
import {
  restoreSingleAccountIdFromSections,
  shouldWarnWhenTurningSplitLedgerOff,
} from '@/renderer/views/NewInvoice/lib/invoiceAccountMappingGuard';
import {
  buildTypingAndDetectSplitOffMismatches,
  formatSplitOffMismatchToast,
} from '@/renderer/views/NewInvoice/lib/invoiceSplitOffTypeWarnings';
import { buildCustomerVendorSelectOptions } from '@/renderer/views/NewInvoice/lib/invoicePartySelect';
import { AddInvoiceNumber } from './components/addInvoiceNumber';
import { CustomerSectionsBlock } from './components/CustomerSectionsBlock';
import { DateConfirmationDialog } from './components/DateConfirmationDialog';
import { InvoiceDateFormField } from './components/InvoiceDateFormField';
import { handleInvoiceFormEnterKeyDown } from './lib/invoiceFormEnter';
import {
  scheduleDateFieldFocusAfterPartySelect,
  scheduleQuantityFocusAfterItemSelect,
} from './lib/invoiceFormFocus';
import { useNewInvoiceColumns } from './hooks/useNewInvoiceColumns';
import { useNewInvoiceDiscounts } from './hooks/useNewInvoiceDiscounts';
import { useNewInvoiceFormCore } from './hooks/useNewInvoiceFormCore';
import {
  lineInventoryIdsKeyFromIds,
  useInvoiceInventoryLoader,
} from './hooks/useNewInvoiceInventory';
import { useEditInvoiceHydration } from './hooks/useEditInvoiceHydration';
import { useInvoiceDateValidation } from './hooks/useInvoiceDateValidation';
import { useNewInvoiceNextNumber } from './hooks/useNewInvoiceNextNumber';
import { useNewInvoiceParties } from './hooks/useNewInvoiceParties';
import { useNewInvoiceResolution } from './hooks/useNewInvoiceResolution';
import { useNewInvoiceSections } from './hooks/useNewInvoiceSections';
import { useNewInvoiceTableInfo } from './hooks/useNewInvoiceTableInfo';
import type { PartyAccount } from './hooks/useNewInvoiceParties';

interface NewInvoiceProps {
  invoiceType: InvoiceType;
}

// TODO: improve performance, check states: remove unnecessary data
const NewInvoicePage: React.FC<NewInvoiceProps> = ({
  invoiceType,
}: NewInvoiceProps) => {
  console.log('NewInvoicePage', invoiceType);
  const params = useParams<{ id: string }>();
  const location = useLocation();
  const isPostedInvoiceEditPath = useMemo(
    () =>
      location.pathname.includes('/invoices/') &&
      location.pathname.includes('/edit'),
    [location.pathname],
  );
  const editInvoiceId = useMemo(() => {
    if (!isPostedInvoiceEditPath) return undefined;
    const n = toNumber(params.id);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [isPostedInvoiceEditPath, params.id]);

  const [isEditingQuotation, setIsEditingQuotation] = useState(false);
  const isQuotationFlowRef = useRef(false);
  isQuotationFlowRef.current = isEditingQuotation;
  const submitSaveKindRef = useRef<'invoice' | 'quotation'>('invoice');

  const newInvoicePageHeading = useMemo(() => {
    if (editInvoiceId != null && isEditingQuotation) {
      return `Edit ${
        invoiceType === InvoiceType.Sale ? 'sale' : 'purchase'
      } quotation`;
    }
    if (editInvoiceId != null) return `Edit ${invoiceType} Invoice`;
    return `New ${invoiceType} Invoice`;
  }, [editInvoiceId, invoiceType, isEditingQuotation]);

  const primarySubmitLabel = useMemo(() => {
    if (editInvoiceId != null && isEditingQuotation) return 'Update quotation';
    return 'Save';
  }, [editInvoiceId, isEditingQuotation]);

  const saleStockValidationBonusRef = useRef<Record<number, number>>({});
  const [editHydrated, setEditHydrated] = useState(false);

  const [inventory, setInventory] = useState<InventoryItem[] | undefined>();
  const [nextInvoiceNumber, setNextInvoiceNumber] = useNewInvoiceNextNumber(
    invoiceType,
    editInvoiceId == null,
  );
  const {
    parties,
    partiesIncludingTyped,
    requiredAccountsExist,
    isRefreshingParties,
    refreshParties,
  } = useNewInvoiceParties(invoiceType);

  const [missingPartyForSelect, setMissingPartyForSelect] = useState<
    PartyAccount | undefined
  >();

  const [useSingleAccount, setUseSingleAccount] = useState(true);
  const useSingleAccountRef = useRef(useSingleAccount);
  useSingleAccountRef.current = useSingleAccount;
  const [splitByItemType, setSplitByItemType] = useState(true);
  const splitByItemTypeRef = useRef(splitByItemType);
  splitByItemTypeRef.current = splitByItemType;
  const [, setIsPrimaryItemTypeMissing] = useState(false);
  const primaryItemTypeWarnedRef = useRef(false);
  const splitOffMismatchSigRef = useRef<string>('');

  const [isDateExplicitlySet, setIsDateExplicitlySet] = useState(false);
  const [showDateConfirmation, setShowDateConfirmation] = useState(false);
  const [pendingConfirm, setPendingConfirm] =
    useState<ConfirmDialogConfig | null>(null);
  const dateConfirmedInModalRef = useRef(false);
  const openPrintAfterSaveRef = useRef(false);

  const formCore = useNewInvoiceFormCore({
    invoiceType,
    inventory,
    useSingleAccountRef,
    splitByItemTypeRef,
    splitByItemType,
    saleStockValidationBonusRef,
    isQuotationFlowRef,
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

  const lineInventoryIdsKey = useMemo(
    () =>
      lineInventoryIdsKeyFromIds(
        (watchedInvoiceItems ?? [])
          .map((row) => toNumber(row?.inventoryId))
          .filter((id) => id > 0),
      ),
    [watchedInvoiceItems],
  );

  useInvoiceInventoryLoader(invoiceType, lineInventoryIdsKey, setInventory);

  const { isDirty, errors: formErrors } = useFormState({
    control: form.control,
  });

  const accountMappingErrorMessage = useMemo(() => {
    const msg =
      get(formErrors, 'accountMapping.message') ??
      get(formErrors, 'accountMapping.multipleAccountIds.message') ??
      get(formErrors, 'accountMapping.singleAccountId.message');
    return typeof msg === 'string' && msg.length > 0 ? msg : undefined;
  }, [formErrors]);

  const editHeadingInvoiceNumber = useWatch({
    control: form.control,
    name: 'invoiceNumber',
  });

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

  const { resolvedRowLabels, resolvedRowCodes, resolutionFallbacks } =
    useNewInvoiceResolution({
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

  // sale split-by-type needs a primary item type for typed ledgers; warn once if it is missing and reset flags when mode is off
  useEffect(() => {
    if (
      invoiceType !== InvoiceType.Sale ||
      !useSingleAccount ||
      !splitByItemType
    ) {
      setIsPrimaryItemTypeMissing(false);
      primaryItemTypeWarnedRef.current = false;
      return;
    }

    let cancelled = false;
    window.electron
      .getPrimaryItemType?.()
      .then((primaryId) => {
        if (cancelled) return;
        const missing = primaryId == null;
        setIsPrimaryItemTypeMissing(missing);
        if (missing && !primaryItemTypeWarnedRef.current) {
          primaryItemTypeWarnedRef.current = true;
          toast({
            duration: 12000,
            variant: 'warning',
            description:
              "Primary item type is not set. Split-by-type won't post to typed ledgers until you set it in Inventory → Manage Item Types.",
          });
        }
      })
      .catch((error) => {
        console.error('Error fetching primary item type:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [invoiceType, splitByItemType, useSingleAccount]);

  // sale + single account + split off: warn when header account typing vs line item types mismatch
  useEffect(() => {
    if (
      invoiceType !== InvoiceType.Sale ||
      !useSingleAccount ||
      splitByItemType
    ) {
      splitOffMismatchSigRef.current = '';
      return undefined;
    }
    const singleId = toNumber(watchedSingleAccountId);
    if (singleId <= 0) {
      splitOffMismatchSigRef.current = '';
      return undefined;
    }
    if (!inventory?.length) return undefined;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      (async () => {
        try {
          const [allAccountsRaw, itemTypes, primaryRaw] = await Promise.all([
            window.electron.getAccounts() as Promise<Account[]>,
            window.electron.getItemTypes?.() ?? Promise.resolve([]),
            window.electron.getPrimaryItemType?.().catch(() => undefined),
          ]);
          if (cancelled) return;

          const headerAccount = allAccountsRaw.find(
            (a) => toNumber(a.id) === singleId,
          );
          if (!headerAccount) return;

          const latestRows = form.getValues('invoiceItems') as Array<{
            inventoryId?: number;
          }>;

          const primaryId =
            primaryRaw != null && Number.isFinite(toNumber(primaryRaw))
              ? toNumber(primaryRaw)
              : undefined;

          const mismatches = buildTypingAndDetectSplitOffMismatches(
            latestRows,
            inventory,
            itemTypes,
            headerAccount,
            allAccountsRaw,
            primaryId,
          );

          if (cancelled) return;

          if (mismatches.length === 0) {
            splitOffMismatchSigRef.current = '';
            return;
          }

          const key = `${singleId}:${mismatches
            .map((m) => `${m.rowIndex}:${m.kind}`)
            .join(',')}`;
          if (splitOffMismatchSigRef.current === key) return;
          splitOffMismatchSigRef.current = key;

          toast({
            variant: 'warning',
            duration: 12000,
            description: formatSplitOffMismatchToast(mismatches),
          });
        } catch {
          if (!cancelled) splitOffMismatchSigRef.current = '';
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    invoiceType,
    useSingleAccount,
    splitByItemType,
    watchedSingleAccountId,
    watchedInvoiceItems,
    inventory,
    form,
  ]);

  // derived layout flags
  const isSale = invoiceType === InvoiceType.Sale;
  const isPurchase = invoiceType === InvoiceType.Purchase;
  const isSingleAccountSale = useSingleAccount && isSale;
  const isSingleAccountOrPurchase = useSingleAccount || isPurchase;
  const isSectionsView = !isSingleAccountOrPurchase;

  const navigate = useNavigate();

  const showAddInvoiceNumberGate = false;

  const showInvoiceForm = editInvoiceId == null || editHydrated;

  useEditInvoiceHydration({
    invoiceType,
    editInvoiceId,
    form,
    setUseSingleAccount,
    setSplitByItemType,
    setNextInvoiceNumber,
    setIsDateExplicitlySet,
    setEditHydrated,
    setIsEditingQuotation,
    navigate,
    saleStockValidationBonusRef,
  });

  // typed/suffixed accounts are omitted from parties; invoice header id may still reference them, so load that row for VirtualSelect label matching
  useEffect(() => {
    let cancelled = false;
    const sid = toNumber(watchedSingleAccountId);
    if (editInvoiceId == null || sid <= 0) {
      setMissingPartyForSelect(undefined);
      return () => {
        cancelled = true;
      };
    }
    if (parties === undefined) {
      return () => {
        cancelled = true;
      };
    }
    if (parties.some((p) => toNumber(p.id) === sid)) {
      setMissingPartyForSelect(undefined);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const all = (await window.electron.getAccounts()) as Account[];
        if (cancelled) return;
        const acc = all.find((a) => toNumber(a.id) === sid);
        if (!acc) {
          setMissingPartyForSelect(undefined);
          return;
        }
        setMissingPartyForSelect(
          pick(acc, [
            'id',
            'name',
            'type',
            'code',
            'chartId',
            'discountProfileId',
            'discountProfileIsActive',
          ]) as PartyAccount,
        );
      } catch {
        if (!cancelled) setMissingPartyForSelect(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editInvoiceId, parties, watchedSingleAccountId]);

  const customerVendorSelectOptions = useMemo(
    () =>
      buildCustomerVendorSelectOptions({
        invoiceType,
        baseParties: parties ?? [],
        extendedParties: partiesIncludingTyped ?? [],
        useSingleAccount,
        splitByItemType,
        singleAccountId: toNumber(watchedSingleAccountId),
        missingExtra: missingPartyForSelect,
      }),
    [
      invoiceType,
      missingPartyForSelect,
      parties,
      partiesIncludingTyped,
      splitByItemType,
      useSingleAccount,
      watchedSingleAccountId,
    ],
  );

  const onSplitByItemTypeCheckedChange = useCallback(
    (checked: boolean | 'indeterminate') => {
      if (checked === true) {
        setSplitByItemType(true);
        return;
      }
      if (checked === false) {
        if (
          shouldWarnWhenTurningSplitLedgerOff(
            form.getValues('accountMapping.singleAccountId'),
            form.getValues('accountMapping.multipleAccountIds'),
          )
        ) {
          setPendingConfirm({
            title: 'Turn off split ledger?',
            description:
              'Turning off split will save all line items to the single customer account above. Per-row typed ledgers will not be used.',
            confirmLabel: 'Continue',
            onConfirm: () => setSplitByItemType(false),
          });
          return;
        }
        setSplitByItemType(false);
      }
    },
    [form],
  );

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

  // extra discount requires a credit account: clear the field when discount is zero; when discount is on and options load, pick the first valid account if none selected
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

  // keep form totalAmount aligned with line items: sum per-section amounts (rounded per section), optional cumulative discount path, minus extra discount — matches what we post and show
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
      } else {
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
      }

      scheduleQuantityFocusAfterItemSelect(form, rowIndex);
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
      scheduleDateFieldFocusAfterPartySelect(form);
    },
    [form, invoiceType, recalculateAutoDiscounts],
  );

  const columnsParams = useMemo(
    () => ({
      form: { control: form.control, getValues: form.getValues },
      inventory,
      invoiceType,
      resolvedRowLabels,
      resolvedRowCodes,
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
      saleStockValidationBonusRef,
    }),
    [
      form.control,
      form.getValues,
      inventory,
      invoiceType,
      resolvedRowLabels,
      resolvedRowCodes,
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
      saleStockValidationBonusRef,
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

  const submitDisabledReason = useMemo((): string | undefined => {
    if (form.formState.isSubmitting) {
      return 'Saving invoice...';
    }
    if (
      useSingleAccount &&
      (watchedSingleAccountId == null || watchedSingleAccountId <= 0)
    ) {
      const partyLabel =
        invoiceType === InvoiceType.Sale ? 'customer' : 'vendor';
      return `Select a ${partyLabel}`;
    }

    const total = watchedTotalAmount;
    if (
      invoiceType === InvoiceType.Sale &&
      (typeof total !== 'number' || total <= 0)
    ) {
      return 'Invoice total must be greater than 0';
    }
    if (
      invoiceType === InvoiceType.Purchase &&
      typeof total === 'number' &&
      total < 0
    ) {
      return 'Invoice total must not be negative';
    }

    if (invoiceType === InvoiceType.Sale && !useSingleAccount) {
      const multipleAccountIds = watchedMultipleAccountIds || [];
      if (!multipleAccountIds.length) {
        return 'Add at least one customer section';
      }
      if (multipleAccountIds.some((id) => id <= 0)) {
        return 'Select a customer for each section';
      }
    }
    return undefined;
  }, [
    form,
    invoiceType,
    useSingleAccount,
    watchedMultipleAccountIds,
    watchedSingleAccountId,
    watchedTotalAmount,
  ]);

  const postedNextNumberBlocked = useMemo(
    () =>
      editInvoiceId == null &&
      (isNil(nextInvoiceNumber) || toNumber(nextInvoiceNumber) < 1),
    [editInvoiceId, nextInvoiceNumber],
  );

  const isSubmitDisabled = submitDisabledReason != null;

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
      const showPostSaveToast = () => {
        toast({
          variant: 'success',
          description: `${invoiceType} invoice ${
            editInvoiceId != null ? 'updated' : 'saved successfully'
          }`,
        });
      };
      if (editInvoiceId != null && isEditingQuotation) {
        const invoice = {
          ...values,
          invoiceNumber: values.invoiceNumber,
        };
        await window.electron.updateQuotation(editInvoiceId, invoice);
        toast({
          variant: 'success',
          description: 'Quotation updated.',
        });
        return editInvoiceId;
      }

      if (editInvoiceId != null) {
        const invoice = {
          ...values,
          invoiceNumber: values.invoiceNumber,
        };
        await window.electron.updateInvoice(
          invoiceType,
          editInvoiceId,
          invoice,
        );
        showPostSaveToast();
        return editInvoiceId;
      }

      if (submitSaveKindRef.current === 'quotation') {
        const invoice = {
          ...values,
          invoiceNumber: -1,
        };
        const result = (await window.electron.insertQuotation(
          invoiceType,
          invoice,
        )) as { invoiceId: number };
        if (result.invoiceId > 0) {
          toast({
            variant: 'success',
            description: 'Quotation saved.',
          });
        }
        return result.invoiceId > 0 ? result.invoiceId : undefined;
      }

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
        if (result.invoiceId > 0) showPostSaveToast();
        return result.invoiceId > 0 ? result.invoiceId : undefined;
      }
      raise(`Failed to save ${invoiceType} invoice`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      const raw = error instanceof Error ? error.message : toString(error);
      const { title, description } = toastContentFromInvoiceSaveError(raw, {
        mode: editInvoiceId != null ? 'update' : 'create',
      });
      toast({
        title,
        description,
        variant: 'destructive',
      });
    }
    return undefined;
  };

  const { validateInvoiceDateAgainstParties } = useInvoiceDateValidation({
    invoiceType,
    editInvoiceId,
    useSingleAccount,
    splitByItemType,
    formSchema,
  });

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
      if (invoiceId != null) {
        if (openPrintAfterSaveRef.current) {
          openPrintAfterSaveRef.current = false;
          navigate(`/invoices/${invoiceId}/print`);
          return;
        }
        navigate(`/${invoiceType.toLowerCase()}/invoices/${invoiceId}`);
      }
      return;
    }

    if (!isDateExplicitlySet) {
      setShowDateConfirmation(true);
      return;
    }

    const invoiceId = await submitInvoice(values);
    if (invoiceId == null) return;

    if (openPrintAfterSaveRef.current) {
      openPrintAfterSaveRef.current = false;
      navigate(`/invoices/${invoiceId}/print`);
      return;
    }
    navigate(`/${invoiceType.toLowerCase()}/invoices/${invoiceId}`);
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

  const onInvoiceNumberSet = (invoiceNumber: number) =>
    setNextInvoiceNumber(invoiceNumber);

  const onDateSelection = useCallback(
    (date?: Date) => {
      if (!date) return;
      // date picker gives a day; store it as an ISO instant at local noon to avoid timezone shifts
      // (e.g., ISO midnight UTC can display as previous day in negative timezones).
      form.setValue('date', toLocalNoonIsoString(date));
      setIsDateExplicitlySet(true);
    },
    [form],
  );

  const onSingleAccountToggle = useCallback(
    (isChecked: boolean) => {
      setUseSingleAccount(isChecked);
      // clear the appropriate account mapping fields based on the toggle
      if (isChecked) {
        const restored = restoreSingleAccountIdFromSections(
          sections,
          activeSectionId,
        );
        if (restored != null) {
          form.setValue('accountMapping.singleAccountId', restored, {
            shouldValidate: false,
          });
        }
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
      activeSectionId,
      applyAutoDiscountForRow,
      form,
      invoiceType,
      sections,
      setActiveSectionId,
      setRowSectionMap,
      setSections,
    ],
  );

  const onUseSingleAccountCheckedChange = useCallback(
    (checked: boolean | 'indeterminate') => {
      if (checked === 'indeterminate') return;
      if (checked === false) {
        if (invoiceType === InvoiceType.Sale && splitByItemTypeRef.current) {
          if (
            shouldWarnWhenTurningSplitLedgerOff(
              form.getValues('accountMapping.singleAccountId'),
              form.getValues('accountMapping.multipleAccountIds'),
            )
          ) {
            setPendingConfirm({
              title: 'Switch to multiple customers?',
              description:
                'Switching to multiple customers will drop per-row ledger accounts from split-by-type. Assign customers per section instead.',
              confirmLabel: 'Continue',
              onConfirm: () => onSingleAccountToggle(false),
            });
            return;
          }
        }
      }
      onSingleAccountToggle(checked);
    },
    [form, invoiceType, onSingleAccountToggle],
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
      scheduleDateFieldFocusAfterPartySelect(form);
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
          form.setValue('date', toLocalNoonIsoString(new Date()));
          dateConfirmedInModalRef.current = true;
          form.handleSubmit(onSubmit)();
        }}
      />

      <ConfirmDialog
        open={pendingConfirm != null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
        title={pendingConfirm?.title ?? ''}
        description={pendingConfirm?.description ?? ''}
        confirmLabel={pendingConfirm?.confirmLabel}
        cancelLabel={pendingConfirm?.cancelLabel}
        confirmVariant={pendingConfirm?.confirmVariant}
        onConfirm={() => {
          pendingConfirm?.onConfirm();
        }}
      />

      <div className="py-1 flex flex-col gap-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {editInvoiceId != null && isEditingQuotation ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const back = () =>
                    navigate(
                      `/${invoiceType.toLowerCase()}/invoices/${editInvoiceId}`,
                    );
                  if (isDirty) {
                    setPendingConfirm({
                      title: 'Discard unsaved changes?',
                      description:
                        'Discard unsaved changes and return to the quotation?',
                      confirmLabel: 'Discard',
                      confirmVariant: 'destructive',
                      onConfirm: back,
                    });
                    return;
                  }
                  back();
                }}
              >
                Back to quotation
              </Button>
            ) : null}
            {editInvoiceId != null && !isEditingQuotation ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (isDirty) {
                    setPendingConfirm({
                      title: 'Discard unsaved changes?',
                      description:
                        'Discard unsaved changes and return to the invoice?',
                      confirmLabel: 'Discard',
                      confirmVariant: 'destructive',
                      onConfirm: () =>
                        navigate(
                          `/${invoiceType.toLowerCase()}/invoices/${editInvoiceId}`,
                        ),
                    });
                    return;
                  }
                  navigate(
                    `/${invoiceType.toLowerCase()}/invoices/${editInvoiceId}`,
                  );
                }}
              >
                Back to invoice
              </Button>
            ) : null}
            <h1 className="title-new flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span>{newInvoicePageHeading}</span>
              {editInvoiceId != null &&
              toNumber(editHeadingInvoiceNumber) > 0 ? (
                <span className="text-lg font-normal text-muted-foreground">
                  #{editHeadingInvoiceNumber}
                </span>
              ) : null}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {invoiceType === InvoiceType.Sale && showInvoiceForm && (
              <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2 min-h-[44px]">
                  <Checkbox
                    id="useSingleAccount"
                    checked={useSingleAccount}
                    onCheckedChange={onUseSingleAccountCheckedChange}
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
                      onCheckedChange={onSplitByItemTypeCheckedChange}
                    />
                    <Label
                      htmlFor="splitByItemType"
                      className="cursor-pointer select-none"
                    >
                      Split ledger by item type
                    </Label>
                  </div>
                )}
                {accountMappingErrorMessage ? (
                  <div className="w-full min-w-0">
                    <p
                      role="alert"
                      className="text-sm font-medium text-destructive"
                    >
                      {accountMappingErrorMessage}
                    </p>
                  </div>
                ) : null}
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

        {showAddInvoiceNumberGate ? (
          <AddInvoiceNumber
            invoiceType={invoiceType}
            onInvoiceNumberSet={onInvoiceNumberSet}
          />
        ) : null}
        {!showAddInvoiceNumberGate && showInvoiceForm ? (
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
              onKeyDown={handleInvoiceFormEnterKeyDown}
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
                                  options={customerVendorSelectOptions}
                                  value={field.value}
                                  onChange={(val) =>
                                    onAccountSelection(
                                      toString(val),
                                      field.onChange,
                                    )
                                  }
                                  placeholder="Select a party"
                                  searchPlaceholder="Search parties..."
                                  autoFocusTrigger={editInvoiceId == null}
                                />
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="date"
                            render={({ field }) => (
                              <InvoiceDateFormField
                                field={field}
                                onDateSelection={onDateSelection}
                                formItemClassName="min-w-0"
                                buttonClassName={cn(
                                  'w-full justify-start text-left font-normal min-w-0',
                                  !field.value && 'text-muted-foreground',
                                )}
                              />
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
                                  options={customerVendorSelectOptions}
                                  value={field.value}
                                  onChange={(val) =>
                                    onAccountSelection(
                                      toString(val),
                                      field.onChange,
                                    )
                                  }
                                  placeholder="Select a party"
                                  searchPlaceholder="Search parties..."
                                  autoFocusTrigger={editInvoiceId == null}
                                />
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="date"
                            render={({ field }) => (
                              <InvoiceDateFormField
                                field={field}
                                onDateSelection={onDateSelection}
                                formItemClassName="min-w-0"
                                buttonClassName={cn(
                                  'w-full justify-start text-left font-normal min-w-0',
                                  !field.value && 'text-muted-foreground',
                                )}
                              />
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
                        parties={partiesIncludingTyped ?? parties ?? []}
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
                            <InvoiceDateFormField
                              field={field}
                              onDateSelection={onDateSelection}
                              buttonClassName={cn(
                                'w-full justify-start text-left font-normal',
                                !field.value && 'text-muted-foreground',
                              )}
                              calendarIconClassName="mr-2 h-4 w-4"
                            />
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
                <h2 className="text-sm font-medium text-muted-foreground w-max mb-1">
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
                  compact
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
                    type="button"
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
                  <div>
                    <Button
                      type="button"
                      variant="default"
                      disabled={
                        isSubmitDisabled ||
                        (editInvoiceId == null && postedNextNumberBlocked)
                      }
                      className="min-h-[44px]"
                      title={
                        postedNextNumberBlocked && editInvoiceId == null
                          ? 'Loading next invoice number…'
                          : submitDisabledReason ?? ''
                      }
                      onClick={() => {
                        submitSaveKindRef.current = 'invoice';
                        form.handleSubmit(onSubmit)();
                      }}
                    >
                      {primarySubmitLabel}
                    </Button>
                    {postedNextNumberBlocked && editInvoiceId == null ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Loading next invoice number for posted save…
                      </p>
                    ) : null}
                  </div>
                  {editInvoiceId == null ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSubmitDisabled}
                      className="min-h-[44px]"
                      onClick={() => {
                        submitSaveKindRef.current = 'quotation';
                        form.handleSubmit(onSubmit)();
                      }}
                    >
                      Save as quotation
                    </Button>
                  ) : null}
                  {editInvoiceId == null ||
                  (editInvoiceId != null && !isEditingQuotation) ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSubmitDisabled || postedNextNumberBlocked}
                      className="min-h-[44px]"
                      onClick={() => {
                        submitSaveKindRef.current = 'invoice';
                        openPrintAfterSaveRef.current = true;
                        form.handleSubmit(onSubmit)();
                      }}
                    >
                      <Printer size={16} className="mr-2" />
                      Save and Print
                    </Button>
                  ) : null}
                  <Button type="reset" variant="ghost" className="min-h-[44px]">
                    Clear
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-[44px]"
                  onClick={() => {
                    const leave = () => {
                      form.reset(defaultFormValues);
                      setIsDateExplicitlySet(false);
                      setSections([]);
                      setActiveSectionId(null);
                      setRowSectionMap({});
                      if (editInvoiceId != null) {
                        navigate(
                          `/${invoiceType.toLowerCase()}/invoices/${editInvoiceId}`,
                        );
                      } else {
                        navigate(-1);
                      }
                    };
                    if (isDirty) {
                      setPendingConfirm({
                        title: 'Leave this screen?',
                        description:
                          'Discard unsaved changes and leave this screen?',
                        confirmLabel: 'Discard',
                        confirmVariant: 'destructive',
                        onConfirm: leave,
                      });
                      return;
                    }
                    leave();
                  }}
                >
                  Cancel
                </Button>
              </div>

              {submitDisabledReason && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {submitDisabledReason}
                </p>
              )}
            </form>
          </Form>
        ) : null}
        {!showAddInvoiceNumberGate && !showInvoiceForm ? (
          <p className="text-muted-foreground py-8">Loading invoice…</p>
        ) : null}
      </div>
    </>
  );
};

export default NewInvoicePage;
