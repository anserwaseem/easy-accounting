import { pick } from 'lodash';
import { useEffect, useState } from 'react';
import type { InventoryItem } from 'types';
import { InvoiceType } from 'types';

const INVENTORY_PICK = [
  'id',
  'name',
  'price',
  'quantity',
  'description',
  'itemTypeId',
  'itemTypeName',
] as const;

function filterInventoryForInvoice(
  items: InventoryItem[],
  invoiceType: InvoiceType,
): InventoryItem[] {
  const picked = items.map((item) => pick(item, [...INVENTORY_PICK]));
  if (invoiceType === InvoiceType.Purchase) {
    // purchase: any qty (including 0); still require a positive price for line defaults
    return picked.filter((item) => item.price > 0);
  }
  // sale: only in-stock, priced items
  return picked.filter((item) => item.quantity > 0 && item.price > 0);
}

/** loads inventory; sale=in-stock+priced, purchase=priced only (no qty gate) */
export function useNewInvoiceInventory(
  invoiceType: InvoiceType,
): [
  InventoryItem[] | undefined,
  React.Dispatch<React.SetStateAction<InventoryItem[] | undefined>>,
] {
  const [inventory, setInventory] = useState<InventoryItem[] | undefined>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const inv: InventoryItem[] = await window.electron.getInventory();
      if (cancelled) return;
      setInventory(filterInventoryForInvoice(inv, invoiceType));
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceType]);

  return [inventory, setInventory];
}
