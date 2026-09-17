import { find } from 'lodash';

export const VENDOR_STOCK_SELECTED_VENDOR_STORE_KEY =
  'vendorStockSelectedVendorId';

export const readStoredVendorStockVendorId = (): number | undefined => {
  const stored = window.electron.store.get(
    VENDOR_STOCK_SELECTED_VENDOR_STORE_KEY,
  );
  const id = Number(stored);
  return Number.isInteger(id) && id > 0 ? id : undefined;
};

export const persistVendorStockVendorId = (
  vendorId: number | undefined,
): void => {
  window.electron.store.set(
    VENDOR_STOCK_SELECTED_VENDOR_STORE_KEY,
    vendorId ?? null,
  );
};

/** first candidate that is still in the tracked-vendor list */
export const pickTrackedVendorId = (
  trackedIds: number[],
  candidates: Array<number | undefined | null>,
): number | undefined => {
  const tracked = new Set(trackedIds);
  const match = find(
    candidates,
    (id): id is number =>
      id != null && Number.isInteger(id) && id > 0 && tracked.has(id),
  );
  return match ?? undefined;
};
