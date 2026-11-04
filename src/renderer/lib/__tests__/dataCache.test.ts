import { InvoiceType } from '@/types';
import { appDataCache } from '../dataCache';

describe('AppDataCache', () => {
  beforeEach(() => {
    window.electron = {
      getAccounts: jest.fn(),
      getCharts: jest.fn(),
      getDiscountProfiles: jest.fn(),
      getInvoices: jest.fn(),
      getSaleReturns: jest.fn(),
      getJournals: jest.fn(),
      getInventory: jest.fn(),
      getInventoryIdsWithHistory: jest.fn(),
      getItemTypes: jest.fn(),
      getPriceLists: jest.fn(),
      getAttributeDefinitions: jest.fn(),
    } as unknown as Window['electron'];
    appDataCache.invalidateAll();
    jest.clearAllMocks();
  });

  describe('accounts caching', () => {
    it('caches accounts data and reuses on subsequent calls', async () => {
      const mockAccounts = [{ id: 1, name: 'Cash', type: 'Asset' }];
      const mockCharts = [{ id: 1, name: 'Current Assets', type: 'Asset' }];
      const mockProfiles = [{ id: 1, name: 'Standard' }];

      (window.electron.getAccounts as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockAccounts);
      (window.electron.getCharts as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockCharts);
      (window.electron.getDiscountProfiles as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockProfiles);

      const firstResult = await appDataCache.fetchAccounts();
      expect(firstResult.accounts).toEqual(mockAccounts);
      expect(firstResult.charts).toEqual(mockCharts);
      expect(window.electron.getAccounts).toHaveBeenCalledTimes(1);

      // Second call should return cached data without hitting IPC
      const secondResult = await appDataCache.fetchAccounts();
      expect(secondResult.accounts).toEqual(mockAccounts);
      expect(window.electron.getAccounts).toHaveBeenCalledTimes(1);

      // Synchronous getter returns cached data
      expect(appDataCache.getAccountsData()?.accounts).toEqual(mockAccounts);
    });

    it('forceRefresh bypasses cache and updates data', async () => {
      const initial = [{ id: 1, name: 'Cash' }];
      const updated = [
        { id: 1, name: 'Cash' },
        { id: 2, name: 'Bank' },
      ];

      (window.electron.getAccounts as jest.Mock) = jest
        .fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(updated);
      (window.electron.getCharts as jest.Mock) = jest
        .fn()
        .mockResolvedValue([]);
      (window.electron.getDiscountProfiles as jest.Mock) = jest
        .fn()
        .mockResolvedValue([]);

      await appDataCache.fetchAccounts();
      expect(window.electron.getAccounts).toHaveBeenCalledTimes(1);

      const refreshed = await appDataCache.fetchAccounts({
        forceRefresh: true,
      });
      expect(refreshed.accounts).toEqual(updated);
      expect(window.electron.getAccounts).toHaveBeenCalledTimes(2);
    });
  });

  describe('invoices caching', () => {
    it('caches invoices by type and distinguishes sale returns', async () => {
      const saleInvoices = [
        { id: 1, invoiceNumber: 101, invoiceType: InvoiceType.Sale },
      ];
      const saleReturns = [
        {
          id: 2,
          invoiceNumber: 102,
          invoiceType: InvoiceType.Sale,
          isReturned: true,
        },
      ];

      (window.electron.getInvoices as jest.Mock) = jest
        .fn()
        .mockResolvedValue(saleInvoices);
      (window.electron.getSaleReturns as jest.Mock) = jest
        .fn()
        .mockResolvedValue(saleReturns);

      const sale = await appDataCache.fetchInvoices(InvoiceType.Sale);
      expect(sale).toEqual(saleInvoices);
      expect(appDataCache.hasInvoices(InvoiceType.Sale)).toBe(true);

      const returns = await appDataCache.fetchInvoices(InvoiceType.Sale, true);
      expect(returns).toEqual(saleReturns);
      expect(appDataCache.hasInvoices(InvoiceType.Sale, true)).toBe(true);

      // Cached get
      expect(appDataCache.getInvoices(InvoiceType.Sale)).toEqual(saleInvoices);
      expect(appDataCache.getInvoices(InvoiceType.Sale, true)).toEqual(
        saleReturns,
      );
    });

    it('invalidateInvoices clears specific type', async () => {
      appDataCache.setInvoices(InvoiceType.Sale, [{ id: 1 } as any]);
      appDataCache.setInvoices(InvoiceType.Purchase, [{ id: 2 } as any]);

      expect(appDataCache.hasInvoices(InvoiceType.Sale)).toBe(true);
      expect(appDataCache.hasInvoices(InvoiceType.Purchase)).toBe(true);

      appDataCache.invalidateInvoices(InvoiceType.Sale);
      expect(appDataCache.hasInvoices(InvoiceType.Sale)).toBe(false);
      expect(appDataCache.hasInvoices(InvoiceType.Purchase)).toBe(true);
    });
  });

  describe('journals caching', () => {
    it('caches journals and uses mapper', async () => {
      const rawJournals = [{ id: 1, journalEntries: [{ debitAmount: 500 }] }];
      (window.electron.getJournals as jest.Mock) = jest
        .fn()
        .mockResolvedValue(rawJournals);

      const mapper = (raw: any[]) =>
        raw.map((j) => ({ ...j, amount: j.journalEntries[0].debitAmount }));

      const mapped = await appDataCache.fetchJournals(mapper);
      expect(mapped[0].amount).toBe(500);
      expect(appDataCache.hasJournals()).toBe(true);
      expect(appDataCache.getJournals()).toEqual(mapped);
    });
  });

  describe('inventory caching', () => {
    it('caches inventory and handles optional endpoints', async () => {
      const mockInventory = [
        { id: 1, name: 'Item A', price: 100, quantity: 10 },
      ];
      (window.electron.getInventory as jest.Mock) = jest
        .fn()
        .mockResolvedValue(mockInventory);
      (window.electron.getInventoryIdsWithHistory as jest.Mock) = jest
        .fn()
        .mockResolvedValue([1]);
      (window.electron.getItemTypes as jest.Mock) = jest
        .fn()
        .mockResolvedValue([]);

      const data = await appDataCache.fetchInventory();
      expect(data.inventory).toEqual(mockInventory);
      expect(data.idsWithHistory).toEqual([1]);
      expect(appDataCache.getInventoryData()?.inventory).toEqual(mockInventory);
    });
  });

  describe('sync applied event', () => {
    it('invalidates all cache entries on easyaccounting:sync-applied', () => {
      appDataCache.setAccountsData({
        accounts: [{ id: 1 } as any],
        charts: [],
        discountProfiles: [],
      });
      appDataCache.setInvoices(InvoiceType.Sale, [{ id: 1 } as any]);
      appDataCache.setJournals([{ id: 1 } as any]);

      expect(appDataCache.getAccountsData()).not.toBeNull();
      expect(appDataCache.hasInvoices(InvoiceType.Sale)).toBe(true);
      expect(appDataCache.hasJournals()).toBe(true);

      window.dispatchEvent(new Event('easyaccounting:sync-applied'));

      expect(appDataCache.getAccountsData()).toBeNull();
      expect(appDataCache.hasInvoices(InvoiceType.Sale)).toBe(false);
      expect(appDataCache.hasJournals()).toBe(false);
    });
  });
});
