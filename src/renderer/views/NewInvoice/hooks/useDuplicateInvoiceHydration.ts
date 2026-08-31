import { useEffect } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { InvoiceType } from 'types';
import type { InventoryItem, Invoice, InvoiceView } from 'types';

import { computeInvoiceItemTotal } from '@/renderer/lib/invoiceUtils';
import { toast } from 'renderer/shad/ui/use-toast';

import { getDefaultFormValues } from '../schema';
import { buildPrefillFromInvoiceView } from './useEditInvoiceHydration';

interface UseDuplicateInvoiceHydrationParams {
  invoiceType: InvoiceType;
  /** invoice id passed via router state {duplicateFromId}; undefined when not duplicating */
  duplicateFromId: number | undefined;
  form: UseFormReturn<Invoice>;
  setUseSingleAccount: (v: boolean) => void;
  setSplitByItemType: (v: boolean) => void;
  /** source was a quotation — the duplicate saves as a quotation of the same type */
  setDuplicateFromQuotation: (v: boolean) => void;
}

/**
 * prefills the new-invoice form from an existing invoice/quotation (Duplicate action).
 * reuses the edit-mode mapping (buildPrefillFromInvoiceView) for customer + items, but:
 * - invoice number is NOT copied (next number flow stays active as for any new invoice)
 * - prices are repriced from CURRENT inventory (quantities and discounts carry over)
 * - date, bilty, cartons and extra discount start fresh
 */
export const useDuplicateInvoiceHydration = ({
  invoiceType,
  duplicateFromId,
  form,
  setUseSingleAccount,
  setSplitByItemType,
  setDuplicateFromQuotation,
}: UseDuplicateInvoiceHydrationParams) => {
  // duplicate hydration effect: load source invoice, reprice, reset form
  useEffect(() => {
    if (duplicateFromId == null) {
      setDuplicateFromQuotation(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      const inv = (await window.electron.getInvoice(
        duplicateFromId,
      )) as InvoiceView;
      if (cancelled) return;
      if (inv.invoiceType !== invoiceType) {
        toast({
          variant: 'destructive',
          description: 'Invoice type does not match this screen.',
        });
        return;
      }

      const prefill = buildPrefillFromInvoiceView(invoiceType, inv);

      // reprice at current inventory prices — old prices are intentionally dropped
      const rawInventory = (await window.electron.getInventory()) as
        | InventoryItem[]
        | undefined;
      if (cancelled) return;
      const priceByInventoryId = new Map<number, number>(
        (rawInventory ?? []).map((item) => [item.id, item.price]),
      );
      const repricedItems = prefill.lineItems.map((item) => {
        const currentPrice = priceByInventoryId.get(item.inventoryId) ?? 0;
        return {
          ...item,
          price: currentPrice,
          discountedPrice: computeInvoiceItemTotal(
            item.quantity,
            item.discount,
            currentPrice,
          ),
        };
      });

      setUseSingleAccount(prefill.useSingleAccount);
      setSplitByItemType(prefill.splitByItemType);
      setDuplicateFromQuotation(Boolean(inv.isQuotation));

      // fresh defaults (today's date, placeholder number, no bilty/cartons/extra discount)
      // + duplicated customer mapping and repriced line items
      form.reset({
        ...getDefaultFormValues(invoiceType),
        invoiceItems: repricedItems,
        accountMapping: prefill.accountMapping,
      });

      toast({
        description: `Duplicated ${
          inv.isQuotation ? 'quotation' : 'invoice'
        } — items repriced at current prices. Review and save.`,
      });
    })().catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Error duplicating invoice', error);
      toast({
        variant: 'destructive',
        description: 'Could not load the invoice to duplicate.',
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    duplicateFromId,
    form,
    invoiceType,
    setDuplicateFromQuotation,
    setSplitByItemType,
    setUseSingleAccount,
  ]);
};
