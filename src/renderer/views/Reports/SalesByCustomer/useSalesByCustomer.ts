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
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(
    saved.accountIds?.[0] ?? null,
  );
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<SalesByCustomerResponse | null>(
    null,
  );
  const filterRef = useRef(0);

  const customers = useMemo(() => accounts.filter(isCustomerParty), [accounts]);

  const selectedCustomerName = useMemo(() => {
    if (selectedCustomerId == null) return '';
    return (
      customers.find((account) => account.id === selectedCustomerId)?.name ?? ''
    );
  }, [selectedCustomerId, customers]);

  const persistFilters = useCallback(
    (
      range: DateRange | undefined,
      customerId: number | null,
      preset: string,
    ) => {
      saveSavedFilters(
        REPORT_FILTER_KEYS.salesByCustomer,
        makeSavedState(range, undefined, {
          presetValue: preset,
          ...(customerId != null ? { accountIds: [customerId] } : {}),
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
    if (!selectedCustomerId || !dateRange?.from || !dateRange?.to) {
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
        customerAccountId: selectedCustomerId,
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
  }, [selectedCustomerId, dateRange]);

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
      persistFilters(range, selectedCustomerId, nextPreset);
    },
    [persistFilters, presetValue, selectedCustomerId],
  );

  const handleCustomerChange = useCallback(
    (value: string | number) => {
      const customerId = Number(value);
      setSelectedCustomerId(customerId);
      persistFilters(dateRange, customerId, presetValue);
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
    selectedCustomerId,
    selectedCustomerName,
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
