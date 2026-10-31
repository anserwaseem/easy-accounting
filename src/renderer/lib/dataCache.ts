import type {
  Account,
  AttributeDefinition,
  Chart,
  DiscountProfile,
  InventoryItem,
  InvoicesView,
  InvoiceType,
  ItemType,
} from '@/types';
import type { PriceListSummary } from '@/renderer/hooks/usePublishSettings';
import type { JournalView } from '@/renderer/views/Journals';

export interface AccountsCacheData {
  accounts: Account[];
  charts: Chart[];
  discountProfiles: DiscountProfile[];
  timestamp: number;
}

export interface InvoicesCacheData {
  invoices: InvoicesView[];
  timestamp: number;
}

export interface JournalsCacheData {
  journals: JournalView[];
  timestamp: number;
}

export interface InventoryCacheData {
  inventory: InventoryItem[];
  idsWithHistory: number[];
  itemTypes: ItemType[];
  priceLists: PriceListSummary[];
  attributeDefs: AttributeDefinition[];
  timestamp: number;
}

const DEFAULT_TTL_MS = 60_000; // 1 minute fresh window

function getInvoicesKey(
  invoiceType: InvoiceType,
  saleReturns?: boolean,
): string {
  return `${invoiceType}:${saleReturns ? 'returns' : 'regular'}`;
}

class AppDataCache {
  private accountsCache: AccountsCacheData | null = null;

  private invoicesCache = new Map<string, InvoicesCacheData>();

  private journalsCache: JournalsCacheData | null = null;

  private inventoryCache: InventoryCacheData | null = null;

  private inFlightAccountsPromise: Promise<AccountsCacheData> | null = null;

  private inFlightInvoicesPromise = new Map<string, Promise<InvoicesView[]>>();

  private inFlightJournalsPromise: Promise<JournalView[]> | null = null;

  private inFlightInventoryPromise: Promise<InventoryCacheData> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('easyaccounting:sync-applied', () => {
        this.invalidateAll();
      });
    }
  }

  // --- Accounts ---
  public getAccountsData(): AccountsCacheData | null {
    return this.accountsCache;
  }

  public setAccountsData(data: Omit<AccountsCacheData, 'timestamp'>): void {
    this.accountsCache = {
      ...data,
      timestamp: Date.now(),
    };
  }

  public async fetchAccounts(options?: {
    forceRefresh?: boolean;
  }): Promise<AccountsCacheData> {
    const now = Date.now();
    if (
      !options?.forceRefresh &&
      this.accountsCache &&
      now - this.accountsCache.timestamp < DEFAULT_TTL_MS
    ) {
      return this.accountsCache;
    }

    if (this.inFlightAccountsPromise) {
      return this.inFlightAccountsPromise;
    }

    this.inFlightAccountsPromise = (async () => {
      try {
        const [accounts, charts, discountProfiles] = await Promise.all([
          window.electron.getAccounts(),
          window.electron.getCharts?.() ?? Promise.resolve([]),
          window.electron.getDiscountProfiles?.() ?? Promise.resolve([]),
        ]);
        const data: AccountsCacheData = {
          accounts,
          charts,
          discountProfiles,
          timestamp: Date.now(),
        };
        this.accountsCache = data;
        return data;
      } finally {
        this.inFlightAccountsPromise = null;
      }
    })();

    return this.inFlightAccountsPromise;
  }

  public invalidateAccounts(): void {
    this.accountsCache = null;
  }

  // --- Invoices ---
  public getInvoices(
    invoiceType: InvoiceType,
    saleReturns?: boolean,
  ): InvoicesView[] | null {
    const key = getInvoicesKey(invoiceType, saleReturns);
    return this.invoicesCache.get(key)?.invoices ?? null;
  }

  public hasInvoices(invoiceType: InvoiceType, saleReturns?: boolean): boolean {
    const key = getInvoicesKey(invoiceType, saleReturns);
    return this.invoicesCache.has(key);
  }

  public setInvoices(
    invoiceType: InvoiceType,
    invoices: InvoicesView[],
    saleReturns?: boolean,
  ): void {
    const key = getInvoicesKey(invoiceType, saleReturns);
    this.invoicesCache.set(key, {
      invoices,
      timestamp: Date.now(),
    });
  }

  public async fetchInvoices(
    invoiceType: InvoiceType,
    saleReturns?: boolean,
    options?: { forceRefresh?: boolean },
  ): Promise<InvoicesView[]> {
    const key = getInvoicesKey(invoiceType, saleReturns);
    const existing = this.invoicesCache.get(key);
    const now = Date.now();

    if (
      !options?.forceRefresh &&
      existing &&
      now - existing.timestamp < DEFAULT_TTL_MS
    ) {
      return existing.invoices;
    }

    const inFlight = this.inFlightInvoicesPromise.get(key);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async () => {
      try {
        let fetched: InvoicesView[];
        if (saleReturns) {
          fetched = (await window.electron.getSaleReturns?.()) ?? [];
        } else {
          fetched = (await window.electron.getInvoices?.(invoiceType)) ?? [];
        }
        this.invoicesCache.set(key, {
          invoices: fetched,
          timestamp: Date.now(),
        });
        return fetched;
      } finally {
        this.inFlightInvoicesPromise.delete(key);
      }
    })();

    this.inFlightInvoicesPromise.set(key, promise);
    return promise;
  }

  public invalidateInvoices(invoiceType?: InvoiceType): void {
    if (invoiceType) {
      this.invoicesCache.delete(getInvoicesKey(invoiceType, false));
      this.invoicesCache.delete(getInvoicesKey(invoiceType, true));
    } else {
      this.invoicesCache.clear();
    }
  }

  // --- Journals ---
  public getJournals(): JournalView[] | null {
    return this.journalsCache?.journals ?? null;
  }

  public hasJournals(): boolean {
    return this.journalsCache != null;
  }

  public setJournals(journals: JournalView[]): void {
    this.journalsCache = {
      journals,
      timestamp: Date.now(),
    };
  }

  public async fetchJournals(
    mapper: (raw: any[]) => JournalView[],
    options?: { forceRefresh?: boolean },
  ): Promise<JournalView[]> {
    const now = Date.now();
    if (
      !options?.forceRefresh &&
      this.journalsCache &&
      now - this.journalsCache.timestamp < DEFAULT_TTL_MS
    ) {
      return this.journalsCache.journals;
    }

    if (this.inFlightJournalsPromise) {
      return this.inFlightJournalsPromise;
    }

    this.inFlightJournalsPromise = (async () => {
      try {
        const raw = (await window.electron.getJournals?.()) ?? [];
        const mapped = mapper(raw);
        this.journalsCache = {
          journals: mapped,
          timestamp: Date.now(),
        };
        return mapped;
      } finally {
        this.inFlightJournalsPromise = null;
      }
    })();

    return this.inFlightJournalsPromise;
  }

  public invalidateJournals(): void {
    this.journalsCache = null;
  }

  // --- Inventory ---
  public getInventoryData(): InventoryCacheData | null {
    return this.inventoryCache;
  }

  public setInventoryData(data: Omit<InventoryCacheData, 'timestamp'>): void {
    this.inventoryCache = {
      ...data,
      timestamp: Date.now(),
    };
  }

  public async fetchInventory(options?: {
    forceRefresh?: boolean;
  }): Promise<InventoryCacheData> {
    const now = Date.now();
    if (
      !options?.forceRefresh &&
      this.inventoryCache &&
      now - this.inventoryCache.timestamp < DEFAULT_TTL_MS
    ) {
      return this.inventoryCache;
    }

    if (this.inFlightInventoryPromise) {
      return this.inFlightInventoryPromise;
    }

    this.inFlightInventoryPromise = (async () => {
      try {
        const [inventory, idsWithHistory, itemTypes, lists, defs] =
          await Promise.all([
            Promise.resolve(window.electron.getInventory?.()).then(
              (r) => r ?? [],
            ),
            Promise.resolve(
              window.electron.getInventoryIdsWithHistory?.(),
            ).then((r) => r ?? []),
            Promise.resolve(window.electron.getItemTypes?.()).then(
              (r) => r ?? [],
            ),
            Promise.resolve(window.electron.getPriceLists?.())
              .then((res) => res ?? ([] as PriceListSummary[]))
              .catch(() => [] as PriceListSummary[]),
            Promise.resolve(window.electron.getAttributeDefinitions?.())
              .then((res) => res ?? ([] as AttributeDefinition[]))
              .catch(() => [] as AttributeDefinition[]),
          ]);
        const data: InventoryCacheData = {
          inventory,
          idsWithHistory,
          itemTypes,
          priceLists: (lists ?? []).filter((l) => l.isActive),
          attributeDefs: (defs ?? []).filter((d) => d.isActive),
          timestamp: Date.now(),
        };
        this.inventoryCache = data;
        return data;
      } finally {
        this.inFlightInventoryPromise = null;
      }
    })();

    return this.inFlightInventoryPromise;
  }

  public invalidateInventory(): void {
    this.inventoryCache = null;
  }

  // --- Invalidate All ---
  public invalidateAll(): void {
    this.accountsCache = null;
    this.invoicesCache.clear();
    this.journalsCache = null;
    this.inventoryCache = null;
  }
}

export const appDataCache = new AppDataCache();
