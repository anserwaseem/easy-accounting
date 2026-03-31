import { toNumber } from 'lodash';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { FF_INVOICE_DISCOUNT_EDIT_ENABLED } from 'renderer/lib/constants';
import { computeInvoiceItemTotal } from '@/renderer/lib/invoiceUtils';
import { InvoiceType } from 'types';
import type { CustomerSection } from '../components/CustomerSectionsBlock';
import type { PartyAccount } from './useNewInvoiceParties';

export interface UseNewInvoiceDiscountsParams {
  invoiceType: InvoiceType;
  form: UseFormReturn<Record<string, unknown>>;
  useSingleAccount: boolean;
  useSingleAccountRef: React.MutableRefObject<boolean>;
  splitByItemTypeRef: React.MutableRefObject<boolean>;
  parties: PartyAccount[] | undefined;
  sections: CustomerSection[];
  rowSectionMap: Record<number, string>;
  watchedSingleAccountId: unknown;
}

/** owns discount state (manual/cumulative) and auto-discount logic: getRowAccountId, applyAutoDiscountForRow, recalculateAutoDiscounts, section/party helpers */
export function useNewInvoiceDiscounts(params: UseNewInvoiceDiscountsParams): {
  getRowAccountId: (rowIndex: number) => number | undefined;
  applyAutoDiscountForRow: (
    rowIndex: number,
    inventoryId?: number,
    forcedAccountId?: number,
  ) => Promise<void>;
  recalculateAutoDiscounts: () => Promise<void>;
  recalculateAutoDiscountsRef: React.MutableRefObject<() => Promise<void>>;
  manualDiscountRows: Record<number, boolean>;
  setManualDiscountRows: React.Dispatch<
    React.SetStateAction<Record<number, boolean>>
  >;
  enableCumulativeDiscount: boolean;
  setEnableCumulativeDiscount: React.Dispatch<React.SetStateAction<boolean>>;
  cumulativeDiscount: number | undefined;
  setCumulativeDiscount: React.Dispatch<
    React.SetStateAction<number | undefined>
  >;
  isDiscountEditEnabled: boolean;
  singleAccountAutoDiscountOff: boolean;
  sectionAutoDiscountOffCount: number;
  getPartyById: (accountId?: number) => PartyAccount | undefined;
  isAutoDiscountOffForParty: (accountId?: number) => boolean;
  getSectionLabel: (section: CustomerSection, index: number) => string;
} {
  const {
    invoiceType,
    form,
    useSingleAccount,
    useSingleAccountRef,
    splitByItemTypeRef,
    parties,
    sections,
    rowSectionMap,
    watchedSingleAccountId,
  } = params;

  const [manualDiscountRows, setManualDiscountRows] = useState<
    Record<number, boolean>
  >({});
  const [enableCumulativeDiscount, setEnableCumulativeDiscount] =
    useState(false);
  const [cumulativeDiscount, setCumulativeDiscount] = useState<
    number | undefined
  >();

  const isDiscountEditEnabled = FF_INVOICE_DISCOUNT_EDIT_ENABLED;

  const getPartyById = useCallback(
    (accountId?: number) => parties?.find((party) => party.id === accountId),
    [parties],
  );

  const isAutoDiscountOffForParty = useCallback(
    (accountId?: number) => {
      const party = getPartyById(accountId);
      return Boolean(
        party?.discountProfileId && party.discountProfileIsActive === false,
      );
    },
    [getPartyById],
  );

  const getSectionLabel = useCallback(
    (section: CustomerSection, index: number) => {
      const party = parties?.find((p) => p.id === section.accountId);
      return party?.name ?? `Section ${index + 1}`;
    },
    [parties],
  );

  const singleAccountAutoDiscountOff = useMemo(
    () =>
      invoiceType === InvoiceType.Sale &&
      useSingleAccount &&
      isAutoDiscountOffForParty(toNumber(watchedSingleAccountId)),
    [
      invoiceType,
      isAutoDiscountOffForParty,
      useSingleAccount,
      watchedSingleAccountId,
    ],
  );

  const sectionAutoDiscountOffCount = useMemo(() => {
    if (invoiceType !== InvoiceType.Sale || useSingleAccount) {
      return 0;
    }
    const selectedIds = new Set(
      sections
        .map((section) => toNumber(section.accountId))
        .filter((accountId) => accountId > 0),
    );
    return Array.from(selectedIds).filter((accountId) =>
      isAutoDiscountOffForParty(accountId),
    ).length;
  }, [invoiceType, isAutoDiscountOffForParty, sections, useSingleAccount]);

  const getRowAccountId = useCallback(
    (rowIndex: number): number | undefined => {
      if (useSingleAccountRef.current) {
        if (invoiceType === InvoiceType.Sale && splitByItemTypeRef.current) {
          const ids =
            (form.getValues('accountMapping.multipleAccountIds') as number[]) ??
            [];
          const accountId = toNumber(ids[rowIndex]);
          return accountId > 0 ? accountId : undefined;
        }
        const accountId = toNumber(
          form.getValues('accountMapping.singleAccountId'),
        );
        return accountId > 0 ? accountId : undefined;
      }

      const item = form.getValues(`invoiceItems.${rowIndex}`) as
        | { id: number }
        | undefined;
      if (!item) return undefined;
      const sectionId = rowSectionMap[item.id];
      const section = sections.find((entry) => entry.id === sectionId);
      const accountId = toNumber(section?.accountId);
      if (accountId <= 0) return undefined;
      return accountId;
    },
    [
      form,
      invoiceType,
      rowSectionMap,
      sections,
      splitByItemTypeRef,
      useSingleAccountRef,
    ],
  );

  const applyAutoDiscountForRow = useCallback(
    async (
      rowIndex: number,
      inventoryId?: number,
      forcedAccountId?: number,
    ) => {
      if (invoiceType !== InvoiceType.Sale) return;

      const resolvedInventoryId = toNumber(
        inventoryId ?? form.getValues(`invoiceItems.${rowIndex}.inventoryId`),
      );
      const accountId = toNumber(forcedAccountId ?? getRowAccountId(rowIndex));
      let discount = 0;

      if (accountId > 0 && resolvedInventoryId > 0) {
        discount = await window.electron.getAutoDiscount(
          accountId,
          resolvedInventoryId,
        );
      }

      const setOpts = {
        shouldValidate: false,
        shouldDirty: true,
      };
      (form.setValue as (name: string, value: number, opts?: object) => void)(
        `invoiceItems.${rowIndex}.discount`,
        discount,
        setOpts,
      );
      const discountedPrice = computeInvoiceItemTotal(
        form.getValues(`invoiceItems.${rowIndex}.quantity`) as number,
        discount,
        form.getValues(`invoiceItems.${rowIndex}.price`) as number,
      );
      (form.setValue as (name: string, value: number, opts?: object) => void)(
        `invoiceItems.${rowIndex}.discountedPrice`,
        discountedPrice,
        setOpts,
      );
    },
    [form, getRowAccountId, invoiceType],
  );

  const recalculateAutoDiscounts = useCallback(async () => {
    if (invoiceType !== InvoiceType.Sale) return;

    const items = form.getValues('invoiceItems') as Array<{ id: number }>;
    for (let rowIndex = 0; rowIndex < items.length; rowIndex += 1) {
      const rowId = items[rowIndex].id;
      if (isDiscountEditEnabled && manualDiscountRows[rowId]) continue;
      // eslint-disable-next-line no-await-in-loop
      await applyAutoDiscountForRow(rowIndex);
    }
  }, [
    applyAutoDiscountForRow,
    form,
    isDiscountEditEnabled,
    invoiceType,
    manualDiscountRows,
  ]);

  const recalculateAutoDiscountsRef = useRef(recalculateAutoDiscounts);
  recalculateAutoDiscountsRef.current = recalculateAutoDiscounts;

  return {
    getRowAccountId,
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
    getPartyById,
    isAutoDiscountOffForParty,
    getSectionLabel,
  };
}
