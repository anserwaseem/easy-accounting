import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, startOfYear } from 'date-fns';
import type { DateRange } from '@/renderer/shad/ui/datePicker';
import {
  loadSavedFilters,
  saveSavedFilters,
  makeSavedState,
} from '@/renderer/lib/reportFilters';
import { toLowerTrim } from '@/renderer/lib/utils';
import type { Account, SalesByCustomerResponse } from 'types';
import { AccountType, InvoiceType, REPORT_FILTER_KEYS } from 'types';

/** shown while no customers are selected */
export const SALES_BY_CUSTOMER_EMPTY_SELECTION_MESSAGE =
  'Search and select customers to see items sold.';

const isCustomerParty = (account: Account): boolean => {
  if (toLowerTrim(account.name) === InvoiceType.Sale.toLowerCase()) {
    return false;
  }
  if (toLowerTrim(account.name) === InvoiceType.Purchase.toLowerCase()) {
    return false;
  }
  // sale parties are asset (receivable) accounts — same rule as new sale invoice
  return account.type === AccountType.Asset;
};

export const useSalesByCustomer = () => {
  const saved = useMemo(
    () => loadSavedFilters(REPORT_FILTER_KEYS.salesByCustomer),
    [],
  );

  const defaultDateRange: DateRange = useMemo(() => {
    if (saved.dateRange?.from && saved.dateRange?.to) {
      return {
        from: new Date(saved.dateRange.from),
        to: new Date(saved.dateRange.to),
      };
    }
    return { from: startOfYear(new Date()), to: new Date() };
  }, [saved.dateRange]);

  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    defaultDateRange,
  );
  const [presetValue, setPresetValue] = useState<string>(
    saved.presetValue ?? 'current-year',
  );
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<number[]>(() =>
    (saved.accountIds ?? []).map(Number).filter((id) => id > 0),
  );
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<SalesByCustomerResponse | null>(
    null,
  );
  const filterRef = useRef(0);

  const customers = useMemo(() => accounts.filter(isCustomerParty), [accounts]);

  const selectedCustomerLabel = useMemo(() => {
    if (selectedCustomerIds.length === 0) return '';

    const selectedAccounts = selectedCustomerIds
      .map((id) => customers.find((account) => account.id === id))
      .filter((account): account is Account => account != null);

    if (selectedAccounts.length > 0 && selectedAccounts.length <= 3) {
      return selectedAccounts
        .map((account) => {
          if (account.code == null || account.code === '') return account.name;
          return `${account.name} (${account.code})`;
        })
        .join(', ');
    }

    return `${selectedCustomerIds.length} customers`;
  }, [selectedCustomerIds, customers]);

  const persistFilters = useCallback(
    (range: DateRange | undefined, customerIds: number[], preset: string) => {
      saveSavedFilters(
        REPORT_FILTER_KEYS.salesByCustomer,
        makeSavedState(range, undefined, {
          presetValue: preset,
          ...(customerIds.length > 0 ? { accountIds: customerIds } : {}),
        }),
      );
    },
    [],
  );

  const fetchAccounts = useCallback(async () => {
    try {
      const accountsData = await window.electron.getAccounts();
      setAccounts(accountsData || []);
    } catch (error) {
      console.error('Error fetching customer accounts:', error);
    }
  }, []);

  const fetchReport = useCallback(async () => {
    if (
      selectedCustomerIds.length === 0 ||
      !dateRange?.from ||
      !dateRange?.to
    ) {
      setResponse(null);
      return;
    }

    setIsLoading(true);
    filterRef.current += 1;
    const thisFilter = filterRef.current;

    const startDate = format(dateRange.from, 'yyyy-MM-dd');
    const endDate = format(dateRange.to, 'yyyy-MM-dd');

    try {
      const resp = await window.electron.reportGetSalesByCustomer({
        customerAccountIds: selectedCustomerIds,
        startDate,
        endDate,
      });
      if (thisFilter === filterRef.current) {
        setResponse(resp);
      }
    } catch (error) {
      console.error('Error fetching sales by customer:', error);
      if (thisFilter === filterRef.current) {
        setResponse(null);
      }
    } finally {
      if (thisFilter === filterRef.current) {
        setIsLoading(false);
      }
    }
  }, [selectedCustomerIds, dateRange]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleDateChange = useCallback(
    (range?: DateRange, selectValue?: string) => {
      if (!range) return;
      setDateRange(range);
      const nextPreset = selectValue || presetValue;
      if (selectValue) setPresetValue(selectValue);
      persistFilters(range, selectedCustomerIds, nextPreset);
    },
    [persistFilters, presetValue, selectedCustomerIds],
  );

  const handleCustomerChange = useCallback(
    (ids: (string | number)[]) => {
      const customerIds = ids.map(Number).filter((id) => id > 0);
      setSelectedCustomerIds(customerIds);
      persistFilters(dateRange, customerIds, presetValue);
    },
    [dateRange, persistFilters, presetValue],
  );

  const refreshData = useCallback(() => {
    fetchAccounts();
    fetchReport();
  }, [fetchAccounts, fetchReport]);

  const dateSubtitle = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return '';
    return `${format(dateRange.from, 'PP')} – ${format(dateRange.to, 'PP')}`;
  }, [dateRange]);

  return {
    customers,
    selectedCustomerIds,
    selectedCustomerLabel,
    handleCustomerChange,
    dateRange,
    handleDateChange,
    presetValue,
    isLoading,
    response,
    refreshData,
    dateSubtitle,
  };
};
