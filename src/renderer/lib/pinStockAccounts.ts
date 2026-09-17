import { partition, sortBy } from 'lodash';

interface StockPinable {
  tracksVendorStock?: boolean;
  name?: string;
}

/**
 * pin accounts that track vendor stock to the top of a selector list.
 * within each group, sort by name so the order stays predictable.
 */
export const pinStockAccounts = <T extends StockPinable>(
  accounts: T[],
): T[] => {
  const [stock, rest] = partition(accounts, (a) =>
    Boolean(a.tracksVendorStock),
  );
  return [
    ...sortBy(stock, (a) => a.name ?? ''),
    ...sortBy(rest, (a) => a.name ?? ''),
  ];
};
