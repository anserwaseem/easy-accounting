import { isNil } from 'lodash';
import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileInput, FileOutput, Store, Table2 } from 'lucide-react';
import type { Account, InventoryItem, InvoicesView } from 'types';
import { InvoiceType } from 'types';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/renderer/shad/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/shad/ui/dialog';
import { getSearchTerms, matchesSearchTerms } from '@/renderer/lib/utils';
import { useCmdOrCtrlShortcut } from '@/renderer/hooks/useCmdOrCtrlShortcut';

/** invoice list row tagged with the list it came from, so the route is unambiguous */
type SearchInvoice = InvoicesView & { invoiceType: InvoiceType };

interface GlobalSearchData {
  accounts: Account[];
  inventory: InventoryItem[];
  invoices: SearchInvoice[];
}

/**
 * the dataset (~1.3k accounts / ~1k items / ~12k invoices) is loaded once per
 * app session, on the first palette open — never at app start
 */
let cachedDataPromise: Promise<GlobalSearchData> | null = null;

const loadGlobalSearchData = (): Promise<GlobalSearchData> => {
  cachedDataPromise ??= Promise.all([
    window.electron.getAccounts(),
    window.electron.getInventory(),
    window.electron.getInvoices(InvoiceType.Sale),
    window.electron.getInvoices(InvoiceType.Purchase),
  ])
    .then(
      ([
        accounts,
        inventory,
        saleInvoices,
        purchaseInvoices,
      ]): GlobalSearchData => ({
        accounts: (accounts as Account[]) ?? [],
        inventory: (inventory as InventoryItem[]) ?? [],
        invoices: [
          ...((saleInvoices as InvoicesView[]) ?? []).map((row) => ({
            ...row,
            invoiceType: InvoiceType.Sale,
          })),
          ...((purchaseInvoices as InvoicesView[]) ?? []).map((row) => ({
            ...row,
            invoiceType: InvoiceType.Purchase,
          })),
        ],
      }),
    )
    .catch((error) => {
      // don't cache a failure — the next open retries
      cachedDataPromise = null;
      throw error;
    });
  return cachedDataPromise;
};

/** test-only: forget the session cache so each test starts cold */
export const resetGlobalSearchDataCache = (): void => {
  cachedDataPromise = null;
};

/** keeps long lists cheap: at most this many rows are rendered per group */
export const MAX_RESULTS_PER_GROUP = 8;

/**
 * same multi-word contains matching the Inventory page uses (via DataTable →
 * getSearchTerms/matchesSearchTerms), but capped: stops scanning a group once
 * enough rows matched, so typing stays responsive over ~12k invoices
 */
const filterCapped = <T,>(
  rows: T[],
  getValues: (row: T) => unknown[],
  terms: string[],
  cap: number = MAX_RESULTS_PER_GROUP,
): T[] => {
  const matched: T[] = [];
  for (const row of rows) {
    if (matched.length >= cap) break;
    if (matchesSearchTerms(getValues(row), terms)) matched.push(row);
  }
  return matched;
};

const EMPTY_DATA: GlobalSearchData = {
  accounts: [],
  inventory: [],
  invoices: [],
};

const GlobalSearch: FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<GlobalSearchData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // ⌘/Ctrl+K toggles the palette; the hook listens on window with
  // preventDefault, so the shortcut works even while an input has focus
  useCmdOrCtrlShortcut(
    'k',
    useCallback(() => setOpen((prev) => !prev), []),
  );

  // lazy-load on first open; cached for the rest of the session
  useEffect(() => {
    if (!open || data || isLoading) return;
    const load = async () => {
      setIsLoading(true);
      try {
        setData(await loadGlobalSearchData());
      } catch (error) {
        console.error('global search data failed to load', error);
        setData(EMPTY_DATA);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [open, data, isLoading]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    // start fresh next time instead of showing a stale query
    if (!nextOpen) setQuery('');
  }, []);

  const handleSelect = useCallback(
    (to: string) => {
      handleOpenChange(false);
      navigate(to);
    },
    [handleOpenChange, navigate],
  );

  const results = useMemo(() => {
    const terms = getSearchTerms(query);
    return {
      accounts: filterCapped(
        data?.accounts ?? [],
        (account) => [account.name, account.code],
        terms,
      ),
      inventory: filterCapped(
        data?.inventory ?? [],
        (item) => [item.name],
        terms,
      ),
      invoices: filterCapped(
        data?.invoices ?? [],
        (invoice) => [invoice.invoiceNumber, invoice.accountName],
        terms,
      ),
    };
  }, [data, query]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 top-[20%] translate-y-0 max-w-xl"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Global search</DialogTitle>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search accounts, inventory, invoices..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[420px]">
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading...
              </div>
            ) : (
              <CommandEmpty>No results found.</CommandEmpty>
            )}
            {results.accounts.length > 0 && (
              <CommandGroup heading="Accounts">
                {results.accounts.map((account) => (
                  <CommandItem
                    key={`account-${account.id}`}
                    value={`account-${account.id}`}
                    onSelect={() => handleSelect(`/accounts/${account.id}`)}
                  >
                    <Table2 className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                    <span className="truncate">{account.name}</span>
                    {!isNil(account.code) && (
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {account.code}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.inventory.length > 0 && (
              <CommandGroup heading="Inventory">
                {results.inventory.map((item) => (
                  <CommandItem
                    key={`inventory-${item.id}`}
                    value={`inventory-${item.id}`}
                    onSelect={() => handleSelect('/inventory')}
                  >
                    <Store className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                    <span className="truncate">{item.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results.invoices.length > 0 && (
              <CommandGroup heading="Invoices">
                {results.invoices.map((invoice) => (
                  <CommandItem
                    key={`invoice-${invoice.id}`}
                    value={`invoice-${invoice.id}`}
                    onSelect={() =>
                      handleSelect(
                        `/${invoice.invoiceType.toLowerCase()}/invoices/${
                          invoice.id
                        }`,
                      )
                    }
                  >
                    {invoice.invoiceType === InvoiceType.Sale ? (
                      <FileOutput className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                    ) : (
                      <FileInput className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                    )}
                    <span className="shrink-0">
                      {invoice.invoiceType} #{invoice.invoiceNumber}
                    </span>
                    <span className="ml-2 truncate text-xs text-muted-foreground">
                      {invoice.accountName}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
};

export default GlobalSearch;
