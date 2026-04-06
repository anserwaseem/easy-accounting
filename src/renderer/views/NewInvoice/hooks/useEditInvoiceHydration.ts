import { toNumber } from 'lodash';
import { useEffect } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { NavigateFunction } from 'react-router-dom';
import { InvoiceType } from 'types';
import type { Invoice, InvoiceView } from 'types';

import { computeInvoiceItemTotal } from '@/renderer/lib/invoiceUtils';
import { raise } from 'renderer/lib/utils';
import { toast } from 'renderer/shad/ui/use-toast';

interface UseEditInvoiceHydrationParams {
  invoiceType: InvoiceType;
  editInvoiceId: number | undefined;
  form: UseFormReturn<Invoice>;
  setUseSingleAccount: (v: boolean) => void;
  setSplitByItemType: (v: boolean) => void;
  setNextInvoiceNumber: (n: number | undefined) => void;
  setIsDateExplicitlySet: (v: boolean) => void;
  setEditHydrated: (v: boolean) => void;
  setIsEditingQuotation: (v: boolean) => void;
  navigate: NavigateFunction;
  saleStockValidationBonusRef: React.MutableRefObject<Record<number, number>>;
}

export const useEditInvoiceHydration = ({
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
}: UseEditInvoiceHydrationParams) => {
  useEffect(() => {
    // edit invoice hydration effect
    if (editInvoiceId == null) {
      setEditHydrated(false);
      setIsEditingQuotation(false);
      saleStockValidationBonusRef.current = {};
      return undefined;
    }

    let cancelled = false;
    (async () => {
      const inv = (await window.electron.getInvoice(
        editInvoiceId,
      )) as InvoiceView;
      if (cancelled) return;
      if (inv.invoiceType !== invoiceType) {
        toast({
          variant: 'destructive',
          description: 'Invoice type does not match this screen.',
        });
        navigate(`/${invoiceType.toLowerCase()}/invoices`);
        return;
      }

      if (inv.isReturned) {
        toast({
          variant: 'destructive',
          description: 'This invoice was returned and cannot be edited.',
        });
        navigate(`/${invoiceType.toLowerCase()}/invoices/${editInvoiceId}`);
        return;
      }

      const isQuotation = Boolean(inv.isQuotation);
      setIsEditingQuotation(isQuotation);

      if (!isQuotation) {
        const linkedJournals = (await window.electron.getJournalsByInvoiceId(
          editInvoiceId,
        )) as unknown[];
        if (cancelled) return;
        if (!linkedJournals?.length) {
          toast({
            variant: 'destructive',
            description:
              'This invoice has no linked journals and cannot be edited safely.',
          });
          navigate(`/${invoiceType.toLowerCase()}/invoices/${editInvoiceId}`);
          return;
        }
      }

      saleStockValidationBonusRef.current = {};
      if (invoiceType === InvoiceType.Sale) {
        inv.invoiceItems.forEach((it) => {
          const invId = it.inventoryId ?? 0;
          if (invId <= 0) return;
          saleStockValidationBonusRef.current[invId] =
            (saleStockValidationBonusRef.current[invId] ?? 0) + it.quantity;
        });
      }

      const headerAcct = inv.invoiceHeaderAccountId;
      const rowAccountIds: number[] = inv.invoiceItems.map((it): number => {
        if (it.accountId != null && it.accountId > 0) return it.accountId;
        return headerAcct != null && headerAcct > 0 ? headerAcct : -1;
      });
      const distinctRow = [...new Set(rowAccountIds.filter((id) => id > 0))];

      const lineItems = inv.invoiceItems.map((it, idx) => ({
        id: Date.now() + idx,
        inventoryId: it.inventoryId ?? 0,
        quantity: it.quantity,
        discount: it.discount,
        price: it.price,
        discountedPrice:
          it.discountedPrice ??
          computeInvoiceItemTotal(it.quantity, it.discount, it.price),
      }));

      let accountMapping: Invoice['accountMapping'];
      if (invoiceType === InvoiceType.Sale) {
        if (distinctRow.length > 1) {
          setUseSingleAccount(true);
          setSplitByItemType(true);
          const splitFallbackId = distinctRow[0];
          if (splitFallbackId == null || splitFallbackId <= 0) {
            raise('Invalid account on invoice line');
          }
          const singleForSplit =
            headerAcct != null && headerAcct > 0 ? headerAcct : splitFallbackId;
          accountMapping = {
            singleAccountId: singleForSplit,
            multipleAccountIds: rowAccountIds.map((id) =>
              id > 0 ? id : splitFallbackId,
            ),
          };
        } else {
          setUseSingleAccount(true);
          setSplitByItemType(false);
          accountMapping = {
            singleAccountId: distinctRow[0] ?? headerAcct,
            multipleAccountIds: [],
          };
        }
      } else if (distinctRow.length > 1) {
        setUseSingleAccount(false);
        setSplitByItemType(false);
        const purchaseLineFallbackId =
          headerAcct != null && headerAcct > 0
            ? headerAcct
            : raise('Invalid account on invoice line');
        accountMapping = {
          singleAccountId: undefined,
          multipleAccountIds: rowAccountIds.map((id) =>
            id > 0 ? id : purchaseLineFallbackId,
          ),
        };
      } else {
        setUseSingleAccount(true);
        setSplitByItemType(false);
        accountMapping = {
          singleAccountId: distinctRow[0] ?? headerAcct,
          multipleAccountIds: [],
        };
      }

      form.reset({
        id: inv.id,
        date: inv.date,
        invoiceNumber: inv.invoiceNumber,
        extraDiscount: toNumber(inv.extraDiscount) || 0,
        extraDiscountAccountId: inv.extraDiscountAccountId ?? undefined,
        totalAmount: toNumber(inv.totalAmount),
        invoiceItems: lineItems,
        invoiceType,
        biltyNumber: inv.biltyNumber != null ? String(inv.biltyNumber) : '',
        cartons: inv.cartons ?? 0,
        accountMapping,
      });

      setNextInvoiceNumber(inv.invoiceNumber);
      setIsDateExplicitlySet(true);
      setEditHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    editInvoiceId,
    form,
    invoiceType,
    navigate,
    saleStockValidationBonusRef,
    setEditHydrated,
    setIsEditingQuotation,
    setIsDateExplicitlySet,
    setNextInvoiceNumber,
    setSplitByItemType,
    setUseSingleAccount,
  ]);
};
