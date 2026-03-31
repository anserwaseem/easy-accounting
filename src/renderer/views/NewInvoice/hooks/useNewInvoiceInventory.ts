import { isNil, pick } from 'lodash';
import { useEffect, useState } from 'react';
import type { InventoryItem } from 'types';

/** loads inventory once and filters to in-stock items with positive price */
export function useNewInvoiceInventory(): [
  InventoryItem[] | undefined,
  React.Dispatch<React.SetStateAction<InventoryItem[] | undefined>>,
] {
  const [inventory, setInventory] = useState<InventoryItem[] | undefined>();

  useEffect(() => {
    (async () => {
      if (isNil(inventory)) {
        const inv: InventoryItem[] = await window.electron.getInventory();
        const filteredInv = inv
          .map((item) =>
            pick(item, [
              'id',
              'name',
              'price',
              'quantity',
              'description',
              'itemTypeId',
              'itemTypeName',
            ]),
          )
          .filter((item) => item.quantity > 0 && item.price > 0);
        setInventory(filteredInv);
      }
    })();
  }, [inventory]);

  return [inventory, setInventory];
}
